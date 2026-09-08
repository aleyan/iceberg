import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultIcebergAssets } from "../../src/index";

test("ships every default runtime asset", () => {
  for (const assetUrl of Object.values(defaultIcebergAssets)) {
    expect(assetUrl.startsWith("file:")).toBe(true);
    expect(existsSync(fileURLToPath(assetUrl))).toBe(true);
  }
});

test("keeps the default runtime assets within their delivery budgets", () => {
  const budgets = {
    model: 225_000,
    environment: 75_000,
    sky: 40_000,
    relief: 300_000,
  };
  for (const [name, maximum] of Object.entries(budgets)) {
    const path = fileURLToPath(defaultIcebergAssets[name as keyof typeof budgets]);
    expect(statSync(path).size).toBeLessThanOrEqual(maximum);
  }
});

test("ships a roughly tenfold-decimated iceberg mesh", () => {
  const bytes = readFileSync(fileURLToPath(defaultIcebergAssets.model));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const triangles = json.meshes
    .flatMap((mesh: { primitives: { indices?: number }[] }) => mesh.primitives)
    .reduce((count: number, primitive: { indices?: number }) => {
      if (primitive.indices === undefined) return count;
      return count + json.accessors[primitive.indices].count / 3;
    }, 0);
  expect(triangles).toBeLessThanOrEqual(15_000);
});
