import { expect, test } from "bun:test";
import * as THREE from "three";
import { createStretchedIcebergGeometry } from "../src/ice-geometry";

test("dequantizes positions before stretching them beyond their encoded range", () => {
  const source = new THREE.BufferGeometry();
  const vertices = new THREE.InterleavedBuffer(
    new Int16Array([
      0, -10_000, 0, 0, 32_767, 0,
      1_000, -10_000, 0, 0, 32_767, 0,
      0, 10_000, 1_000, 0, 32_767, 0,
    ]),
    6,
  );
  source.setAttribute(
    "position",
    new THREE.InterleavedBufferAttribute(
      vertices,
      3,
      0,
      true,
    ),
  );
  source.setAttribute("normal", new THREE.InterleavedBufferAttribute(vertices, 3, 3, true));
  source.setIndex([0, 1, 2]);

  const localToWorld = new THREE.Matrix4().makeScale(1, 0.001, 1);
  const result = createStretchedIcebergGeometry(source, localToWorld, 0, 4);
  const position = result?.getAttribute("position");
  const originalY = source.getAttribute("position").getY(0);

  expect(position).toBeInstanceOf(THREE.Float32BufferAttribute);
  expect(position?.getY(0)).toBeCloseTo(originalY * 4);
  expect(position?.getY(1)).toBeCloseTo(originalY * 4);
  expect(position?.getY(2)).toBeCloseTo(source.getAttribute("position").getY(2));
  expect(source.getAttribute("position").getY(0)).toBe(originalY);
});
