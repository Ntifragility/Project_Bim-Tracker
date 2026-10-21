import { add, dot, length, mean, normalize, scale, sub } from './vector.js';

function covariance(points, centroid) {
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const point of points) {
    const delta = sub(point, centroid);
    const values = [delta.x, delta.y, delta.z];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        matrix[row][column] += values[row] * values[column];
      }
    }
  }
  return matrix.map((row) => row.map((value) => value / points.length));
}

function multiply(matrix, vector) {
  return {
    x: matrix[0][0] * vector.x + matrix[0][1] * vector.y + matrix[0][2] * vector.z,
    y: matrix[1][0] * vector.x + matrix[1][1] * vector.y + matrix[1][2] * vector.z,
    z: matrix[2][0] * vector.x + matrix[2][1] * vector.y + matrix[2][2] * vector.z,
  };
}

function principalAxis(matrix) {
  let axis = normalize({ x: 1, y: 0.73, z: 0.37 });
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const next = normalize(multiply(matrix, axis));
    if (length(next) === 0) break;
    axis = next;
  }
  return axis;
}

export function deriveCenterline(points, options = {}) {
  const minimumLength = options.minimumLength ?? 1e-4;
  if (!Array.isArray(points) || points.length < 2) {
    return { valid: false, reason: 'insufficient-vertices' };
  }

  const centroid = mean(points);
  const matrix = covariance(points, centroid);
  const axis = principalAxis(matrix);
  if (length(axis) === 0) return { valid: false, reason: 'degenerate-geometry' };

  let minimum = Infinity;
  let maximum = -Infinity;
  for (const point of points) {
    const projection = dot(sub(point, centroid), axis);
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }

  const routeLength = maximum - minimum;
  if (!Number.isFinite(routeLength) || routeLength < minimumLength) {
    return { valid: false, reason: 'centerline-too-short', length: routeLength };
  }

  const longitudinalVariance = dot(axis, multiply(matrix, axis));
  const totalVariance = matrix[0][0] + matrix[1][1] + matrix[2][2];

  return {
    valid: true,
    centroid,
    axis,
    start: add(centroid, scale(axis, minimum)),
    end: add(centroid, scale(axis, maximum)),
    length: routeLength,
    confidence: totalVariance > 0 ? longitudinalVariance / totalVariance : 0,
  };
}

