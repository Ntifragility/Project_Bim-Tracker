export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });

export const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, scalar) => vec(a.x * scalar, a.y * scalar, a.z * scalar);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a) => Math.sqrt(dot(a, a));
export const distance = (a, b) => length(sub(a, b));
export const normalize = (a) => {
  const magnitude = length(a);
  return magnitude > 0 ? scale(a, 1 / magnitude) : vec();
};

export function mean(points) {
  if (!points.length) return vec();
  return scale(points.reduce((sum, point) => add(sum, point), vec()), 1 / points.length);
}

