import { mountIceberg, type IcebergView, type IcebergController, type IcebergItem } from '../../../src/index';
import { DefaultLoadingManager } from 'three';
import '../../../styles.css';

export interface FrameSample { interval: number; work: number }
export interface BrowserFixture {
  controller: IcebergController;
  ready: boolean;
  readonly assetsLoaded: boolean;
  readonly frameCount: number;
  resumeRendering(): Promise<void>;
  pauseRendering(): void;
  startMeasurement(): void;
  endMeasurement(): FrameSample[];
}
declare global { interface Window { icebergTest: BrowserFixture } }

// Measure the real animation callback, not a second timer that can keep passing
// after the renderer has stopped. No production instrumentation is required.
const params = new URLSearchParams(location.search);
const requestFrame = window.requestAnimationFrame.bind(window);
let renderedFrames = 0;
let recording = false;
let previous = 0;
let samples: FrameSample[] = [];
let assetsLoaded = false;
let paused = false;
let pendingFrame: FrameRequestCallback | undefined;
let benchmarkPrepared = false;
let projection = '', stable = 0;
window.requestAnimationFrame = callback => requestFrame(timestamp => {
  if (paused) { pendingFrame = callback; return; }
  const start = performance.now();
  callback(timestamp);
  renderedFrames++;
  if (assetsLoaded && params.has('benchmark') && !benchmarkPrepared) {
    const current = [...document.querySelectorAll<HTMLElement>('.iceberg-viewer__item:not([hidden])')]
      .map(e => e.dataset.slug + ':' + e.style.cssText).join('|');
    stable = current && current === projection ? stable + 1 : 0;
    projection = current;
    if (stable >= 2) { benchmarkPrepared = true; paused = true; }
  }
  if (assetsLoaded) window.icebergTest.ready = !params.has('benchmark') || benchmarkPrepared;
  if (recording) {
    if (previous) samples.push({ interval: timestamp - previous, work: performance.now() - start });
    previous = timestamp;
  }
});

if (params.has('embedded')) document.body.classList.add('embedded');
const names = ['A familiar behavior', 'A surprising default', '`format()` conversions', 'A runtime edge case',
  'Unexpected shared state', 'An implementation detail', 'A hidden protocol', 'A subtle lifetime rule',
  'An unusual interaction', 'A low-level escape hatch', 'The final boundary'];
// A realistic catalogue size exercises crowding, glyph wrapping, and scrolling.
const items: IcebergItem[] = Array.from({ length: 110 }, (_, i) => ({
  slug: `entry-${i + 1}`,
  name: `${names[i % names.length]} ${Math.floor(i / 11) + 1}`,
  short_description: 'This fixture explains a surprising behavior. Inline `code()` should wrap inside the card without adding a scrollbar. Scrolling over this description must continue moving the iceberg. Select the name to keep this description open, or close it to return to the labels.',
  url: 'https://example.com/source',
  obscurity_bucket: Math.floor(i / 11) + 1,
  obscurity_rating: Math.floor(i / 11) + (i % 11) / 11,
  cursedness_rating: (i * 7 % 11) / 10 * 10,
}));
const host = document.querySelector<HTMLElement>('#iceberg')!;
// Wait for the actual model, HDR, and texture loaders. Browser-wide
// "networkidle" can stall even after these resources have finished loading.
const assetsReady = new Promise<void>((resolve, reject) => {
  DefaultLoadingManager.onLoad = resolve;
  DefaultLoadingManager.onError = url => reject(new Error(`Fixture asset failed: ${url}`));
});
const controller = mountIceberg(host, {
  items,
  view: (params.get('view') ?? 'orbit') as IcebergView,
  viewSelector: !params.has('no-selector'),
  canvasAriaLabel: params.get('canvas-label') ?? undefined,
  stillFrame: params.has('still'),
  descentPrompt: false,
  hint: false,
  underwaterStretch: host.clientHeight > host.clientWidth ? 4 : 3,
  aboveWaterLabelStretch: host.clientHeight > host.clientWidth ? 2 : 1,
  assets: {
    model: '/assets/models/iceberg-web.glb',
    environment: '/assets/environment/ocean-panorama.hdr',
    sky: '/assets/environment/polar-cirrus.webp',
    relief: '/assets/textures/glacial-relief.webp',
  },
});
window.icebergTest = {
  controller, ready: false,
  get assetsLoaded() { return assetsLoaded; },
  get frameCount() { return renderedFrames; },
  async resumeRendering() {
    if (!paused) return;
    // Let the queued animation callback park before restarting the real RAF.
    await new Promise<void>(resolve => requestFrame(() => resolve()));
    paused = false;
    const callback = pendingFrame;
    pendingFrame = undefined;
    if (callback) window.requestAnimationFrame(callback);
  },
  pauseRendering() { paused = true; },
  startMeasurement() { samples = []; previous = 0; recording = true; },
  endMeasurement() { recording = false; return samples; },
};
await controller.ready;
await assetsReady;
await document.fonts.ready;
assetsLoaded = true;
