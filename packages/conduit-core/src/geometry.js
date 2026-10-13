// Plain vector helpers for points in original IFC coordinates (metres, Z up).

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a) => Math.sqrt(dot(a, a));
export const distance = (a, b) => length(sub(a, b));

const DEG = Math.PI / 180;

/** Angle in degrees between two direction vectors (0..180). */
export function angleBetween(a, b) {
  const la = length(a);
  const lb = length(b);
  if (!la || !lb) return 0;
  const cos = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return Math.acos(cos) / DEG;
}

/** Closest point on segment ab to p, with t in 0..1 along the segment. */
export function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
  const point = add(a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}

/**
 * Keeps only the dominant axis of the move from `from` to `to`. Plan axes can be
 * rotated by `planAngle` degrees (about Z) so ortho follows a building grid that
 * is not aligned with the IFC axes.
 */
export function constrainOrtho(from, to, { planAngle = 0 } = {}) {
  const c = Math.cos(planAngle * DEG);
  const s = Math.sin(planAngle * DEG);
  const d = sub(to, from);
  const u = d.x * c + d.y * s;
  const v = -d.x * s + d.y * c;
  const abs = [Math.abs(u), Math.abs(v), Math.abs(d.z)];
  const axis = abs.indexOf(Math.max(...abs));
  if (axis === 2) return { x: from.x, y: from.y, z: to.z };
  const along = axis === 0 ? { u, v: 0 } : { u: 0, v };
  return { x: from.x + along.u * c - along.v * s, y: from.y + along.u * s + along.v * c, z: from.z };
}

/** Plan angle (degrees, about Z) of the segment a -> b, for aligning ortho to it. */
export function planAngleOf(a, b) {
  const d = sub(b, a);
  if (Math.hypot(d.x, d.y) < 1e-9) return 0;
  return Math.atan2(d.y, d.x) / DEG;
}

/** True when the segment is within `toleranceDeg` of vertical. */
export function isVertical(a, b, toleranceDeg = 10) {
  const d = sub(b, a);
  const len = length(d);
  if (!len) return false;
  return Math.abs(d.z) / len >= Math.cos(toleranceDeg * DEG);
}
