// conduit-takeoff/src/ui/state.js — shared conduit app state.
//
// `createConduitState()` builds the single mutable state object owned by the
// coordinator (conduit-ui-split module 2). All calculations stay in
// `@conduit-core` / `drawing-tool.js`; this module only holds data.

// `backend` (from ../backend.js `createConduitBackend()`) supplies the
// compute surface; defaults to `@conduit-core` so tests keep working.
import {
  createNetwork as jsCreateNetwork,
  createCommandStack as jsCreateCommandStack,
  createDiameterRegistry as jsCreateDiameterRegistry,
  createMarkerStore as jsCreateMarkerStore,
} from '@conduit-core';

const jsFallback = {
  createNetwork: jsCreateNetwork,
  createCommandStack: jsCreateCommandStack,
  createDiameterRegistry: jsCreateDiameterRegistry,
  createMarkerStore: jsCreateMarkerStore,
};

export function createConduitState(backend) {
  const core = backend ?? jsFallback;
  return {
    sourceModel: {
      name: '',
      size: 0,
      sha256: '',
      unit: 'METRE',
      schema: 'IFC4',
      buffer: null,
    },
    settings: {
      stickLengthM: 3.048, // 10 ft
      wasteFactor: 0,
      unit: 'METRE',
    },
    network: core.createNetwork(),
    commandStack: core.createCommandStack({ maxDepth: 200 }),
    diameterRegistry: core.createDiameterRegistry(),
    markerStore: core.createMarkerStore(),
    selectedRunId: null,
    // Compute surface: modules read `state.backend` for takeoff/snap/BOM.
    // Kept non-enumerable-adjacent (plain field) so project serialization
    // (`serializeProject`) never picks it up.
    backend: core,
  };
}
