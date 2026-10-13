import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUnit,
  convertLength,
  fromMetres,
  toMetres,
  formatLength,
  formatFileSize,
} from '../src/coordinate-utils.js';

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≠ ${expected} (tol ${tol})`);

test('resolveUnit: standard IFC unit strings', () => {
  assert.equal(resolveUnit('METRE').key, 'METRE');
  assert.equal(resolveUnit('FOOT').key, 'FOOT');
  assert.equal(resolveUnit('MILLIMETRE').key, 'MILLIMETRE');
  assert.equal(resolveUnit('INCH').key, 'INCH');
});

test('resolveUnit: dotted IFC format (.MILLI.METRE.)', () => {
  const result = resolveUnit('.MILLI.METRE.');
  assert.ok(result);
  assert.equal(result.factor, 0.001);
});

test('resolveUnit: case-insensitive', () => {
  assert.ok(resolveUnit('metre'));
  assert.ok(resolveUnit('Foot'));
});

test('resolveUnit: returns null for unknown', () => {
  assert.equal(resolveUnit('FATHOM'), null);
  assert.equal(resolveUnit(''), null);
  assert.equal(resolveUnit(null), null);
});

test('convertLength: metres to feet', () => {
  close(convertLength(1, 'METRE', 'FOOT'), 1 / 0.3048);
});

test('convertLength: feet to metres', () => {
  close(convertLength(10, 'FOOT', 'METRE'), 3.048);
});

test('convertLength: millimetres to inches', () => {
  close(convertLength(25.4, 'MILLIMETRE', 'INCH'), 1);
});

test('convertLength: same unit is identity', () => {
  close(convertLength(42, 'METRE', 'METRE'), 42);
});

test('convertLength: throws on unknown unit', () => {
  assert.throws(() => convertLength(1, 'FATHOM', 'METRE'), /Unknown unit/);
});

test('fromMetres: 3.048 m = 10 ft', () => {
  close(fromMetres(3.048, 'FOOT'), 10);
});

test('toMetres: 10 ft = 3.048 m', () => {
  close(toMetres(10, 'FOOT'), 3.048);
});

test('formatLength: formats with label', () => {
  assert.equal(formatLength(3.048, 'METRE', 3), '3.048 m');
  assert.equal(formatLength(10, 'FOOT', 0), '10 ft');
});

test('formatFileSize: human readable', () => {
  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(10 * 1024 * 1024), '10.0 MB');
});
