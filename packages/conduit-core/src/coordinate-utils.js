// Unit conversion and coordinate utilities — pure functions, no Three.js.
import { UNIT_TABLE } from './config.js';

/**
 * Resolve an IFC unit string (e.g. "METRE", "FOOT", ".MILLI.METRE.") to a
 * UNIT_TABLE entry. Returns the entry or null if unrecognised.
 */
export function resolveUnit(ifcUnitString) {
  if (!ifcUnitString) return null;
  // Normalise: strip dots, whitespace, upper-case
  const key = String(ifcUnitString).replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
  // Try exact match
  if (UNIT_TABLE[key]) return { key, ...UNIT_TABLE[key] };
  // Try common IFC prefixed patterns (e.g. "MILLIMETRE" from ".MILLI.METRE.")
  for (const [name, entry] of Object.entries(UNIT_TABLE)) {
    if (key.includes(name)) return { key: name, ...entry };
  }
  return null;
}

/**
 * Convert a length value from one unit to another.
 * Both `from` and `to` are UNIT_TABLE keys (e.g. "METRE", "FOOT").
 */
export function convertLength(value, fromKey, toKey) {
  const from = UNIT_TABLE[fromKey] ?? UNIT_TABLE[fromKey?.toUpperCase()];
  const to = UNIT_TABLE[toKey] ?? UNIT_TABLE[toKey?.toUpperCase()];
  if (!from || !to) throw new Error(`Unknown unit: ${!from ? fromKey : toKey}`);
  // value * from.factor gives metres; divide by to.factor gives target unit
  return (value * from.factor) / to.factor;
}

/**
 * Convert a value in metres to the target unit.
 */
export function fromMetres(valueInMetres, toKey) {
  return convertLength(valueInMetres, 'METRE', toKey);
}

/**
 * Convert a value from some unit to metres.
 */
export function toMetres(value, fromKey) {
  return convertLength(value, fromKey, 'METRE');
}

/**
 * Format a length value with its unit label.
 * @param {number} value - The length value in the unit specified by `unitKey`.
 * @param {string} unitKey - A UNIT_TABLE key (e.g. "METRE", "FOOT").
 * @param {number} decimals - Number of decimal places.
 */
export function formatLength(value, unitKey, decimals = 3) {
  const entry = UNIT_TABLE[unitKey] ?? UNIT_TABLE[unitKey?.toUpperCase()];
  const label = entry?.label ?? unitKey ?? '?';
  return `${Number(value).toFixed(decimals)} ${label}`;
}

/**
 * Format bytes into a human-readable file size.
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
