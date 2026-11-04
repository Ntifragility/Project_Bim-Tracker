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

    /** Length in original IFC metres between two scene points. */
    lengthOriginal(aScene, bScene) {
      const a = this.toOriginal(aScene);
      const b = this.toOriginal(bScene);
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    },

    /** f64 passthrough + fixed-3 display helper for IFC positions. */
    formatIfc(p) {
      return {
        x: p.x, y: p.y, z: p.z,
        display: `(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`,
      };
    },

    /** Self-describing frame: canonical IFC Z-up f64 metres (D4). */
    frame() {
      const m = base();
      return { up: 'Z', units: 'm', originShift: { x: m.elements[12], y: m.elements[13], z: m.elements[14] } };
    },
  };
}
