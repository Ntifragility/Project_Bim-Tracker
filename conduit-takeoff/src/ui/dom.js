// conduit-takeoff/src/ui/dom.js — central DOM lookup table.
//
// All `getElementById` / `querySelectorAll` lookups for the conduit app live
// here (conduit-ui-split module 1). Zero logic: call `collectEls()` once from
// the coordinator after DOM parse and share the table with every module.

export function collectEls() {
  return {
    viewerContainer: document.getElementById('viewer-container'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingStage: document.getElementById('loading-stage'),
    loadingBarFill: document.getElementById('loading-bar-fill'),
    loadingDetail: document.getElementById('loading-detail'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    tabs: document.querySelectorAll('.sidebar-tab-btn'),
    panels: document.querySelectorAll('.control-group[data-sidebar-panel]'),

    // Model panel
    btnOpenIfc: document.getElementById('btn-open-ifc'),
    fileInput: document.getElementById('file-input'),
    modelInfo: document.getElementById('model-info'),
    modelName: document.getElementById('model-name'),
    modelSize: document.getElementById('model-size'),
    modelUnit: document.getElementById('model-unit'),
    modelSchema: document.getElementById('model-schema'),
    btnFitView: document.getElementById('btn-fit-view'),
    btnViewTop: document.getElementById('btn-view-top'),
    btnViewFront: document.getElementById('btn-view-front'),
    btnViewRight: document.getElementById('btn-view-right'),

    // Draw panel
    btnDrawMode: document.getElementById('btn-draw-mode'),
    btnOrtho: document.getElementById('btn-ortho'),
    btnPerp: document.getElementById('btn-perp'),
    btnUndo: document.getElementById('btn-undo'),
    btnRedo: document.getElementById('btn-redo'),
    diameterList: document.getElementById('diameter-list'),
    activeRunInfo: document.getElementById('active-run-info'),
    runLength: document.getElementById('run-length'),
    runSticks: document.getElementById('run-sticks'),
    runSegments: document.getElementById('run-segments'),
    activeRunActions: document.getElementById('active-run-actions'),
    verticalStepControls: document.getElementById('vertical-step-controls'),
    inputVerticalLen: document.getElementById('input-vertical-len'),
    btnAddVertUp: document.getElementById('btn-add-vert-up'),
    btnAddVertDown: document.getElementById('btn-add-vert-down'),
    btnFinishRun: document.getElementById('btn-finish-run'),
    btnCancelRun: document.getElementById('btn-cancel-run'),
    runList: document.getElementById('run-list'),
    runsCountBadge: document.getElementById('runs-count-badge'),

    // Revit-Style Top Options Bar
    topDiameterSelect: document.getElementById('top-diameter-select'),
    topElevationInput: document.getElementById('top-elevation-input'),
    btnPickElevation: document.getElementById('btn-pick-elevation'),
    topSystemSelect: document.getElementById('top-system-select'),
    btnToggleWorkplane: document.getElementById('btn-toggle-workplane'),
    btnToggleAutoriser: document.getElementById('btn-toggle-autoriser'),
    topActiveRunSummary: document.getElementById('top-active-run-summary'),
    topRunLength: document.getElementById('top-run-length'),
    topRunSticks: document.getElementById('top-run-sticks'),
    topBtnFinish: document.getElementById('top-btn-finish'),
    topBtnCancel: document.getElementById('top-btn-cancel'),

    // Summary panel
    wasteFactorInput: document.getElementById('waste-factor-input'),
    summaryTableContainer: document.getElementById('summary-table-container'),

    // Footer & Status
    projectFileInput: document.getElementById('project-file-input'),
    btnLoadProject: document.getElementById('btn-load-project'),
    btnSave: document.getElementById('btn-save'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    btnExportIfc: document.getElementById('btn-export-ifc'),
    statusText: document.getElementById('status-text'),
    cursorCoords: document.getElementById('cursor-coords'),
  };
}
