import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { extractTraySegments } from '../../../src/routing/ifc-extractor.js';

test('extracts Revizto generic parts and falls back to their item box', async () => {
  const model = {
    modelId: 'revizto-model',
    object: new THREE.Object3D(),
    async getItemsOfCategories() {
      return { IFCBUILDINGELEMENTPART: [1, 2] };
    },
    async getItemsData() {
      return [
        {
          _localId: { value: 1 },
          _guid: { value: 'tray-guid' },
          _category: { value: 'IFCBUILDINGELEMENTPART' },
          Name: { value: 'Cable Tray with Fittings' },
        },
        {
          _localId: { value: 2 },
          _guid: { value: 'container-guid' },
          _category: { value: 'IFCBUILDINGELEMENTPART' },
          Name: { value: 'Hierarchy container' },
        },
      ];
    },
    getItem(localId) {
      return {
        async getGeometry() {
          if (localId === 2) return null;
          return { async getVertices() { throw new TypeError('geometries is not iterable'); } };
        },
        async getGuid() { return localId === 1 ? 'tray-guid' : 'container-guid'; },
        async getCategory() { return 'IFCBUILDINGELEMENTPART'; },
      };
    },
    async getBoxes(ids) {
      return ids[0] === 1
        ? [new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0.4, 0.1))]
        : [];
    },
  };

  const result = await extractTraySegments(model);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].geometrySource, 'bounding-box');
  assert.equal(result.segments[0].globalId, 'tray-guid');
  assert.ok(Math.abs(result.segments[0].length - 4) < 0.01);
  assert.deepEqual(result.rejected, [{ localId: 2, reason: 'not-identified-as-cable-tray' }]);
});

