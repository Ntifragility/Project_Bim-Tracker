// Centralized configuration constants for the Conduit Takeoff Viewer.
// All magic numbers live here — never scattered in the codebase.

/** Default stick length in metres (10 ft = 3.048 m). */
export const DEFAULT_STICK_LENGTH_M = 3.048;

/** Minimum segment length in metres (below this, a segment is rejected). */
export const MIN_SEGMENT_LENGTH_M = 0.001; // 1 mm

/** Snap radius in screen pixels. */
export const SNAP_RADIUS_PX = 12;

/** Vertex merge tolerance in metres. Two vertices closer than this are the same point. */
export const VERTEX_MERGE_TOLERANCE_M = 0.001; // 1 mm

/** Default work-plane elevation in metres (0 = ground). */
export const DEFAULT_WORK_PLANE_Z = 0;

/** Default waste factor (0 = no waste). */
export const DEFAULT_WASTE_FACTOR = 0;

/** Maximum undo stack depth. */
export const MAX_UNDO_DEPTH = 200;

/** Default diameter list. label is what the user sees, mm is the numeric sort value. */
export const DEFAULT_DIAMETERS = [
  { label: '½"', mm: 12.7 },
  { label: '¾"', mm: 19.05 },
  { label: '1"', mm: 25.4 },
  { label: '1¼"', mm: 31.75 },
  { label: '1½"', mm: 38.1 },
  { label: '2"', mm: 50.8 },
  { label: '2½"', mm: 63.5 },
  { label: '3"', mm: 76.2 },
  { label: '4"', mm: 101.6 },
];

/**
 * Unit conversion table. Keys are IFC unit names as they come from web-ifc or
 * IfcOpenShell. `factor` converts the unit to metres.
 */
export const UNIT_TABLE = {
  METRE: { factor: 1, label: 'm', plural: 'metres' },
  METER: { factor: 1, label: 'm', plural: 'meters' },
  MILLIMETRE: { factor: 0.001, label: 'mm', plural: 'millimetres' },
  MILLIMETER: { factor: 0.001, label: 'mm', plural: 'millimeters' },
  CENTIMETRE: { factor: 0.01, label: 'cm', plural: 'centimetres' },
  CENTIMETER: { factor: 0.01, label: 'cm', plural: 'centimeters' },
  FOOT: { factor: 0.3048, label: 'ft', plural: 'feet' },
  INCH: { factor: 0.0254, label: 'in', plural: 'inches' },
};
