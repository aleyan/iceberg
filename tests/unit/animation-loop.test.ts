import { expect, test } from 'bun:test';
import { createAnimationLoop } from '../../src/animation-loop';

function harness() {
  let now = 0, nextId = 0, frames = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const schedule = (callback: () => void, milliseconds: number) => {
    const id = ++nextId;
    pending.set(id, { at: now + milliseconds, callback });
    return id;
  };
  const loop = createAnimationLoop(() => { frames++; }, {
    now: () => now,
    request: callback => schedule(() => callback(now), 16),
    cancel: id => { pending.delete(id); },
    delay: schedule,
    clear: id => { pending.delete(id); },
  });
  return {
    loop,
    get frames() { return frames; },
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

test('idle rendering slows after 15 seconds and leaves no scheduled work after 20', () => {
  const h = harness();
  h.advance(14_000);
  let before = h.frames;
  h.advance(1_000);
  expect(h.frames - before).toBeGreaterThan(50);
  before = h.frames;
  h.advance(1_000);
  expect(h.frames - before).toBeGreaterThan(0);
  expect(h.frames - before).toBeLessThanOrEqual(10);
  h.advance(4_000);
  before = h.frames;
  h.advance(60_000);
  expect(h.frames).toBe(before);
  expect(h.pending).toBe(0);
});

test('interaction resumes full-rate rendering from both slow and stopped states', () => {
  const h = harness();
  for (const idle of [16_000, 21_000]) {
    h.advance(idle);
    h.loop.wake();
    h.loop.wake();
    expect(h.pending).toBe(1);
    const before = h.frames;
    h.advance(1_000);
    expect(h.frames - before).toBeGreaterThan(50);
    expect(h.frames - before).toBeLessThan(65);
  }
});

test('disposal cancels active and throttled work and cannot be restarted', () => {
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
