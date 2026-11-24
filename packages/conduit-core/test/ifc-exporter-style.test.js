import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportOverlayIfc } from '../src/ifc-exporter.js';

describe('Conduit IFC Exporter — Drawn Colors & Grouped Trace Properties', () => {
  it('embeds IFCSTYLING (IFCCOLOURRGB/IFCSURFACESTYLERENDERING/IFCSTYLEDITEM) and Pset_ConduitRun total length on every part', () => {
    const nodes = {
      n1: { id: 'n1', x: 0, y: 0, z: 3 },
      n2: { id: 'n2', x: 5, y: 0, z: 3 },
      n3: { id: 'n3', x: 5, y: 4, z: 3 },
    };
    const runs = [
      { id: 'run-1', name: 'Run 1', size: '3/4"', system: 'Power', color: '#3b82f6', nodeIds: ['n1', 'n2', 'n3'] },
    ];

    const step = exportOverlayIfc({
      runs,
      nodes,
      schema: 'IFC4',
      getRunColor: (r) => r.color,
    });

    assert.match(step, /IFCCOLOURRGB\(\$,0\.2314,0\.5098,0\.9647\)/);
    assert.match(step, /IFCSURFACESTYLERENDERING\(/);
    assert.match(step, /IFCSURFACESTYLE\('Conduit_3b82f6'/);
    assert.match(step, /IFCPRESENTATIONSTYLEASSIGNMENT\(/);
    assert.match(step, /IFCSTYLEDITEM\(/);
    assert.match(step, /IFCELEMENTASSEMBLY\(/);
    assert.match(step, /'Pset_ConduitRun'/);
    assert.match(step, /'ColorHex',\$,IFCLABEL\('#3b82f6'\)/);
    assert.match(step, /Total: 29\.53 ft \(9\.00 m\)/);
  });
});
