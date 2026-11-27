import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeModelBaseName,
  computeSessionKey,
  serializeTagSession,
  reconcileRestoredTags,
  createTagSessionStore,
} from '../../../src/tagging/session-cache.js';

describe('Cable Tray Tier 1 Tag Session Cache (IndexedDB AutoRecover)', () => {
  it('normalizes IFC/.frag names and computes deterministic session keys', () => {
    assert.equal(normalizeModelBaseName('P22114-DA-3300.ifc'), 'p22114-da-3300');
    assert.equal(normalizeModelBaseName('P22114-DA-3300.frag'), 'p22114-da-3300');
    assert.equal(normalizeModelBaseName('P22114-DA-3300 (1).ifc'), 'p22114-da-3300');
    assert.equal(computeSessionKey('P22114.ifc', 1024), 'p22114::1024');
  });

  it('roundtrips tag assignments through store, reconciles by GlobalId and rebinds runtime modelId', async () => {
    const store = createTagSessionStore({ indexedDBImpl: null });
    const tagAssignments = new Map([
      [
        'old-uuid-1:101',
        {
          modelId: 'old-uuid-1',
          localId: 101,
          globalId: '2O2Fr$t4X7Zf8NOew3FLOH',
          elementTag: 'CT01.01.01',
          componentId: 'CT01.01.01',
          systemTag: 'CT01.01',
          sequenceNumber: '01',
          type: 'IFCCABLECARRIERSEGMENT',
          name: 'Tray-A',
        },
      ],
      [
        'old-uuid-1:102',
        {
          modelId: 'old-uuid-1',
          localId: 102,
          globalId: '',
          elementTag: 'CT01.01.02',
          componentId: 'CT01.01.02',
          systemTag: 'CT01.01',
          sequenceNumber: '02',
          type: 'IFCCABLECARRIERFITTING',
          name: 'Elbow-A',
        },
      ],
    ]);

    const record = serializeTagSession({
      modelName: 'P22114.ifc',
      byteLength: 50000,
      modelId: 'old-uuid-1',
      tagAssignments,
      pattern: { prefix: 'CT01.01.', start: 3, digits: 2 },
    });

    await store.save(record);

    // Simulate reload with a .frag compiled from the same IFC (different byteLength, new runtime UUID)
    const loaded = await store.load(computeSessionKey('P22114.frag', 8200), normalizeModelBaseName('P22114.frag'));
    assert.ok(loaded);
    assert.equal(loaded.tags.length, 2);
    assert.deepEqual(loaded.pattern, { prefix: 'CT01.01.', start: 3, digits: 2 });

    // Reconcile onto new model UUID, where GlobalId shifted from localId 101 -> 901
    const restored = reconcileRestoredTags(loaded.tags, {
      modelId: 'new-uuid-2',
      modelName: 'P22114.frag',
      globalIdToLocalId: new Map([['2O2Fr$t4X7Zf8NOew3FLOH', 901]]),
    });

    assert.equal(restored.length, 2);
    assert.equal(restored[0].modelId, 'new-uuid-2');
    assert.equal(restored[0].localId, 901);
    assert.equal(restored[0].elementTag, 'CT01.01.01');
    assert.equal(restored[1].localId, 102);

    // Clear cache removes both exact and baseName entries
    await store.remove(computeSessionKey('P22114.frag', 8200), normalizeModelBaseName('P22114.frag'));
    const afterClear = await store.load(computeSessionKey('P22114.ifc', 50000), normalizeModelBaseName('P22114.ifc'));
    assert.equal(afterClear, null);
  });
});
