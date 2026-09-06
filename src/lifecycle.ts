/** Own resources from the start of mounting, including partially initialized scenes. */
export function createLifecycle() {
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let settled = false;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Teardown may happen without anyone awaiting readiness. Consumers can still
  // await the original promise and observe its rejection.
  void ready.catch(() => {});

  function rejectReady(reason: unknown) {
    if (settled) return;
    settled = true;
    reject(reason);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    rejectReady(new DOMException("Iceberg disposed before it was ready.", "AbortError"));
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn("Unable to release an iceberg resource", error);
      }
    }
  }

  return {
    ready,
    get disposed() { return disposed; },
    onCleanup(cleanup: () => void) { cleanups.push(cleanup); },
    resolveReady() {
      if (settled) return;
      settled = true;
      resolve();
    },
    fail(reason: unknown) {
      rejectReady(reason);
      dispose();
    },
    dispose,
  };
}
