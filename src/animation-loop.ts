interface AnimationClock {
  now(): number;
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
  delay(callback: () => void, milliseconds: number): number;
  clear(id: number): void;
}

/** Full-rate rendering for 15 seconds, 10 fps for five more, then no callbacks. */
export function createAnimationLoop(render: FrameRequestCallback, clock: AnimationClock = {
  now: () => performance.now(),
  request: callback => window.requestAnimationFrame(callback),
  cancel: id => window.cancelAnimationFrame(id),
  delay: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
  clear: id => window.clearTimeout(id),
}) {
  let lastActivity = clock.now();
  let frame: number | undefined;
  let timer: number | undefined;
  let disposed = false;

  function tick(timestamp: number) {
    frame = undefined;
    if (disposed) return;
    const idle = clock.now() - lastActivity;
    if (idle >= 20_000) return;
    render(timestamp);
    if (disposed) return;
    if (idle >= 15_000) {
      timer = clock.delay(() => {
        timer = undefined;
        if (!disposed && clock.now() - lastActivity < 20_000) frame = clock.request(tick);
      }, Math.min(100, 20_000 - idle));
    } else frame = clock.request(tick);
  }

  function wake() {
    if (disposed) return;
    lastActivity = clock.now();
    if (timer !== undefined) { clock.clear(timer); timer = undefined; }
    if (frame === undefined) frame = clock.request(tick);
  }

  function dispose() {
    disposed = true;
    if (frame !== undefined) clock.cancel(frame);
    if (timer !== undefined) clock.clear(timer);
    frame = timer = undefined;
  }

  wake();
  return { wake, dispose };
}
