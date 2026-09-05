import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { createIceMaterial } from "./ice-material.js";
import { createItemLabels } from "./item-labels.js";
import { createOcean } from "./ocean.js";
import type { IcebergItem } from "./item-data.js";

export {
  arrangeItems,
  parseItems,
  slugFromQuery,
  type IcebergItem,
} from "./item-data.js";

export interface IcebergAssets {
  model: string;
  environment: string;
  sky: string;
  relief: string;
}

export interface IcebergOptions {
  items: readonly IcebergItem[];
  aboveWaterLabelStretch?: number;
  assets?: Partial<IcebergAssets>;
  ariaLabel?: string;
  canvasAriaLabel?: string;
  itemsAriaLabel?: string;
  hint?: string | false;
  initialItem?: string;
  overview?: boolean;
  stillFrame?: boolean;
  syncUrl?: boolean;
  underwaterStretch?: number;
  waterLevel?: number;
}

export interface IcebergController {
  /** Resolves when the GLB is loaded, framed, and populated with labels. */
  readonly ready: Promise<void>;
  /** Stops rendering, removes listeners and generated DOM, and releases GPU resources. */
  dispose(): void;
}

export const defaultIcebergAssets: Readonly<IcebergAssets> = Object.freeze({
  model: new URL("../assets/models/iceberg-web.glb", import.meta.url).href,
  environment: new URL("../assets/environment/ocean-panorama.hdr", import.meta.url).href,
  sky: new URL("../assets/environment/polar-cirrus.jpg", import.meta.url).href,
  relief: new URL("../assets/textures/glacial-relief.jpg", import.meta.url).href,
});

const DEFAULT_HINT = "Scroll to descend · Drag to turn · Select a name to keep it open";

/**
 * Mount the interactive iceberg in a sized HTML element.
 *
 * Import `@aleyan/iceberg/styles.css` once before mounting. The host needs an
 * explicit height; the renderer follows the host with a ResizeObserver.
 */
export function mountIceberg(
  host: HTMLElement,
  options: IcebergOptions,
): IcebergController {
  if (!(host instanceof HTMLElement)) {
    throw new TypeError("mountIceberg requires an HTMLElement host.");
  }

  const waterLevel = options.waterLevel ?? -0.72;
  const underwaterStretch = THREE.MathUtils.clamp(options.underwaterStretch ?? 2, 1, 4);
  const overview = options.overview ?? false;
  const stillFrame = options.stillFrame ?? false;
  const assets = { ...defaultIcebergAssets, ...options.assets };
  const addedHostClass = !host.classList.contains("aleyan-iceberg");
  const previousAriaLabel = host.getAttribute("aria-label");
  host.classList.add("aleyan-iceberg");
  host.setAttribute(
    "aria-label",
    options.ariaLabel ?? "Interactive three-dimensional iceberg",
  );

  const canvas = document.createElement("canvas");
  canvas.className = "aleyan-iceberg__canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    options.canvasAriaLabel
      ?? "Explore the iceberg. Scroll or use up and down arrows to descend; drag or use left and right arrows to rotate.",
  );

  const hint = document.createElement("div");
  hint.className = "aleyan-iceberg__hint";
  hint.textContent = options.hint === false ? "" : options.hint ?? DEFAULT_HINT;
  hint.hidden = options.hint === false;

  const loading = document.createElement("div");
  loading.className = "aleyan-iceberg__loading";
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  const loadingBar = document.createElement("span");
  loadingBar.className = "aleyan-iceberg__loading-bar";
  const loadingText = document.createElement("span");
  loadingText.className = "aleyan-iceberg__sr-only";
  loadingText.textContent = "Loading iceberg";
  loading.append(loadingBar, loadingText);
  host.append(canvas, hint, loading);

  let disposed = false;
  let loadingRemoveTimer: ReturnType<typeof setTimeout> | undefined;
  let width = 1;
  let height = 1;
  let resolveReady!: () => void;
  let rejectReady!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const scene = new THREE.Scene();
  scene.background = null;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let environmentTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  let panoramaTexture: THREE.DataTexture | null = null;
  scene.environment = environmentTarget.texture;

  new HDRLoader().load(
    assets.environment,
    (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      panoramaTexture = texture;
      panoramaTexture.name = "Ocean HDR panorama";
      panoramaTexture.mapping = THREE.EquirectangularReflectionMapping;
      const previousEnvironment = environmentTarget;
      environmentTarget = pmrem.fromEquirectangular(panoramaTexture);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.28;
      previousEnvironment.dispose();
      pmrem.dispose();
    },
    undefined,
    (error) => {
      if (!disposed) console.warn("Unable to load the HDR environment", error);
      pmrem.dispose();
    },
  );

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  scene.add(camera);
  const cameraTarget = new THREE.Vector3(0, waterLevel + 1.5, 0);
  const maxViewPitch = THREE.MathUtils.degToRad(5);
  const cameraOrbit = {
    distance: 12,
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
  };
  camera.position.set(0, cameraTarget.y, cameraOrbit.distance);
  camera.lookAt(cameraTarget);

  const cameraRail = {
    ready: false,
    desiredY: cameraTarget.y,
    minY: cameraTarget.y,
    maxY: cameraTarget.y,
  };
  const icebergRoot = new THREE.Group();
  scene.add(icebergRoot);

  const viewDrag = {
    dragging: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  };
  let touchTravel = 0;
  let suppressTouchClick = false;

  function beginViewRotation(event: PointerEvent) {
    if (event.pointerType === "touch" || event.button !== 0 || viewDrag.dragging) return;
    event.preventDefault();
    viewDrag.dragging = true;
    viewDrag.pointerId = event.pointerId;
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }

  function updateViewRotation(event: PointerEvent) {
    if (!viewDrag.dragging || event.pointerId !== viewDrag.pointerId) return;
    const deltaX = event.clientX - viewDrag.lastX;
    const deltaY = event.clientY - viewDrag.lastY;
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    cameraOrbit.targetYaw -= deltaX * 0.006;
    if (event.pointerType === "touch") {
      cameraRail.desiredY = THREE.MathUtils.clamp(
        cameraRail.desiredY + deltaY * 0.025,
        cameraRail.minY,
        cameraRail.maxY,
      );
      return;
    }
    cameraOrbit.targetPitch = THREE.MathUtils.clamp(
      cameraOrbit.targetPitch + deltaY * 0.002,
      -maxViewPitch,
      maxViewPitch,
    );
  }

  function endViewRotation(event: PointerEvent) {
    if (!viewDrag.dragging || event.pointerId !== viewDrag.pointerId) return;
    viewDrag.dragging = false;
    viewDrag.pointerId = -1;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function beginTouchNavigation(event: PointerEvent) {
    if (event.pointerType !== "touch" || viewDrag.dragging) return;
    viewDrag.dragging = true;
    viewDrag.pointerId = event.pointerId;
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    touchTravel = 0;
  }

  function updateTouchNavigation(event: PointerEvent) {
    if (event.pointerType !== "touch"
      || !viewDrag.dragging
      || event.pointerId !== viewDrag.pointerId) return;
    const deltaX = event.clientX - viewDrag.lastX;
    const deltaY = event.clientY - viewDrag.lastY;
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    touchTravel += Math.hypot(deltaX, deltaY);
    if (touchTravel < 4) return;
    event.preventDefault();
    cameraOrbit.targetYaw -= deltaX * 0.006;
    cameraRail.desiredY = THREE.MathUtils.clamp(
      cameraRail.desiredY + deltaY * 0.025,
      cameraRail.minY,
      cameraRail.maxY,
    );
  }

  function endTouchNavigation(event: PointerEvent) {
    if (event.pointerType !== "touch"
      || !viewDrag.dragging
      || event.pointerId !== viewDrag.pointerId) return;
    suppressTouchClick = touchTravel >= 4;
    viewDrag.dragging = false;
    viewDrag.pointerId = -1;
    touchTravel = 0;
    if (suppressTouchClick) {
      setTimeout(() => { suppressTouchClick = false; }, 0);
    }
  }

  function preventDraggedTouchClick(event: MouseEvent) {
    if (!suppressTouchClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressTouchClick = false;
  }

  canvas.addEventListener("pointerdown", beginViewRotation);
  canvas.addEventListener("pointermove", updateViewRotation);
  canvas.addEventListener("pointerup", endViewRotation);
  canvas.addEventListener("pointercancel", endViewRotation);
  canvas.addEventListener("lostpointercapture", endViewRotation);
  host.addEventListener("pointerdown", beginTouchNavigation);
  host.addEventListener("pointermove", updateTouchNavigation, { passive: false });
  host.addEventListener("pointerup", endTouchNavigation);
  host.addEventListener("pointercancel", endTouchNavigation);
  host.addEventListener("click", preventDraggedTouchClick, true);

  const hemi = new THREE.HemisphereLight(0xc6e3ff, 0x061431, 0.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff7e9, 2.8);
  sun.position.set(-7, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.075;
  sun.shadow.radius = 2;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x409fff, 1.7);
  rim.position.set(8, 1, -8);
  scene.add(rim);

  const iceMaterial = createIceMaterial(waterLevel, underwaterStretch, assets.relief);
  const ocean = createOcean(scene, waterLevel, assets.sky, overview);
  const drawingBufferSize = new THREE.Vector2();
  const icebergGeometries = new Set<THREE.BufferGeometry>();

  function stretchUnderwaterGeometry(mesh: THREE.Mesh) {
    const geometry = mesh.geometry.clone();
    const position = geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute)) {
      geometry.dispose();
      return;
    }
    mesh.updateWorldMatrix(true, false);
    const localToWorld = mesh.matrixWorld.clone();
    const worldToLocal = localToWorld.clone().invert();
    const vertex = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(localToWorld);
      if (vertex.y < waterLevel) {
        vertex.y = waterLevel + (vertex.y - waterLevel) * underwaterStretch;
      }
      vertex.applyMatrix4(worldToLocal);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
    icebergGeometries.add(geometry);
  }

  let framingBounds: THREE.Box3 | null = null;
  let itemMinimumY: number | null = null;

  function frameIcebergForScrolling(icebergBounds: THREE.Box3, preserveDepth = false) {
    const previousDepth = cameraRail.ready
      ? THREE.MathUtils.clamp(
          (cameraRail.maxY - cameraRail.desiredY)
            / Math.max(cameraRail.maxY - cameraRail.minY, 0.001),
          0,
          1,
        )
      : 0;
    const center = icebergBounds.getCenter(new THREE.Vector3());
    const icebergSize = icebergBounds.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const horizontalRadius = Math.hypot(icebergSize.x * 0.5, icebergSize.z * 0.5);
    const distance = overview
      ? Math.max(
          horizontalRadius / Math.sin(horizontalFov / 2) * 1.1,
          icebergSize.y / (2 * Math.tan(verticalFov / 2)) * 1.2,
        )
      : horizontalRadius / Math.sin(horizontalFov / 2) * 1.1;
    const halfViewHeight = distance * Math.tan(verticalFov / 2);
    const initialFocusY = overview
      ? center.y + icebergSize.y * 0.035
      : waterLevel + halfViewHeight * 0.5;
    cameraTarget.set(center.x, initialFocusY, center.z);
    cameraOrbit.distance = distance;
    camera.far = Math.max(12000, distance + icebergSize.length() * 2);
    camera.updateProjectionMatrix();
    cameraRail.maxY = initialFocusY;
    cameraRail.minY = Math.min(
      initialFocusY,
      icebergBounds.min.y - halfViewHeight * 0.94,
      itemMinimumY === null ? initialFocusY : itemMinimumY + halfViewHeight * 0.62,
    );
    cameraRail.desiredY = preserveDepth
      ? THREE.MathUtils.lerp(cameraRail.maxY, cameraRail.minY, previousDepth)
      : initialFocusY;
    cameraTarget.y = cameraRail.desiredY;
    cameraRail.ready = true;
  }

  function handleIcebergScroll(event: WheelEvent) {
    if (!cameraRail.ready) return;
    const deltaPixels = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * height
        : event.deltaY;
    // Let an embedding page move the viewer to the top edge before the
    // iceberg starts consuming downward scroll.
    if (deltaPixels > 0 && host.getBoundingClientRect().top > 0.5) return;
    const nextY = THREE.MathUtils.clamp(
      cameraRail.desiredY - deltaPixels * 0.008,
      cameraRail.minY,
      cameraRail.maxY,
    );
    // Embedded icebergs should release the page scroll at either end.
    if (nextY === cameraRail.desiredY) return;
    event.preventDefault();
    cameraRail.desiredY = nextY;
  }
  host.addEventListener("wheel", handleIcebergScroll, { passive: false });

  const itemLabels = createItemLabels(
    host,
    scene,
    options.items,
    (position, angle, instant) => {
      cameraRail.minY = Math.min(cameraRail.minY, position.y - 1);
      cameraRail.maxY = Math.max(cameraRail.maxY, position.y + 1);
      cameraRail.desiredY = position.y;
      const turn = Math.atan2(
        Math.sin(angle - cameraOrbit.yaw),
        Math.cos(angle - cameraOrbit.yaw),
      );
      cameraOrbit.targetYaw = cameraOrbit.yaw + turn;
      cameraOrbit.targetPitch = 0;
      if (instant) {
        cameraTarget.y = position.y;
        cameraOrbit.yaw = cameraOrbit.targetYaw;
        cameraOrbit.pitch = 0;
      }
    },
    (minimum) => {
      itemMinimumY = minimum;
      if (framingBounds) frameIcebergForScrolling(framingBounds, true);
    },
    {
      aboveWaterLabelStretch: options.aboveWaterLabelStretch ?? 1,
      ariaLabel: options.itemsAriaLabel ?? "Iceberg items",
      initialItem: options.initialItem,
      syncUrl: options.syncUrl ?? true,
    },
  );

  function handleCanvasKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      cameraOrbit.targetYaw += event.key === "ArrowLeft" ? -0.18 : 0.18;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      cameraRail.desiredY = THREE.MathUtils.clamp(
        cameraRail.desiredY + (event.key === "ArrowDown" ? -0.8 : 0.8),
        cameraRail.minY,
        cameraRail.maxY,
      );
    }
  }
  canvas.addEventListener("keydown", handleCanvasKeydown);

  new GLTFLoader().load(
    assets.model,
    (gltf) => {
      if (disposed) return;
      icebergRoot.add(gltf.scene);
      icebergRoot.updateWorldMatrix(true, true);
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          stretchUnderwaterGeometry(child);
          child.material = iceMaterial;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      icebergRoot.updateWorldMatrix(true, true);
      const icebergBounds = new THREE.Box3().setFromObject(icebergRoot, true);
      const shadowCenter = icebergBounds.getCenter(new THREE.Vector3());
      const shadowRadius = icebergBounds.getSize(new THREE.Vector3()).length() * 0.55;
      sun.target.position.copy(shadowCenter);
      scene.add(sun.target);
      sun.position.copy(shadowCenter).add(
        new THREE.Vector3(-10, 7, 3).normalize().multiplyScalar(shadowRadius * 2),
      );
      Object.assign(sun.shadow.camera, {
        left: -shadowRadius,
        right: shadowRadius,
        top: shadowRadius,
        bottom: -shadowRadius,
        near: 0.1,
        far: shadowRadius * 4,
      });
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
      ocean.setIcebergBounds(icebergBounds);
      framingBounds = icebergBounds.clone();
      frameIcebergForScrolling(icebergBounds);
      itemLabels.setIceberg(icebergRoot, icebergBounds, waterLevel);
      loading.classList.add("aleyan-iceberg__loading--complete");
      loadingText.textContent = "Iceberg loaded";
      loadingRemoveTimer = setTimeout(() => loading.remove(), 600);
      resolveReady();
    },
    undefined,
    (error) => {
      if (disposed) return;
      loading.classList.add("aleyan-iceberg__loading--complete");
      loadingText.textContent = "Unable to load the iceberg";
      rejectReady(error);
    },
  );

  const timer = new THREE.Timer();
  timer.connect(document);

  function renderFrame(timestamp: number) {
    timer.update(timestamp);
    const elapsed = timer.getElapsed();
    if (cameraRail.ready) {
      cameraTarget.y += (cameraRail.desiredY - cameraTarget.y) * 0.12;
    }
    cameraOrbit.yaw = THREE.MathUtils.lerp(cameraOrbit.yaw, cameraOrbit.targetYaw, 0.14);
    cameraOrbit.pitch = THREE.MathUtils.lerp(cameraOrbit.pitch, cameraOrbit.targetPitch, 0.14);
    const horizontalDistance = Math.cos(cameraOrbit.pitch) * cameraOrbit.distance;
    camera.position.set(
      cameraTarget.x + Math.sin(cameraOrbit.yaw) * horizontalDistance,
      cameraTarget.y + Math.sin(cameraOrbit.pitch) * cameraOrbit.distance,
      cameraTarget.z + Math.cos(cameraOrbit.yaw) * horizontalDistance,
    );
    camera.lookAt(cameraTarget);
    camera.updateMatrixWorld();
    renderer.getDrawingBufferSize(drawingBufferSize);
    ocean.update(
      camera,
      cameraTarget,
      cameraOrbit.distance,
      cameraOrbit.yaw,
      stillFrame ? 12 : elapsed,
      drawingBufferSize,
    );
    itemLabels.update(camera, width, height);
    renderer.render(scene, camera);
  }

  function resize() {
    const bounds = host.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (framingBounds) frameIcebergForScrolling(framingBounds, true);
    // Changing the drawing buffer clears it. Repaint synchronously so the
    // browser cannot present the transparent canvas between resize and RAF.
    renderFrame(performance.now());
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  renderer.setAnimationLoop(renderFrame);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(loadingRemoveTimer);
    resizeObserver.disconnect();
    renderer.setAnimationLoop(null);
    timer.dispose();
    host.removeEventListener("wheel", handleIcebergScroll);
    host.removeEventListener("pointerdown", beginTouchNavigation);
    host.removeEventListener("pointermove", updateTouchNavigation);
    host.removeEventListener("pointerup", endTouchNavigation);
    host.removeEventListener("pointercancel", endTouchNavigation);
    host.removeEventListener("click", preventDraggedTouchClick, true);
    itemLabels.dispose();
    canvas.removeEventListener("keydown", handleCanvasKeydown);
    canvas.removeEventListener("pointerdown", beginViewRotation);
    canvas.removeEventListener("pointermove", updateViewRotation);
    canvas.removeEventListener("pointerup", endViewRotation);
    canvas.removeEventListener("pointercancel", endViewRotation);
    canvas.removeEventListener("lostpointercapture", endViewRotation);
    icebergGeometries.forEach((geometry) => geometry.dispose());
    ocean.dispose();
    iceMaterial.dispose();
    sun.shadow.map?.dispose();
    panoramaTexture?.dispose();
    environmentTarget.dispose();
    pmrem.dispose();
    scene.background = null;
    scene.environment = null;
    renderer.dispose();
    canvas.remove();
    hint.remove();
    loading.remove();
    if (addedHostClass) host.classList.remove("aleyan-iceberg");
    if (previousAriaLabel === null) host.removeAttribute("aria-label");
    else host.setAttribute("aria-label", previousAriaLabel);
  }

  return { ready, dispose };
}
