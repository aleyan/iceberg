interface AnimationClock {
  now(): number;
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

// Integral of full speed for 15s, then 1 - smoothstep over the following 5s.
// Integrating analytically keeps motion independent of frame rate and prevents
// skipped frames or waking from idle from jumping the animation's phase.
function motionMilliseconds(idle: number) {
  const active = Math.min(Math.max(0, idle), 15_000);
  const fade = Math.min(Math.max(0, (idle - 15_000) / 5_000), 1);
  return active + 5_000 * (fade - fade ** 3 + fade ** 4 / 2);
}

/** Ramp motion to rest at full frame rate, then stop scheduling idle frames. */
export function createAnimationLoop(render: (timestamp: number, elapsed: number) => void, clock: AnimationClock = {
  now: () => performance.now(),
  request: callback => window.requestAnimationFrame(callback),
  cancel: id => window.cancelAnimationFrame(id),
}) {
  let lastActivity = clock.now();
  let accumulatedMotion = 0;
  let frame: number | undefined;
  let disposed = false;

  function elapsed(now: number) {
    return (accumulatedMotion + motionMilliseconds(now - lastActivity)) / 1_000;
  }

  function tick(timestamp: number) {
    frame = undefined;
    if (disposed) return;
    const now = clock.now();
    // Render the exact resting phase once, including when a frame was delayed.
    render(timestamp, elapsed(now));
    if (!disposed && now - lastActivity < 20_000) frame = clock.request(tick);
  }

  function wake() {
    if (disposed) return;
    const now = clock.now();
    accumulatedMotion += motionMilliseconds(now - lastActivity);
    lastActivity = now;
    if (frame === undefined) frame = clock.request(tick);
  }

  function dispose() {
    disposed = true;
    if (frame !== undefined) clock.cancel(frame);
    frame = undefined;
  }

  wake();
  return { wake, dispose, get elapsed() { return elapsed(clock.now()); } };
}
