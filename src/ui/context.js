// Shared tray-viewer application context.
//
// Owns the mutable runtime state that the feature modules under `src/ui/`
// coordinate through: loaded models, selection, tagging assignments, staged
// IFC edits, and the engine/world handles created during bootstrap.
// `src/main.js` creates one context per app start and passes it to each
// feature module, so no module keeps a private engine instance (spec R2).

export function createAppContext() {
  return {
    // Engine handles (assigned during bootstrap in `src/main.js`).
    engine: null,
    components: null,
    world: null,
    fragments: null,
    highlighter: null,
    hider: null,
    indexer: null,
    routingController: null,
    tagLabelManager: null,

    // Model state.
    activeModel: null,
    loadedModels: [], // Track all loaded models: { uuid, name, size, model, visible }
    isWireframe: false,

    // Excel linkage state.
    excelData: [],
    excelColumns: [],
    selectedExcelIdColumn: '',
    selectedExcelRowIndex: null,

    // Selection state.
    selectedIfcElement: null,
    currentSelectionMap: {},
    lastIsolatedSelectionMap: {},
    isolationActive: false,
    multiSelectionElements: [],
    multiSelectionIndex: -1, // -1 = Combined View, 0..N = individual element index
    selectionOrderKeys: [],
    traySelection: new Map(),

    // Appearance state.
    selectedAppearanceColor: '#f54242',
    selectionHighlightColor: localStorage.getItem('bim-selection-highlight-color') || '#6366f1',
    appearanceColorMaps: new Map(),
    continuityHighlightStyleNames: new Set(),

    // Tag assignment state (saved/pending/undo overlay; see ARCHITECTURE.md §2).
    tagAssignments: new Map(),
    pendingIfcPropertyEdits: new Map(),
    pendingIfcColorEdits: new Map(),
    lastMetadataTemplate: null,

    // Tagging workbench state.
    selectedTraySystemTag: '',
    traySystemFilterText: '',
    traySystemSortMode: 'tag',
    traySystemContinuityReport: null,
    batchPreviewElements: [],
    batchPreviewAssignments: [],
    lastBatchSnapshot: null,

    // Highlight/label toggles.
    autoRotateActive: false,
    isTaggedHighlightActive: localStorage.getItem('bim-highlight-tagged-active') === 'true',
    taggedHighlightColor: (() => {
      const stored = localStorage.getItem('bim-highlight-tagged-color');
      return stored && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored.toLowerCase() : '#10b981';
    })(),
    isFloatingLabelsActive: localStorage.getItem('bim-floating-labels-active') === 'true',

    // Shared constants.
    excelColumnKey: '__assignment__',
    minExcelColumnWidth: 92,
    defaultExcelColumnWidth: 150,
    excelColumnWidths: new Map(),
    continuityGroupColors: ['#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#a855f7', '#ef4444'],
    taggedTrayHighlightStyle: 'tagged-tray-highlight',
  };
}
