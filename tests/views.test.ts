import { afterEach, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { assertView, constrainYaw, icebergViews, placeFrontLabels } from '../src/view';
import { parseItems } from '../src/item-data';

// Exercise real label DOM and navigation without a GPU or font rasterizer.
mock.module('../src/item-text.js', () => ({ createItemText: () => ({ rebuild() {}, resize() {}, dispose() {} }) }));
const { createItemLabels } = await import('../src/item-labels');
const items = parseItems(await Bun.file(new URL('../demo/items.toml', import.meta.url)).text());
let cleanup = () => {};
afterEach(() => cleanup());

function mount(view: 'orbit' | 'arc' | 'list', syncUrl = false) {
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://example.com/?item=' + items[0].slug });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, location: dom.window.location,
    history: dom.window.history, ResizeObserver: class { observe() {} disconnect() {} },
  });
  const host = document.querySelector<HTMLElement>('#host')!;
  Object.defineProperty(host, 'clientWidth', { value: 1100, configurable: true });
  const navigate = mock(() => {});
  const range = mock((_min: number, _max: number, _positions: readonly THREE.Vector3[]) => {});
  const labels = createItemLabels(host, new THREE.Scene(), items, navigate, range, {
    view, syncUrl,
    aboveWaterLabelStretch: 1, ariaLabel: 'Items', deepestLabelSpan: () => 6,
  });
  labels.setIceberg(new THREE.Group(), new THREE.Box3(new THREE.Vector3(-3, -22, -3), new THREE.Vector3(3, 3, 3)), -0.72);
  cleanup = () => { labels.dispose(); dom.window.close(); };
  return { host, labels, navigate, dom, range };
}

test('exposes three modes and constrains large positive and negative rotations', () => {
  expect(icebergViews).toEqual(['orbit', 'arc', 'list']);
  for (const yaw of [-100, -0.1, 0, 0.1, 100]) {
    expect(constrainYaw('orbit', yaw)).toBe(yaw);
    expect(Math.abs(constrainYaw('arc', yaw))).toBeLessThanOrEqual(Math.PI / 12);
    expect(constrainYaw('list', yaw)).toBe(0);
  }
  expect(() => assertView('invalid' as 'orbit')).toThrow(TypeError);
});

test('list uses equally spaced names without headings and keeps selection across modes', () => {
  const { host, labels } = mount('list');
  expect(host.querySelectorAll('article:not([hidden])')).toHaveLength(items.length);
  expect(host.querySelectorAll('h2')).toHaveLength(0);
  const entries = [...host.querySelectorAll<HTMLElement>('article')];
  expect(entries.every(entry => entry.dataset.angle === '0')).toBe(true);
  const gap = Number(entries[0].dataset.worldY) - Number(entries[1].dataset.worldY);
  entries.slice(1).forEach((entry, index) => expect(Number(entries[index].dataset.worldY) - Number(entry.dataset.worldY)).toBeCloseTo(gap));
  host.querySelector<HTMLButtonElement>('.iceberg-viewer__item-name')!.click();
  for (const mode of ['arc', 'orbit', 'list'] as const) {
    labels.setView(mode);
    expect(host.querySelector('.is-pinned')?.getAttribute('data-slug')).toBe(items[0].slug);
    expect(host.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1);
  }
  labels.dispose();
  expect(host.children).toHaveLength(0);
});

test('arc keeps its irregular angles when the host becomes narrow', () => {
  const { host, labels } = mount('arc');
  for (const element of host.querySelectorAll<HTMLElement>('article')) {
    expect(Math.abs(Number(element.dataset.angle))).toBeLessThanOrEqual(0.7);
  }
  const originalAngles = [...host.querySelectorAll<HTMLElement>('article')].map(element => element.dataset.angle);
  Object.defineProperty(host, 'clientWidth', { value: 390 });
  const camera = new THREE.PerspectiveCamera(35, 390 / 844, 0.1, 1000);
  camera.position.set(0, 2, 20); camera.updateMatrixWorld();
  labels.update(camera, 390, 844);
  expect([...host.querySelectorAll<HTMLElement>('article')].map(element => element.dataset.angle)).toEqual(originalAngles);
});

test('deep links remain selected when switching views and history restores selection', () => {
  const { host, labels, dom, navigate } = mount('orbit', true);
  expect(navigate).toHaveBeenCalled();
  labels.setView('list');
  expect(host.querySelector('.is-pinned')?.getAttribute('data-slug')).toBe(items[0].slug);
  dom.window.history.replaceState(null, '', '?item=' + items.at(-1)!.slug);
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  expect(host.querySelector('.is-pinned')?.getAttribute('data-slug')).toBe(items.at(-1)!.slug);
});

test('every arc item is reachable at both rotation limits, including after mobile resize', () => {
  const { host, labels } = mount('arc');
  for (const width of [1100, 390]) {
    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    const camera = new THREE.PerspectiveCamera(35, width / 844, 0.1, 1000);
    camera.position.set(0, 2, 20); camera.updateMatrixWorld();
    labels.update(camera, width, 844);
    for (const element of host.querySelectorAll<HTMLElement>('article')) {
      const y = Number(element.dataset.worldY);
      for (const yaw of [-Math.PI / 12, Math.PI / 12]) {
        camera.position.set(Math.sin(yaw) * 20, y, Math.cos(yaw) * 20);
        camera.lookAt(0, y, 0); camera.updateMatrixWorld();
        labels.update(camera, width, 844);
        expect(element.hidden).toBe(false);
      }
    }
  }
});

test('Arc and List anchors move with the scene under the same camera projection', () => {
  const { host, labels, range } = mount('orbit');
  const orbitHeights = [...host.querySelectorAll<HTMLElement>('article')].map(e => Number(e.dataset.worldY));
  const camera = new THREE.PerspectiveCamera(35, 1100 / 844, 0.1, 1000);
  for (const mode of ['arc', 'list'] as const) {
    labels.setView(mode);
    const entries = [...host.querySelectorAll<HTMLElement>('article')];
    const positions = range.mock.calls.at(-1)![2];
    expect(Math.max(...positions.map(p => p.y))).toBeCloseTo(Math.max(...orbitHeights));
    expect(Math.min(...positions.map(p => p.y))).toBeCloseTo(Math.min(...orbitHeights));
    if (mode === 'arc') expect(positions.map(p => p.y)).toEqual(orbitHeights);
    for (const y of [0, -4]) {
      camera.position.set(0, y, 20); camera.updateMatrixWorld();
      labels.update(camera, 1100, 844);
      for (const [index, entry] of entries.entries()) {
        if (entry.hidden) continue;
        const projected = positions[index].clone().project(camera);
        expect(entry.style.transform).toBe(`translate3d(${((projected.x + 1) * 550).toFixed(1)}px,${((1 - projected.y) * 422).toFixed(1)}px,0)`);
      }
    }
  }
});

test('moving past names dismisses hover previews without disturbing pinned descriptions', () => {
  const { host, labels, dom } = mount('orbit');
  const entry = host.querySelector('article')!;
  const enter = () => entry.dispatchEvent(new dom.window.Event('pointerenter'));
  enter();
  expect(entry.classList.contains('is-expanded')).toBe(true);
  labels.setNavigating(true);
  expect(entry.classList.contains('is-expanded')).toBe(false);
  enter();
  expect(entry.classList.contains('is-expanded')).toBe(false);
  labels.setNavigating(false);
  enter();
  expect(entry.classList.contains('is-expanded')).toBe(true);
  entry.querySelector('button')!.click();
  labels.setNavigating(true);
  expect(entry.classList.contains('is-pinned')).toBe(true);
  expect(entry.classList.contains('is-expanded')).toBe(true);
});

test('arc compresses the original azimuths instead of imposing rows or columns', () => {
  const source = Array.from({ length: 12 }, (_, index) => ({ y: 4 - index * 0.4, angle: Math.sin(index * 2.3) * Math.PI }));
  const arc = placeFrontLabels(source, 'arc');
  expect(new Set(arc.map(entry => entry.angle)).size).toBe(source.length);
  expect(new Set(arc.map(entry => entry.y)).size).toBe(source.length);
  arc.forEach((entry, index) => expect(entry.angle).toBeCloseTo(source[index].angle * 0.7 / Math.PI));
});

test('front arrangements keep the original depth extent, including tiny catalogues', () => {
  for (const count of [0, 1, 111]) {
    const source = Array.from({ length: count }, (_, i) => ({ y: 5 - i * .1, angle: i % 3 }));
    for (const view of ['arc', 'list'] as const) {
      const placed = placeFrontLabels(source, view);
      expect(placed).toHaveLength(count);
      if (count) {
        expect(placed[0].y).toBe(source[0].y);
        expect(placed.at(-1)!.y).toBeCloseTo(source.at(-1)!.y);
      }
    }
  }
});
