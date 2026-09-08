import { mountIceberg, type IcebergView, type IcebergController, type IcebergItem } from '../../../src/index';
import { DefaultLoadingManager } from 'three';
import '../../../styles.css';

export interface FrameSample { interval: number; work: number }
export interface BrowserFixture {
  controller: IcebergController;
  ready: boolean;
  readonly frameCount: number;
  pauseRendering(): Promise<void>;
  startMeasurement(): void;
  endMeasurement(): FrameSample[];
}
declare global { interface Window { icebergTest: BrowserFixture } }

// Measure the real animation callback, not a second timer that can keep passing
// after the renderer has stopped. No production instrumentation is required.
const params = new URLSearchParams(location.search);
const requestFrame = window.requestAnimationFrame.bind(window);
let lastVisualFrame = -Infinity;
let renderedFrames = 0;
let recording = false;
let paused = false;
let previous = 0;
let samples: FrameSample[] = [];
window.requestAnimationFrame = callback => requestFrame(timestamp => {
  if (paused) return;
  // Screenshot poses are static deep links. Limit their submission rate so a
  // software WebGL backend cannot accumulate a long queue before readback.
  // Interaction and performance fixtures never use this visual-only flag.
  if (params.has('visual') && timestamp - lastVisualFrame < 200) {
    window.requestAnimationFrame(callback);
    return;
  }
  lastVisualFrame = timestamp;
  const start = performance.now();
  callback(timestamp);
  renderedFrames++;
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
// Ensure the initial GPU glyph atlas uses the same bundled font on every OS.
await document.fonts.load('15px IcebergTest');
// Wait for the actual model, HDR, and texture loaders. Browser-wide
// "networkidle" can stall even after these resources have finished loading.
const assetsReady = new Promise<void>((resolve, reject) => {
  DefaultLoadingManager.onLoad = resolve;
  DefaultLoadingManager.onError = url => reject(new Error(`Fixture asset failed: ${url}`));
});
const controller = mountIceberg(host, {
  items,
  view: (params.get('view') ?? 'orbit') as IcebergView,
  viewSelector: true,
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
  get frameCount() { return renderedFrames; },
  async pauseRendering() {
    // Only screenshots use this, after assets and camera motion have settled.
    // Preserve the rendered canvas while preventing software WebGL from
    // monopolizing the CPU during repeated screenshot readback.
    paused = true;
    await new Promise<void>(resolve => requestFrame(() => resolve()));
  },
  startMeasurement() { samples = []; previous = 0; recording = true; },
  endMeasurement() { recording = false; return samples; },
};
await controller.ready;
await assetsReady;
const readyFrame = renderedFrames;
while (renderedFrames <= readyFrame) await new Promise(resolve => setTimeout(resolve, 25));
await document.fonts.ready;
window.icebergTest.ready = true;
