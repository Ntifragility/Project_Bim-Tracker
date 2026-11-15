/**
 * Conduit Justification Engine (Autodesk Revit MEP Parity).
 * Handles Top of Conduit (TOC), Centerline (CL), and Bottom of Conduit (BOC)
 * vertical offsets and surface alignments.
 * Zero DOM or Three.js dependencies (100% portable to Rust/Wasm).
 */

export const JUSTIFICATION_MODES = {
  CENTER: 'CENTER',
  TOP: 'TOP',       // TOC: Flush with ceiling slab or beam soffit
  BOTTOM: 'BOTTOM', // BOC: Resting on floor or trapeze strut channel
};

/**
 * Converts a reference point at specified justification into the true 3D centerline point.
 *
 * @param {{ x: number, y: number, z: number }} point - Input reference coordinate
 * @param {number} outerRadiusM - Outer radius of the conduit (OD / 2)
 * @param {'CENTER'|'TOP'|'BOTTOM'} justification
 * @returns {{ x: number, y: number, z: number }} Centerline coordinate
 */
export function justifyToCenterline(point, outerRadiusM, justification = JUSTIFICATION_MODES.CENTER) {
  if (!point) return { x: 0, y: 0, z: 0 };

  let deltaY = 0;
  if (justification === JUSTIFICATION_MODES.TOP) {
    deltaY = -outerRadiusM; // Centerline sits below the top surface
  } else if (justification === JUSTIFICATION_MODES.BOTTOM) {
    deltaY = outerRadiusM;  // Centerline sits above the bottom support
  }

  return {
    x: point.x,
    y: point.y + deltaY,
    z: point.z,
  };
}

/**
 * Computes the elevation levels (Centerline, TOC, BOC) for a given conduit run.
 *
 * @param {number} centerlineElevationM
 * @param {number} outerRadiusM
 * @returns {{ centerline: number, topOfConduit: number, bottomOfConduit: number }}
 */
export function getElevationLevels(centerlineElevationM, outerRadiusM) {
  return {
    centerline: centerlineElevationM,
    topOfConduit: centerlineElevationM + outerRadiusM,
    bottomOfConduit: centerlineElevationM - outerRadiusM,
  };
}
