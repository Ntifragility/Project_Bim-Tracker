import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {
  createCoordinateFrame,
  appearanceStyleName,
  createCovillafEngine,
  createEngine,
} from 'viewer-core';
import { covillafWebIfc, copyCovillafAssets } from 'viewer-core/vite-plugin';

test('viewer-core exports stable engine factories and utilities', () => {
  assert.equal(typeof createCovillafEngine, 'function');
  assert.equal(typeof createEngine, 'function');
  assert.equal(createEngine, createCovillafEngine);
  assert.equal(typeof createCoordinateFrame, 'function');
  assert.equal(typeof appearanceStyleName, 'function');
});

test('createCoordinateFrame roundtrips original IFC <-> scene coordinates', () => {
  const fragments = {
    baseCoordinationMatrix: new THREE.Matrix4().makeTranslation(300000, 8600000, 100),
  };
  const frame = createCoordinateFrame(fragments);
  
  // (x, y, z)_ifc = (x, -z, y)_three
  const original = { x: 50, y: 120, z: 15 };
  const scenePt = frame.toScene(original);
  assert.ok(scenePt instanceof THREE.Vector3);

  const back = frame.toOriginal(scenePt);
  assert.ok(Math.abs(back.x - original.x) < 1e-6);
  assert.ok(Math.abs(back.y - original.y) < 1e-6);
  assert.ok(Math.abs(back.z - original.z) < 1e-6);
});

test('appearanceStyleName normalizes hex colors into style identifiers', () => {
  assert.equal(appearanceStyleName('#6366F1'), 'appearance-6366f1');
  assert.equal(appearanceStyleName('22C55E'), 'appearance-22c55e');
  assert.equal(appearanceStyleName('#ef4444'), 'appearance-ef4444');
});

test('deep link URL ?ifc= resolves to valid public sample fixture', () => {
  const url = new URL('http://localhost:5173/?ifc=/fixtures/survey-box.ifc');
  const ifcParam = url.searchParams.get('ifc');
  assert.equal(ifcParam, '/fixtures/survey-box.ifc');

  const relativePath = ifcParam.replace(/^\//, '');
  const fixturePath = path.resolve('public', relativePath);
  assert.ok(fs.existsSync(fixturePath), `Fixture exists at ${fixturePath}`);

  const content = fs.readFileSync(fixturePath, 'utf-8');
  assert.ok(content.startsWith('ISO-10303-21;'));
  assert.ok(content.includes("FILE_SCHEMA(('IFC4'));"));
  assert.ok(content.includes('IFCBUILDINGELEMENTPROXY'));
  assert.ok(content.includes('Box A'));
  assert.ok(content.includes('Box B'));
});

test('viewer-core Vite plugin exposes dev server middleware and build hooks', () => {
  const plugin = covillafWebIfc();
  assert.equal(plugin.name, 'covillaf-web-ifc');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.closeBundle, 'function');
  assert.equal(typeof copyCovillafAssets, 'function');
});
