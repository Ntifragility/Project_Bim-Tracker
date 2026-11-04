// conduit-takeoff/src/ui/state.js — shared conduit app state.
//
// `createConduitState()` builds the single mutable state object owned by the
// coordinator (conduit-ui-split module 2). All calculations stay in
// `@conduit-core` / `drawing-tool.js`; this module only holds data.

import {
  createNetwork,
  createCommandStack,
  createDiameterRegistry,
  createMarkerStore,
} from '@conduit-core';

export function createConduitState() {
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
    network: createNetwork(),
    commandStack: createCommandStack({ maxDepth: 200 }),
    diameterRegistry: createDiameterRegistry(),
    markerStore: createMarkerStore(),
    selectedRunId: null,
  };
}
