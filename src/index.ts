import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { createStretchedIcebergGeometry } from "./ice-geometry.js";
import { createIceMaterial } from "./ice-material.js";
import { createItemLabels } from "./item-labels.js";
import { createOcean } from "./ocean.js";
import type { IcebergItem } from "./item-data.js";
import { createViewSelector } from "./view-selector.js";
import { easeCamera } from "./navigation.js";
import { createLifecycle } from "./lifecycle.js";
import { createAnimationLoop } from "./animation-loop.js";

import { assertView, constrainYaw, icebergViews, type IcebergView } from "./view.js";
export { icebergViews, type IcebergView } from "./view.js";

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
  /** Initial layout; defaults to orbit. */
  view?: IcebergView;
  /** Show the built-in view selector; defaults to false. */
  viewSelector?: boolean;
  onViewChange?: (view: IcebergView) => void;
  aboveWaterLabelStretch?: number;
  assets?: Partial<IcebergAssets>;
  ariaLabel?: string;
  canvasAriaLabel?: string;
  descentPrompt?: string | false;
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
  /** Resolves when populated; rejects on loading failure or with AbortError if disposed first. */
  readonly ready: Promise<void>;
  readonly availableViews: typeof icebergViews;
  readonly view: IcebergView;
  setView(view: IcebergView): void;
  /** Stops rendering, removes listeners and generated DOM, and releases GPU resources. */
  dispose(): void;
}

export const defaultIcebergAssets: Readonly<IcebergAssets> = Object.freeze({
  model: new URL("../assets/models/iceberg-web.glb", import.meta.url).href,
  environment: new URL("../assets/environment/ocean-panorama.hdr", import.meta.url).href,
  sky: new URL("../assets/environment/polar-cirrus.webp", import.meta.url).href,
  relief: new URL("../assets/textures/glacial-relief.webp", import.meta.url).href,
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

  const lifecycle = createLifecycle();
  try {
    return initializeIceberg(host, options, lifecycle);
  } catch (error) {
    lifecycle.fail(error);
    throw error;
  }
}

function initializeIceberg(
  host: HTMLElement,
  options: IcebergOptions,
  lifecycle: ReturnType<typeof createLifecycle>,
): IcebergController {
  const { ready, resolveReady, onCleanup, dispose } = lifecycle;

  let view = options.view ?? "orbit";
  assertView(view);
  const previousView = host.getAttribute("data-iceberg-view");
  host.dataset.icebergView = view;
  onCleanup(() => {
    if (previousView === null) host.removeAttribute("data-iceberg-view");
    else host.setAttribute("data-iceberg-view", previousView);
  });

  const waterLevel = options.waterLevel ?? -0.72;
  const underwaterStretch = THREE.MathUtils.clamp(options.underwaterStretch ?? 2, 1, 4);
  const overview = options.overview ?? false;
  const stillFrame = options.stillFrame ?? false;
  const assets = { ...defaultIcebergAssets, ...options.assets };
  const addedHostClass = !host.classList.contains("iceberg-viewer");
  const previousAriaLabel = host.getAttribute("aria-label");
  onCleanup(() => {
    if (addedHostClass) host.classList.remove("iceberg-viewer");
    if (previousAriaLabel === null) host.removeAttribute("aria-label");
    else host.setAttribute("aria-label", previousAriaLabel);
  });
  host.classList.add("iceberg-viewer");
  host.setAttribute(
    "aria-label",
    options.ariaLabel ?? "Interactive three-dimensional iceberg",
  );

  const canvas = document.createElement("canvas");
  canvas.className = "iceberg-viewer__canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    options.canvasAriaLabel
      ?? "Explore the iceberg. Click or tab here, then use arrows or Page Up and Page Down to descend; drag or use left and right arrows to rotate.",
  );

  const hint = document.createElement("div");
  hint.className = "iceberg-viewer__hint";
  hint.textContent = options.hint === false ? "" : options.hint ?? DEFAULT_HINT;
  hint.hidden = options.hint === false;

  const descentPrompt = document.createElement("div");
  descentPrompt.className = "iceberg-viewer__descent-prompt";
  descentPrompt.setAttribute("aria-hidden", "true");
  const descentPromptText = document.createElement("span");
  descentPromptText.textContent = options.descentPrompt === false
    ? ""
    : options.descentPrompt ?? "Scroll down to explore below the water line.";
  const descentPromptArrow = document.createElement("span");
  descentPromptArrow.className = "iceberg-viewer__descent-prompt-arrow";
  descentPromptArrow.setAttribute("aria-hidden", "true");
  descentPromptArrow.textContent = "↓︎";
  descentPrompt.append(descentPromptText, descentPromptArrow);
  descentPrompt.hidden = options.descentPrompt === false;

  const loading = document.createElement("div");
  loading.className = "iceberg-viewer__loading";
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  const loadingBar = document.createElement("span");
  loadingBar.className = "iceberg-viewer__loading-bar";
  const loadingText = document.createElement("span");
  loadingText.className = "iceberg-viewer__sr-only";
  loadingText.textContent = "Loading iceberg";
  loading.append(loadingBar, loadingText);
  host.append(canvas, hint, descentPrompt, loading);
  onCleanup(() => {
    canvas.remove();
    hint.remove();
    descentPrompt.remove();
    loading.remove();
  });

  const viewSelector = createViewSelector(view, setView);
  const selector = viewSelector.element;
  if (options.viewSelector) host.append(selector);
  onCleanup(() => viewSelector.dispose());
  let hostDocumentTop = 0;
  function updateOverlayBounds() {
    const bounds = host.getBoundingClientRect();
    hostDocumentTop = bounds.top + window.scrollY;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const top = Math.max(0, viewportTop - bounds.top);
    selector.style.top = `${Math.min(Math.max(16, bounds.height - 60), top + 16)}px`;
  }
  window.addEventListener("scroll", updateOverlayBounds, { passive: true });
  window.visualViewport?.addEventListener("resize", updateOverlayBounds);
  window.visualViewport?.addEventListener("scroll", updateOverlayBounds);
  onCleanup(() => {
    window.removeEventListener("scroll", updateOverlayBounds);
    window.visualViewport?.removeEventListener("resize", updateOverlayBounds);
    window.visualViewport?.removeEventListener("scroll", updateOverlayBounds);
  });

  let animation: ReturnType<typeof createAnimationLoop> | undefined;
  let loadingRemoveTimer: ReturnType<typeof setTimeout> | undefined;
  let descentPromptTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(loadingRemoveTimer);
    clearTimeout(descentPromptTimer);
  });
  let descentPromptDismissed = false;
  let width = 1;
  let height = 1;

  const scene = new THREE.Scene();
  scene.background = null;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  onCleanup(() => {
    animation?.dispose();
    renderer.dispose();
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const pmrem = new THREE.PMREMGenerator(renderer);
  onCleanup(() => pmrem.dispose());
  pmrem.compileEquirectangularShader();
  const room = new RoomEnvironment();
  let environmentTarget: THREE.WebGLRenderTarget;
  try {
    environmentTarget = pmrem.fromScene(room, 0.04);
  } finally {
    room.dispose();
  }
  let panoramaTexture: THREE.DataTexture | null = null;
  onCleanup(() => {
    panoramaTexture?.dispose();
    environmentTarget.dispose();
    scene.environment = null;
  });
  scene.environment = environmentTarget.texture;

  new HDRLoader().load(
    assets.environment,
    (texture) => {
      if (lifecycle.disposed) {
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
      if (!lifecycle.disposed) console.warn("Unable to load the HDR environment", error);
      pmrem.dispose();
    },
  );

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
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
  let touchInertiaActive = false;
  let touchVelocityY = 0;
  let touchVelocityYaw = 0;
  let touchLastMoveTime = 0;

  function dismissDescentPrompt() {
    if (descentPromptDismissed) return;
    descentPromptDismissed = true;
    clearTimeout(descentPromptTimer);
    descentPrompt.classList.remove("iceberg-viewer__descent-prompt--visible");
    descentPrompt.setAttribute("aria-hidden", "true");
  }

  function scheduleDescentPrompt() {
    if (options.descentPrompt === false || descentPromptDismissed) return;
    descentPromptTimer = setTimeout(() => {
      if (lifecycle.disposed || descentPromptDismissed || !cameraRail.ready) return;
      if (Math.abs(cameraRail.desiredY - cameraRail.maxY) > 0.01) return;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
      const hostBounds = host.getBoundingClientRect();
      if (hostBounds.top >= viewportBottom || hostBounds.bottom <= viewportTop) return;
      descentPrompt.style.setProperty(
        "--iceberg-descent-prompt-viewport-offset",
        `${Math.max(0, hostBounds.bottom - viewportBottom)}px`,
      );
      descentPrompt.classList.add("iceberg-viewer__descent-prompt--visible");
      descentPrompt.setAttribute("aria-hidden", "false");
    }, 5000);
  }

  function beginViewRotation(event: PointerEvent) {
    if (event.pointerType === "touch" || event.button !== 0 || viewDrag.dragging) return;
    event.preventDefault();
    // preventDefault suppresses the canvas's native mouse focus. Keep keyboard
    // navigation available after clicking, including with a wheel-less mouse.
    canvas.focus({ preventScroll: true });
    viewDrag.dragging = true;
    viewDrag.pointerId = event.pointerId;
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }

  function updateViewRotation(event: PointerEvent) {
    if (event.pointerType === "touch"
      || !viewDrag.dragging
      || event.pointerId !== viewDrag.pointerId) return;
    const deltaX = event.clientX - viewDrag.lastX;
    const deltaY = event.clientY - viewDrag.lastY;
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    cameraOrbit.targetYaw = constrainYaw(view, cameraOrbit.targetYaw - deltaX * 0.006);
    cameraOrbit.targetPitch = view === "list" ? 0 : THREE.MathUtils.clamp(
      cameraOrbit.targetPitch + deltaY * 0.002,
      -maxViewPitch,
      maxViewPitch,
    );
  }

  function endViewRotation(event: PointerEvent) {
    if (event.pointerType === "touch"
      || !viewDrag.dragging
      || event.pointerId !== viewDrag.pointerId) return;
    viewDrag.dragging = false;
    viewDrag.pointerId = -1;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function beginTouchNavigation(event: PointerEvent) {
    if (event.pointerType !== "touch" || viewDrag.dragging
      || (event.target instanceof Element && event.target.closest(".iceberg-viewer__view-selector"))) return;
    viewDrag.dragging = true;
    viewDrag.pointerId = event.pointerId;
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    touchTravel = 0;
    touchInertiaActive = false;
    touchVelocityY = 0;
    touchVelocityYaw = 0;
    touchLastMoveTime = event.timeStamp;
    cameraRail.desiredY = cameraTarget.y;
    cameraOrbit.targetYaw = cameraOrbit.yaw;
    host.setPointerCapture(event.pointerId);
  }

  function updateTouchNavigation(event: PointerEvent) {
    if (event.pointerType !== "touch"
      || !viewDrag.dragging
      || event.pointerId !== viewDrag.pointerId) return;
    const deltaX = event.clientX - viewDrag.lastX;
    const deltaY = event.clientY - viewDrag.lastY;
    const deltaTime = THREE.MathUtils.clamp(event.timeStamp - touchLastMoveTime, 1, 64);
    viewDrag.lastX = event.clientX;
    viewDrag.lastY = event.clientY;
    touchLastMoveTime = event.timeStamp;
    touchTravel += Math.hypot(deltaX, deltaY);
    if (touchTravel < 4) return;
    event.preventDefault();
    dismissDescentPrompt();
    cameraOrbit.yaw = constrainYaw(view, cameraOrbit.yaw - deltaX * 0.006);
    cameraOrbit.targetYaw = cameraOrbit.yaw;
    const worldUnitsPerPixel = 2 * cameraOrbit.distance
      * Math.tan(verticalFov / 2) / Math.max(1, height);
    touchVelocityYaw = THREE.MathUtils.lerp(
      touchVelocityYaw,
      -deltaX * 0.006 / deltaTime,
      0.6,
    );
    touchVelocityY = THREE.MathUtils.lerp(
      touchVelocityY,
      deltaY * worldUnitsPerPixel / deltaTime,
      0.6,
    );
    const nextY = THREE.MathUtils.clamp(
      cameraTarget.y + deltaY * worldUnitsPerPixel,
      cameraRail.minY,
      cameraRail.maxY,
    );
    cameraTarget.y = nextY;
    cameraRail.desiredY = nextY;
  }

  function endTouchNavigation(event: PointerEvent) {
    if (event.pointerType !== "touch"
      || !viewDrag.dragging
      || event.pointerId !== viewDrag.pointerId) return;
    suppressTouchClick = touchTravel >= 4;
    if (event.timeStamp - touchLastMoveTime > 80) {
      touchVelocityY = 0;
      touchVelocityYaw = 0;
    }
    touchInertiaActive = suppressTouchClick
      && (Math.abs(touchVelocityY) > 0.0005 || Math.abs(touchVelocityYaw) > 0.00002);
    viewDrag.dragging = false;
    viewDrag.pointerId = -1;
    touchTravel = 0;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
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
  onCleanup(() => {
    canvas.removeEventListener("pointerdown", beginViewRotation);
    canvas.removeEventListener("pointermove", updateViewRotation);
    canvas.removeEventListener("pointerup", endViewRotation);
    canvas.removeEventListener("pointercancel", endViewRotation);
    canvas.removeEventListener("lostpointercapture", endViewRotation);
    host.removeEventListener("pointerdown", beginTouchNavigation);
    host.removeEventListener("pointermove", updateTouchNavigation);
    host.removeEventListener("pointerup", endTouchNavigation);
    host.removeEventListener("pointercancel", endTouchNavigation);
    host.removeEventListener("click", preventDraggedTouchClick, true);
  });

  const hemi = new THREE.HemisphereLight(0xc6e3ff, 0x061431, 0.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff7e9, 2.8);
  onCleanup(() => sun.shadow.map?.dispose());
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
  onCleanup(() => iceMaterial.dispose());
  const ocean = createOcean(scene, waterLevel, assets.sky, overview);
  onCleanup(() => ocean.dispose());
  const drawingBufferSize = new THREE.Vector2();
  const icebergGeometries = new Set<THREE.BufferGeometry>();
  onCleanup(() => icebergGeometries.forEach((geometry) => geometry.dispose()));

  function stretchUnderwaterGeometry(mesh: THREE.Mesh) {
    mesh.updateWorldMatrix(true, false);
    const geometry = createStretchedIcebergGeometry(
      mesh.geometry,
      mesh.matrixWorld.clone(),
      waterLevel,
      underwaterStretch,
    );
    if (!geometry) return;
    mesh.geometry = geometry;
    icebergGeometries.add(geometry);
  }

  let framingBounds: THREE.Box3 | null = null;
  let itemMaximumY: number | null = null;
  let itemPositions: readonly THREE.Vector3[] = [];
  let halfViewHeight = 1;

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
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const horizontalRadius = Math.hypot(icebergSize.x * 0.5, icebergSize.z * 0.5);
    const distance = overview
      ? Math.max(
          horizontalRadius / Math.sin(horizontalFov / 2) * 1.1,
          icebergSize.y / (2 * Math.tan(verticalFov / 2)) * 1.2,
        )
      : horizontalRadius / Math.sin(horizontalFov / 2) * 1.1;
    halfViewHeight = distance * Math.tan(verticalFov / 2);
    const meshFocusY = overview
      ? center.y + icebergSize.y * 0.035
      : waterLevel + halfViewHeight * 0.5;
    const outwardX = Math.sin(cameraOrbit.yaw);
    const outwardZ = Math.cos(cameraOrbit.yaw);
    // Reserve enough room for the label's center and its 16px negative
    // offset. NDC spans two screen halves, so a pixel inset needs a factor
    // of two here.
    const topLabelCenterInset = 72;
    const labelNdcLimit = Math.max(0.1, 1 - topLabelCenterInset * 2 / height);
    const labelFocusY = itemPositions.length > 0
      ? Math.max(...itemPositions.map(position => {
          const outwardDepth = (position.x - center.x) * outwardX
            + (position.z - center.z) * outwardZ;
          const viewDepth = Math.max(camera.near, distance - outwardDepth);
          return position.y - viewDepth * Math.tan(verticalFov / 2) * labelNdcLimit;
        }))
      : itemMaximumY === null
        ? meshFocusY
        : itemMaximumY - halfViewHeight * 0.8;
    const bottomLabelFocusY = itemPositions.length > 0
      ? Math.min(...itemPositions.map(position => {
          const outwardDepth = (position.x - center.x) * outwardX
            + (position.z - center.z) * outwardZ;
          const viewDepth = Math.max(camera.near, distance - outwardDepth);
          return position.y + viewDepth * Math.tan(verticalFov / 2) * labelNdcLimit;
        }))
      : icebergBounds.min.y;
    const initialFocusY = Math.max(meshFocusY, labelFocusY);
    cameraTarget.set(center.x, initialFocusY, center.z);
    cameraOrbit.distance = distance;
    camera.far = Math.max(12000, distance + icebergSize.length() * 2);
    camera.updateProjectionMatrix();
    cameraRail.maxY = initialFocusY;
    cameraRail.minY = Math.min(
      initialFocusY,
      icebergBounds.min.y - halfViewHeight * 0.94,
      bottomLabelFocusY,
    );
    cameraRail.desiredY = preserveDepth
      ? THREE.MathUtils.lerp(cameraRail.maxY, cameraRail.minY, previousDepth)
      : initialFocusY;
    cameraTarget.y = cameraRail.desiredY;
    cameraRail.ready = true;
  }

  function handleIcebergScroll(event: WheelEvent) {
    if (event.target instanceof Element && event.target.closest(".iceberg-viewer__view-selector")) return;
    dismissDescentPrompt();
    if (!cameraRail.ready) return;
    const verticalPixels = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * height
        : event.deltaY;
    const horizontalPixels = event.deltaMode === 1
      ? event.deltaX * 16
      : event.deltaMode === 2
        ? event.deltaX * width
        : event.deltaX;
    if (Math.abs(horizontalPixels) > 0.01) {
      // Trackpads report the content-scroll direction, which is opposite the
      // fingers' motion. Reverse it so a horizontal gesture feels like drag.
      cameraOrbit.targetYaw = constrainYaw(view, cameraOrbit.targetYaw + horizontalPixels * 0.006);
      event.preventDefault();
    }
    // Let an embedding page move the viewer to the top edge before the
    // iceberg starts consuming downward scroll.
    if (verticalPixels > 0 && hostDocumentTop - window.scrollY > 0.5) return;
    const nextY = THREE.MathUtils.clamp(
      cameraRail.desiredY - verticalPixels * 0.008,
      cameraRail.minY,
      cameraRail.maxY,
    );
    // Embedded icebergs should release the page scroll at either end.
    if (nextY === cameraRail.desiredY && cameraTarget.y === nextY) return;
    event.preventDefault();
    cameraRail.desiredY = nextY;
  }
  host.addEventListener("wheel", handleIcebergScroll, { passive: false, capture: true });
  onCleanup(() => host.removeEventListener("wheel", handleIcebergScroll, true));

  const itemLabels = createItemLabels(
    host,
    scene,
    options.items,
    (position, angle, instant) => {
      const targetY = THREE.MathUtils.clamp(position.y, cameraRail.minY, cameraRail.maxY);
      cameraRail.desiredY = targetY;
      const turn = Math.atan2(
        Math.sin(angle - cameraOrbit.yaw),
        Math.cos(angle - cameraOrbit.yaw),
      );
      cameraOrbit.targetYaw = constrainYaw(view, view === "orbit" ? cameraOrbit.yaw + turn : 0);
      cameraOrbit.targetPitch = 0;
      if (instant) {
        cameraTarget.y = targetY;
        cameraOrbit.yaw = cameraOrbit.targetYaw;
        cameraOrbit.pitch = 0;
      }
    },
    (_minimum, maximum, positions) => {
      itemMaximumY = maximum;
      itemPositions = positions;
      if (framingBounds) frameIcebergForScrolling(framingBounds, true);
    },
    {
      view,
      aboveWaterLabelStretch: options.aboveWaterLabelStretch ?? 1,
      ariaLabel: options.itemsAriaLabel ?? "Iceberg items",
      deepestLabelSpan: () => halfViewHeight * 1.65,
      initialItem: options.initialItem,
      syncUrl: options.syncUrl ?? true,
    },
  );

  onCleanup(() => itemLabels.dispose());
  function updateViewInterface() {
    host.dataset.icebergView = view;
    viewSelector.update(view);
    if (options.hint === undefined) hint.textContent = view === "list"
      ? "Scroll to descend · Select a name to keep it open"
      : view === "arc" ? "Scroll to descend · Drag to turn 30° · Select a name" : DEFAULT_HINT;
    canvas.setAttribute("aria-label", view === "list"
      ? "Explore the iceberg list. Click or tab here, then scroll or use arrows or Page Up and Page Down to descend. Horizontal rotation is locked."
      : view === "arc" ? "Explore the front of the iceberg. Click or tab here, then scroll or use arrows or Page Up and Page Down to descend; drag or use left and right arrows to rotate within 30 degrees."
      : options.canvasAriaLabel ?? "Explore the iceberg. Click or tab here, then use arrows or Page Up and Page Down to descend; drag or use left and right arrows to rotate.");
  }
  function setView(next: IcebergView) {
    assertView(next);
    if (lifecycle.disposed || next === view) return;
    animation?.wake();
    view = next;
    touchVelocityYaw = 0;
    touchVelocityY = 0;
    touchInertiaActive = false;
    if (viewDrag.pointerId >= 0) {
      if (host.hasPointerCapture(viewDrag.pointerId)) host.releasePointerCapture(viewDrag.pointerId);
      if (canvas.hasPointerCapture(viewDrag.pointerId)) canvas.releasePointerCapture(viewDrag.pointerId);
    }
    viewDrag.dragging = false;
    viewDrag.pointerId = -1;
    cameraOrbit.yaw = cameraOrbit.targetYaw = 0;
    cameraOrbit.pitch = cameraOrbit.targetPitch = 0;
    dismissDescentPrompt();
    updateViewInterface();
    itemLabels.setView(view);
    options.onViewChange?.(view);
  }
  updateViewInterface();
  function handleCanvasKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || !cameraRail.ready) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      cameraOrbit.targetYaw = constrainYaw(view, cameraOrbit.targetYaw + (event.key === "ArrowLeft" ? -0.18 : 0.18));
    } else if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
      event.preventDefault();
      dismissDescentPrompt();
      // Match a 40px line or 85% of the visible page at any camera scale.
      const pageStep = halfViewHeight * 2 * 0.85;
      const lineStep = halfViewHeight * 2 * 40 / height;
      const direction = event.key === "ArrowUp" || event.key === "PageUp" || (event.key === " " && event.shiftKey) ? 1 : -1;
      const step = event.key.startsWith("Arrow") ? lineStep : pageStep;
      cameraRail.desiredY = THREE.MathUtils.clamp(
        event.key === "Home" ? cameraRail.maxY
          : event.key === "End" ? cameraRail.minY
          : cameraRail.desiredY + direction * step,
        cameraRail.minY,
        cameraRail.maxY,
      );
    }
  }
  canvas.addEventListener("keydown", handleCanvasKeydown);
  onCleanup(() => canvas.removeEventListener("keydown", handleCanvasKeydown));

  new GLTFLoader().load(
    assets.model,
    (gltf) => {
      if (lifecycle.disposed) return;
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
      loading.classList.add("iceberg-viewer__loading--complete");
      loadingText.textContent = "Iceberg loaded";
      loadingRemoveTimer = setTimeout(() => loading.remove(), 600);
      scheduleDescentPrompt();
      resolveReady();
    },
    undefined,
    (error) => {
      if (!lifecycle.disposed) lifecycle.fail(error);
    },
  );

  const timer = new THREE.Timer();
  onCleanup(() => timer.dispose());
  timer.connect(document);
  let lastFrameTimestamp = performance.now();

  function renderFrame(timestamp: number) {
    // Exponential camera easing is stable for any elapsed time. Capping it
    // makes a dropped frame slow the animation instead of catching up.
    const frameDelta = Math.max(0, timestamp - lastFrameTimestamp);
    const inertiaDelta = Math.min(frameDelta, 34);
    lastFrameTimestamp = timestamp;
    timer.update(timestamp);
    const elapsed = timer.getElapsed();
    if (touchInertiaActive && cameraRail.ready) {
      const previousY = cameraTarget.y;
      const nextY = THREE.MathUtils.clamp(
        previousY + touchVelocityY * inertiaDelta,
        cameraRail.minY,
        cameraRail.maxY,
      );
      cameraTarget.y = nextY;
      cameraRail.desiredY = nextY;
      cameraOrbit.yaw = constrainYaw(view, cameraOrbit.yaw + touchVelocityYaw * inertiaDelta);
      cameraOrbit.targetYaw = cameraOrbit.yaw;
      if (nextY === previousY && Math.abs(touchVelocityY) > 0) touchVelocityY = 0;
      const decay = Math.exp(-inertiaDelta / 180);
      touchVelocityY *= decay;
      touchVelocityYaw *= decay;
      if (Math.abs(touchVelocityY) < 0.0005 && Math.abs(touchVelocityYaw) < 0.00002) {
        touchVelocityY = 0;
        touchVelocityYaw = 0;
        touchInertiaActive = false;
      }
    }
    if (cameraRail.ready) {
      cameraTarget.y = easeCamera(cameraTarget.y, cameraRail.desiredY, frameDelta, 130);
    }
    cameraOrbit.yaw = easeCamera(cameraOrbit.yaw, cameraOrbit.targetYaw, frameDelta, 110);
    cameraOrbit.pitch = easeCamera(cameraOrbit.pitch, cameraOrbit.targetPitch, frameDelta, 110);
    itemLabels.setNavigating(viewDrag.dragging || touchInertiaActive
      || cameraTarget.y !== cameraRail.desiredY
      || cameraOrbit.yaw !== cameraOrbit.targetYaw
      || cameraOrbit.pitch !== cameraOrbit.targetPitch);
    const horizontalDistance = Math.cos(cameraOrbit.pitch) * cameraOrbit.distance;
    camera.position.set(
      cameraTarget.x + Math.sin(cameraOrbit.yaw) * horizontalDistance,
      cameraTarget.y + Math.sin(cameraOrbit.pitch) * cameraOrbit.distance,
      cameraTarget.z + Math.cos(cameraOrbit.yaw) * horizontalDistance,
    );
    camera.lookAt(cameraTarget);
    camera.updateMatrixWorld();
    itemLabels.update(camera, width, height);
    renderer.getDrawingBufferSize(drawingBufferSize);
    ocean.update(
      camera,
      cameraTarget,
      cameraOrbit.distance,
      cameraOrbit.yaw,
      stillFrame ? 12 : elapsed,
      drawingBufferSize,
    );
    renderer.render(scene, camera);
  }

  function resize() {
    animation?.wake();
    updateOverlayBounds();
    const bounds = host.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (framingBounds) {
      frameIcebergForScrolling(framingBounds, true);
      // Preserve the selected item when a new aspect ratio changes the rail.
      itemLabels.focusPinned();
    }
    // Changing the drawing buffer clears it. Repaint synchronously so the
    // browser cannot present the transparent canvas between resize and RAF.
    renderFrame(performance.now());
  }
  const resizeObserver = new ResizeObserver(resize);
  onCleanup(() => resizeObserver.disconnect());
  resizeObserver.observe(host);
  resize();

  animation = createAnimationLoop(renderFrame);
  const wakeAnimation = () => animation?.wake();
  const activityEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerout", "wheel", "keydown", "click", "focusin"];
  for (const event of activityEvents) host.addEventListener(event, wakeAnimation, { capture: true, passive: true });
  window.addEventListener("popstate", wakeAnimation);
  // Asset completion can change the scene after an unusually slow load.
  void ready.then(wakeAnimation, () => {});
  onCleanup(() => {
    animation?.dispose();
    for (const event of activityEvents) host.removeEventListener(event, wakeAnimation, true);
    window.removeEventListener("popstate", wakeAnimation);
  });

  return { ready, dispose, availableViews: icebergViews, get view() { return view; }, setView };
}
