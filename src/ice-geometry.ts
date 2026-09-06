import * as THREE from "three";

/**
 * Clone an iceberg mesh and stretch its submerged vertices in world space.
 *
 * glTF may store positions in normalized integer attributes. Convert those
 * positions to floats before editing so a stretch can exceed the quantized
 * accessor's original range without clipping.
 */
export function createStretchedIcebergGeometry(
  source: THREE.BufferGeometry,
  localToWorld: THREE.Matrix4,
  waterLevel: number,
  stretch: number,
): THREE.BufferGeometry | null {
  const geometry = source.clone();
  const sourcePosition = geometry.getAttribute("position");
  if (!sourcePosition || sourcePosition.itemSize < 3) {
    geometry.dispose();
    return null;
  }

  const position = new THREE.Float32BufferAttribute(
    new Float32Array(sourcePosition.count * 3),
    3,
  );
  for (let index = 0; index < sourcePosition.count; index += 1) {
    position.setXYZ(
      index,
      sourcePosition.getX(index),
      sourcePosition.getY(index),
      sourcePosition.getZ(index),
    );
  }
  geometry.setAttribute("position", position);

  const worldToLocal = localToWorld.clone().invert();
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index).applyMatrix4(localToWorld);
    if (vertex.y < waterLevel) {
      vertex.y = waterLevel + (vertex.y - waterLevel) * stretch;
    }
    vertex.applyMatrix4(worldToLocal);
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  position.needsUpdate = true;
  geometry.deleteAttribute("normal");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
