import { expect, test } from 'bun:test';
import { createAnimationLoop } from '../../src/animation-loop';

function harness(frameInterval = 16) {
  let now = 0, nextId = 0, frames = 0, renderedPhase = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const schedule = (callback: () => void, milliseconds: number) => {
    const id = ++nextId;
    pending.set(id, { at: now + milliseconds, callback });
    return id;
  };
  const loop = createAnimationLoop((_timestamp, elapsed) => { frames++; renderedPhase = elapsed; }, {
    now: () => now,
    request: callback => schedule(() => callback(now), frameInterval),
    cancel: id => { pending.delete(id); },
  });
  return {
    loop,
    get frames() { return frames; },
    get renderedPhase() { return renderedPhase; },
    get pending() { return pending.size; },
    advance(milliseconds: number) {
      const end = now + milliseconds;
      while (pending.size) {
        const [id, task] = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
        if (task.at > end) break;
        now = task.at;
        pending.delete(id);
        task.callback();
      }
      now = end;
    },
  };
}

test('idle motion eases to zero while frames stay smooth, then no work remains', () => {
  const h = harness();
  h.advance(15_000);
  expect(h.loop.elapsed).toBeCloseTo(15, 8);
  const advances: number[] = [];
  for (let second = 0; second < 5; second++) {
    const before = h.frames, phase = h.loop.elapsed;
    h.advance(1_000);
    expect(h.frames - before).toBeGreaterThan(50);
    expect(h.frames - before).toBeLessThan(65);
    advances.push(h.loop.elapsed - phase);
  }
  expect(advances[0]).toBeCloseTo(0.964, 8);
  expect(advances[4]).toBeCloseTo(0.036, 8);
  for (let i = 1; i < advances.length; i++) expect(advances[i]).toBeLessThan(advances[i - 1]);
  expect(h.renderedPhase).toBeCloseTo(17.5, 8);
  const before = h.frames;
  h.advance(60_000);
  expect(h.frames).toBe(before);
  expect(h.loop.elapsed).toBeCloseTo(17.5, 8);
  expect(h.pending).toBe(0);
});

test('interaction resumes normal motion without a phase jump from slow or stopped states', () => {
  const h = harness();
  for (const idle of [16_000, 21_000]) {
    h.advance(idle);
    const phase = h.loop.elapsed;
    h.loop.wake();
    h.loop.wake();
    expect(h.loop.elapsed).toBeCloseTo(phase, 8);
    expect(h.pending).toBe(1);
    const before = h.frames;
    h.advance(1_000);
    expect(h.loop.elapsed - phase).toBeCloseTo(1, 8);
    expect(h.frames - before).toBeGreaterThan(50);
    expect(h.frames - before).toBeLessThan(65);
  }
});

test('disposal cancels active and decelerating work and cannot be restarted', () => {
  for (const idle of [0, 16_000, 21_000]) {
    const h = harness();
    h.advance(idle);
    h.loop.dispose();
    const before = h.frames;
    h.loop.wake();
    h.advance(60_000);
    expect(h.frames).toBe(before);
    expect(h.pending).toBe(0);
  }
});

test('delayed frames reach the same exact resting phase', () => {
  for (const interval of [16, 128, 5_000]) {
    const h = harness(interval);
    h.advance(25_000);
    expect(h.renderedPhase).toBeCloseTo(17.5, 8);
    expect(h.pending).toBe(0);
  }
});
