import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultIcebergAssets } from "../src/index";

test("ships every default runtime asset", () => {
  for (const assetUrl of Object.values(defaultIcebergAssets)) {
    expect(assetUrl.startsWith("file:")).toBe(true);
    expect(existsSync(fileURLToPath(assetUrl))).toBe(true);
  }
});
