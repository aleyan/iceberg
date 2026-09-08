import * as THREE from 'three';
import { placeFrontLabels, type IcebergView } from './view.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { createItemText } from './item-text.js';
import { arrangeItems, slugFromQuery, type IcebergItem } from './item-data.js';

type Placement = { item: IcebergItem; position: THREE.Vector3; angle: number };
type Label = Placement & { element: HTMLElement; button: HTMLButtonElement; details: HTMLElement; width: number; height: number; detailHeight: number };
let labelSetId = 0;

// Support the catalogue's inline code without interpreting arbitrary HTML.
function appendText(element: HTMLElement, text: string, atomicWords = false) {
  text.split(/(`[^`]+`)/g).forEach(part => {
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      element.append(code);
    } else if (atomicWords) {
      part.split(/(\s+)/).filter(Boolean).forEach(token => {
        if (/^\s+$/.test(token)) element.append(document.createTextNode(token));
        else {
          const word = document.createElement('span');
          word.textContent = token;
          element.append(word);
        }
      });
    } else element.append(document.createTextNode(part));
  });
}

export function createItemLabels(
  host: HTMLElement,
  scene: THREE.Scene,
  sourceItems: readonly IcebergItem[],
  navigate: (position: THREE.Vector3, angle: number, instant: boolean) => void,
  setVerticalRange: (
    minimum: number,
    maximum: number,
    positions: readonly THREE.Vector3[],
  ) => void,
  options: {
    view: IcebergView;
    aboveWaterLabelStretch: number;
    ariaLabel: string;
    deepestLabelSpan: () => number;
    initialItem?: string;
    syncUrl: boolean;
  },
) {
  let view = options.view;
  const instanceId = ++labelSetId;
  const layer = document.createElement('section');
  layer.className = 'iceberg-viewer__item-layer';
  layer.setAttribute('aria-label', options.ariaLabel);
  const status = document.createElement('div');
  status.className = 'iceberg-viewer__item-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  const items = [...sourceItems];
  let labels: Label[] = [];
  let mesh: THREE.Object3D | undefined;
  let bounds: THREE.Box3 | undefined;
  let waterLevel = 0;
  let pinned: string | null = null;
  let preview: string | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = true;
  let navigating = false;
  let initialNavigation = true;
  const lastMatrix = new THREE.Matrix4();
  let lastWidth = 0, lastHeight = 0;
  const projected = new THREE.Vector3();
  const text = createItemText(scene);
  const visibilityRay = new THREE.Raycaster();
  visibilityRay.firstHitOnly = true;
  const rayPoint = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const intersections: THREE.Intersection[] = [];

  function rebuildText() {
    // A centered column can use its available horizontal space instead of
    // wrapping long names into the neighboring row.
    if (view === 'list') layer.style.setProperty('--iceberg-item-width', `${Math.min(440, Math.max(160, host.clientWidth - 32))}px`);
    else layer.style.removeProperty('--iceberg-item-width');
    // Measure every name, including offscreen ones, without exposing the DOM.
    layer.style.visibility = 'hidden';
    labels.forEach(label => { label.element.hidden = false; });
    text.rebuild(labels);
    layer.style.visibility = '';
    dirty = true;
  }
  const measuredLabels = new WeakMap<Element, Label>();
  const measurements = new ResizeObserver(entries => {
    for (const entry of entries) {
      const label = measuredLabels.get(entry.target);
      const box = entry.borderBoxSize[0];
      if (label && entry.target === label.details && box?.blockSize) {
        if (label.detailHeight !== box.blockSize) { label.detailHeight = box.blockSize; dirty = true; }
        continue;
      }
      if (label && box?.inlineSize && (label.width !== box.inlineSize || label.height !== box.blockSize)) {
        label.width = box.inlineSize; label.height = box.blockSize; dirty = true;
      }
    }
  });

  function updateExpansion() {
    const active = pinned ?? preview;
    for (const label of labels) {
      const expanded = label.item.slug === active;
      label.element.classList.toggle('is-pinned', label.item.slug === pinned);
      if (label.details.hidden === expanded) {
        label.element.classList.toggle('is-expanded', expanded);
        label.button.setAttribute('aria-expanded', String(expanded));
        label.details.hidden = !expanded;
      }
    }
    dirty = true;
  }

  function writeUrl(slug: string | null) {
    if (!options.syncUrl) return;
    const url = new URL(window.location.href);
    for (const item of items) if (url.searchParams.get(item.slug) === '') url.searchParams.delete(item.slug);
    if (slug) url.searchParams.set('item', slug);
    else url.searchParams.delete('item');
    if (url.href !== window.location.href) history.pushState(null, '', url);
  }

  function close() {
    pinned = null;
    preview = null;
    clearTimeout(leaveTimer);
    writeUrl(null);
    updateExpansion();
  }

  function restoreUrl() {
    if (!labels.length) return;
    const slug = options.syncUrl
      ? slugFromQuery(location.search, new Set(items.map(item => item.slug)))
      : options.initialItem ?? null;
    const label = labels.find(label => label.item.slug === slug);
    pinned = label?.item.slug ?? null;
    preview = null;
    status.hidden = !slug || !!label;
    status.textContent = label || !slug ? '' : `This iceberg has no item named “${slug}”.`;
    if (label) {
      navigate(label.position, label.angle, initialNavigation);
    }
    initialNavigation = false;
    updateExpansion();
  }

  function rebuild(restoreSelection = true) {
    if (!mesh || !bounds || !items.length) return;
    const box = bounds;
    const center = box.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.hypot(size.x, size.z);
    const ray = new THREE.Raycaster();
    const direction = new THREE.Vector3();
    measurements.disconnect();
    layer.replaceChildren();
    let placements = arrangeItems(
      items,
      waterLevel,
      bounds.max.y,
      bounds.min.y,
      options.aboveWaterLabelStretch,
      options.deepestLabelSpan(),
    );
    if (view !== 'orbit') placements = placeFrontLabels(placements, view);
    labels = placements.map(({ item, y, angle }) => {
      direction.set(Math.sin(angle), 0, Math.cos(angle));
      const origin = new THREE.Vector3(center.x, y, center.z).addScaledVector(direction, radius);
      ray.set(origin, direction.clone().negate());
      // One-time mesh queries, never per animation frame.
      const hit = y >= box.min.y ? ray.intersectObject(mesh!, true)[0] : undefined;
      const above = Math.max(0, y - box.max.y);
      const below = Math.max(0, box.min.y - y);
      const upperSpread = item.obscurity_bucket === 1
        ? 1.7 + THREE.MathUtils.clamp((y - waterLevel) / Math.max(1, box.max.y - waterLevel), 0, 1) * 0.8
        : 1.15;
      // Beyond either end of the mesh, continue the silhouette as a broad
      // ring/cone so those labels retain the spacing the shell provided.
      const fallbackRadius = below > 0
        ? size.x * 0.34 + below * 0.16
        : size.x * (0.29 + Math.min(above, 2) * 0.04);
      const position = view === 'list'
        ? new THREE.Vector3(center.x, y, box.max.z + 1.15)
        : hit ? hit.point.clone().addScaledVector(direction, upperSpread)
        : new THREE.Vector3(center.x, y, center.z).addScaledVector(direction, fallbackRadius);

      const element = document.createElement('article');
      element.className = 'iceberg-viewer__item';
      element.hidden = true;
      element.dataset.slug = item.slug;
      element.dataset.bucket = String(item.obscurity_bucket);
      element.dataset.worldY = String(position.y);
      element.dataset.angle = String(angle);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'iceberg-viewer__item-name';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', `iceberg-${instanceId}-detail-${item.slug}`);
      appendText(button, item.name, true);

      const details = document.createElement('div');
      details.id = `iceberg-${instanceId}-detail-${item.slug}`;
      details.className = 'iceberg-viewer__item-details';
      details.hidden = true;
      const title = document.createElement('h3');
      title.className = 'iceberg-viewer__item-detail-title';
      appendText(title, item.name);
      const description = document.createElement('p');
      appendText(description, item.short_description);
      const footer = document.createElement('div');
      footer.className = 'iceberg-viewer__item-footer';
      const source = document.createElement('a');
      source.href = item.url;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Read source';
      source.setAttribute('aria-label', `Source for ${item.name.replaceAll('`', '')} (opens in a new tab)`);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'iceberg-viewer__item-close';
      dismiss.textContent = 'Close';
      dismiss.addEventListener('click', () => {
        close();
        host.querySelector('canvas')?.focus({ preventScroll: true });
      });
      footer.append(source, dismiss);
      details.append(title, description, footer);
      element.append(button, details);
      element.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch' || navigating) return;
        clearTimeout(leaveTimer);
        if (!pinned) { preview = item.slug; updateExpansion(); }
      });
      element.addEventListener('pointerleave', () => {
        leaveTimer = setTimeout(() => { if (!pinned) { preview = null; updateExpansion(); } }, 160);
      });
      button.addEventListener('focus', () => {
        if (!pinned) { preview = item.slug; updateExpansion(); }
      });
      element.addEventListener('focusout', event => {
        if (!element.contains(event.relatedTarget as Node) && !pinned) { preview = null; updateExpansion(); }
      });
      button.addEventListener('click', () => {
        if (pinned === item.slug) close();
        else { pinned = item.slug; preview = null; writeUrl(pinned); updateExpansion(); }
      });
      layer.append(element);
      const label = { item, angle, position, element, button, details, width: 210, height: 44, detailHeight: 260 };
      measuredLabels.set(button, label);
      measurements.observe(button);
      measuredLabels.set(details, label);
      measurements.observe(details);
      return label;
    });
    setVerticalRange(
      Math.min(...labels.map(label => label.position.y)),
      Math.max(...labels.map(label => label.position.y)),
      labels.map(label => label.position.clone()),
    );
    rebuildText();
    if (restoreSelection) restoreUrl();
    else {
      updateExpansion();
      const active = labels.find(label => label.item.slug === pinned);
      if (active) navigate(active.position, active.angle, true);
    }
    dirty = true;
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') close();
  }
  // Finish initialization before attaching DOM, so a failed constructor (for
  // example ResizeObserver) cannot leave an unowned layer in the host.
  host.append(layer, status);
  if (options.syncUrl) window.addEventListener('popstate', restoreUrl);
  window.addEventListener('keydown', onKey);

  return {
    setNavigating(active: boolean) {
      navigating = active;
      if (active && preview) {
        preview = null;
        clearTimeout(leaveTimer);
        updateExpansion();
      }
    },
    setView(next: IcebergView) {
      view = next;
      preview = null;
      clearTimeout(leaveTimer);
      rebuild(false);
    },
    setIceberg(object: THREE.Object3D, box: THREE.Box3, water: number) {
      mesh = object;
      object.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.boundsTree ??= new MeshBVH(child.geometry, { indirect: true });
          child.raycast = acceleratedRaycast;
        }
      });
      bounds = box.clone();
      waterLevel = water;
      rebuild();
    },
    update(camera: THREE.PerspectiveCamera, width: number, height: number) {
      const resized = width !== lastWidth || height !== lastHeight;
      if (!dirty && !resized && lastMatrix.equals(camera.matrixWorld)) return;
      if (resized && labels.length) rebuildText();
      dirty = false;
      lastWidth = width; lastHeight = height;
      if (resized) layer.style.setProperty('--iceberg-card-width', `${Math.min(320, Math.max(160, width - 32))}px`);
      lastMatrix.copy(camera.matrixWorld);
      text.resize(width, height);
      function clearAt(x: number, y: number, depth: number) {
        rayPoint.set(x / width * 2 - 1, 1 - y / height * 2, depth).unproject(camera);
        rayDirection.subVectors(rayPoint, camera.position);
        visibilityRay.far = Math.max(0, rayDirection.length() - 0.015);
        visibilityRay.set(camera.position, rayDirection.normalize());
        intersections.length = 0;
        if (mesh) visibilityRay.intersectObject(mesh, true, intersections);
        return intersections.length === 0;
      }
      for (const label of labels) {
        projected.copy(label.position).project(camera);
        const x = (projected.x + 1) * width / 2;
        const y = (1 - projected.y) * height / 2;
        const inFrame = projected.z > -1 && projected.z < 1
          && x + label.width / 2 > 0 && x - label.width / 2 < width
          && y - 16 + label.height > 0 && y - 16 < height;
        // These rays govern hit targets only. Visual clipping is per-pixel in
        // the GPU depth buffer: no angular, crowding, or viewport inset cutoff.
        const exposed = inFrame && clearAt(x, y - 16 + label.height / 2, projected.z);
        if (label.element.hidden === exposed) label.element.hidden = !exposed;
        if (!exposed) continue;
        const transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
        if (label.element.style.transform !== transform) label.element.style.transform = transform;
        if (label.details.hidden) continue;
        const halfCard = Math.min(320, width - 32) / 2;
        const cardX = THREE.MathUtils.clamp(x, halfCard + 16, width - halfCard - 16) - x;
        label.element.style.setProperty('--card-offset', `${cardX}px`);
        const nameTop = y - 16;
        const belowTop = nameTop + label.height + 4;
        const preferredTop = belowTop + label.detailHeight <= height - 12
          ? belowTop : nameTop - label.detailHeight - 4;
        const cardTop = THREE.MathUtils.clamp(preferredTop, 12, Math.max(12, height - label.detailHeight - 12));
        label.element.style.setProperty('--card-y', `${cardTop - nameTop}px`);
      }
    },
    dispose() {
      measurements.disconnect();
      text.dispose();
      clearTimeout(leaveTimer);
      if (options.syncUrl) window.removeEventListener('popstate', restoreUrl);
      window.removeEventListener('keydown', onKey);
      layer.remove(); status.remove();
    },
  };
}
