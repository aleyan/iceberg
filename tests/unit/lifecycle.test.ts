import { expect, test } from "bun:test";
import { createLifecycle } from "../../src/lifecycle";

test("disposing before readiness rejects with AbortError and releases resources once", async () => {
  const lifecycle = createLifecycle();
  const released: string[] = [];
  lifecycle.onCleanup(() => released.push("renderer"));
  lifecycle.onCleanup(() => released.push("labels"));
  lifecycle.dispose();
  lifecycle.dispose();
  lifecycle.resolveReady();
  await expect(lifecycle.ready).rejects.toMatchObject({ name: "AbortError" });
  expect(released).toEqual(["labels", "renderer"]);
  expect(lifecycle.disposed).toBe(true);
});

test("initialization failure preserves the original error and releases partial resources", async () => {
  const lifecycle = createLifecycle();
  const failure = new Error("WebGL initialization failed");
  let released = false;
  lifecycle.onCleanup(() => { released = true; });
  lifecycle.fail(failure);
  await expect(lifecycle.ready).rejects.toBe(failure);
  expect(released).toBe(true);
});

test("disposing a ready scene does not change successful readiness", async () => {
  const lifecycle = createLifecycle();
  lifecycle.resolveReady();
  lifecycle.dispose();
  await expect(lifecycle.ready).resolves.toBeUndefined();
});
