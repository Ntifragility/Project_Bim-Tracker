// Scene <-> original IFC coordinates.
//
// The IFC loader moves the first model near the origin (COORDINATE_TO_ORIGIN) and
// later models are placed relative to it, so every model shares one coordination
// matrix: scene = base * original, in Three axes (Y up, metres). Original IFC
// coordinates are Z up: (x, y, z)_ifc = (x, -z, y)_three.
import * as THREE from "three";

export function createCoordinateFrame(fragments) {
  const base = () => fragments.baseCoordinationMatrix?.clone() ?? new THREE.Matrix4();

  return {
    /** Scene point -> original IFC coordinates in metres, Z up. */
    toOriginal(scenePoint) {
      const p = new THREE.Vector3(scenePoint.x, scenePoint.y, scenePoint.z).applyMatrix4(base().invert());
      return { x: p.x, y: -p.z, z: p.y };
    },

    /** Original IFC coordinates (metres, Z up) -> scene point. */
    toScene(original) {
      return new THREE.Vector3(original.x, original.z, -original.y).applyMatrix4(base());
    },
  };
}
