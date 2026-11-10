// Shared DOM element lookups for the tray viewer.
//
// All `document.getElementById` calls for the app shell live here so the
// feature modules under `src/ui/` share one definition of the DOM surface.
// See `docs/specs/tray/split-main-js.md` (R1: identical element IDs).

function el(id) {
  return document.getElementById(id);
}

function all(selector) {
  return document.querySelectorAll(selector);
}

export const container = el('viewer-container');
export const viewerContextMenu = el('viewer-context-menu');
export const contextFocusItem = el('context-focus-item');
export const contextIsolateItem = el('context-isolate-item');
export const contextColorControl = el('context-color-control');
export const contextSelectionColor = el('context-selection-color');
export const contextColorHex = el('context-color-hex');
export const contextShowAll = el('context-show-all');
export const sidebar = el('sidebar');
export const btnSidebarToggle = el('sidebar-toggle');
export const btnLoadSample = el('btn-load-sample');
export const btnUpload = el('btn-upload');
export const fileInput = el('file-input');
export const btnResetCamera = el('btn-reset-camera');
export const btnViewerSettings = el('btn-viewer-settings');
export const viewerSettingsPanel = el('viewer-settings-panel');
export const selectionHighlightColorInput = el('selection-highlight-color');
export const selectionHighlightHex = el('selection-highlight-hex');
export const toggleGrid = el('toggle-grid');
export const toggleWireframe = el('toggle-wireframe');
export const toggleDarkMode = el('toggle-darkmode');

// Excel DOM Elements
export const excelFileInput = el('excel-file-input');
export const btnUploadExcel = el('btn-upload-excel');
export const excelPanel = el('excel-panel');
export const btnExcelPanelClose = el('excel-panel-close');
export const excelFileName = el('excel-file-name');
export const excelIdColumn = el('excel-id-column');
export const excelSearch = el('excel-search');
export const excelOnlyFields = all('.excel-only-field');
export const systemTagInput = el('system-tag-input');
export const systemTagSuggestions = el('system-tag-suggestions');
export const excelDataTable = el('excel-data-table');
export const excelTableColgroup = el('excel-table-colgroup');
export const excelTableHeader = el('excel-table-header');
export const excelTableBody = el('excel-table-body');
export const tagAssignmentStatus = el('tag-assignment-status');
export const tagAssignmentSummary = el('tag-assignment-summary');
export const traySystemManagerSummary = el('tray-system-manager-summary');
export const traySystemFilter = el('tray-system-filter');
export const traySystemSort = el('tray-system-sort');
export const traySystemList = el('tray-system-list');
export const traySystemComponentList = el('tray-system-component-list');
export const traySystemSequenceStatus = el('tray-system-sequence-status');
export const traySystemContinuityPanel = el('tray-system-continuity-panel');
export const traySystemContinuityStatus = el('tray-system-continuity-status');
export const traySystemContinuityBody = el('tray-system-continuity-body');
export const btnClearContinuityColors = el('btn-clear-continuity-colors');
export const traySystemDeletionsPanel = el('tray-system-deletions-panel');
export const traySystemDeletionList = el('tray-system-deletion-list');
export const btnRestoreAllDeletions = el('btn-restore-all-deletions');
export const btnAssignTag = el('btn-assign-tag');
export const btnHighlightSystem = el('btn-highlight-system');
export const btnAddTraySelection = el('btn-add-tray-selection');
export const btnUnassignTag = el('btn-unassign-tag');
export const btnValidateTags = el('btn-validate-tags');
export const btnExportTags = el('btn-export-tags');
export const btnExportTaggedIfc = el('btn-export-tagged-ifc');
export const btnRefreshTraySystems = el('btn-refresh-tray-systems');
export const btnManagerHighlight = el('btn-manager-highlight');
export const btnManagerIsolate = el('btn-manager-isolate');
export const btnManagerAddSelection = el('btn-manager-add-selection');
export const btnManagerRemoveSelection = el('btn-manager-remove-selection');
export const btnManagerCheckContinuity = el('btn-manager-check-continuity');
export const btnManagerRegenerateSequence = el('btn-manager-regenerate-sequence');
export const btnManagerRename = el('btn-manager-rename');
export const tagValidationReport = el('tag-validation-report');
export const tagValidationBadge = el('tag-validation-badge');
export const tagValidationCounts = el('tag-validation-counts');
export const tagValidationIssues = el('tag-validation-issues');
export const traySelectionSummary = el('tray-selection-summary');
export const tagReplaceDialog = el('tag-replace-dialog');
export const tagReplaceMessage = el('tag-replace-message');
export const tagReplaceCancel = el('tag-replace-cancel');
export const tagReplaceConfirm = el('tag-replace-confirm');
export const taggingTabAssign = el('tagging-tab-assign');
export const taggingTabManage = el('tagging-tab-manage');
export const batchTaggingPane = el('batch-tagging-pane');
export const tagManagementPane = el('tag-management-pane');
export const batchPrefix = el('batch-prefix');
export const batchSystem = el('batch-system');
export const batchElementKind = el('batch-element-kind');
export const batchTrayCode = el('batch-tray-code');
export const batchFittingCode = el('batch-fitting-code');
export const batchStartSequence = el('batch-start-sequence');
export const batchSequenceDigits = el('batch-sequence-digits');
export const batchPatternExample = el('batch-pattern-example');
export const batchSelectionCount = el('batch-selection-count');
export const batchStatus = el('batch-status');
export const batchPreviewPanel = el('batch-preview-panel');
export const batchPreviewList = el('batch-preview-list');
export const batchReplaceConflictsRow = el('batch-replace-conflicts-row');
export const batchReplaceConflicts = el('batch-replace-conflicts');
export const btnPreviewBatchTags = el('btn-preview-batch-tags');
export const btnApplyBatchTags = el('btn-apply-batch-tags');
export const btnUndoBatchTags = el('btn-undo-batch-tags');

// Loaded Models DOM Elements
export const loadedModelsContainer = el('loaded-models-container');
export const loadedModelsList = el('loaded-models-list');
export const modelsPlaceholder = loadedModelsContainer
  ? loadedModelsContainer.querySelector('.models-placeholder')
  : null;

// Orbit DOM Elements
export const orbitIndicator = el('orbit-indicator');

export const loadingOverlay = el('loading-overlay');
export const loaderTitle = el('loader-title');
export const loaderStatus = el('loader-status');
export const loaderProgress = el('loader-progress');

export const elementPropsPanel = el('element-props-panel');
export const propTypeBadge = el('prop-type-badge');
export const propName = el('prop-name');
export const propGlobalId = el('prop-globalid');
export const propTag = el('prop-tag');
export const propExpressId = el('prop-expressid');
export const propModel = el('prop-model');
export const propPsetsContainer = el('prop-psets-container');
export const ifcEditPset = el('ifc-edit-pset');
export const ifcEditProperty = el('ifc-edit-property');
export const ifcEditValue = el('ifc-edit-value');
export const ifcEditColor = el('ifc-edit-color');
export const ifcEditTransparency = el('ifc-edit-transparency');
export const ifcEditStatus = el('ifc-edit-status');
export const ifcEditCount = el('ifc-edit-count');
export const ifcEditPendingList = el('ifc-edit-pending-list');
export const btnStagePropertyEdit = el('btn-stage-property-edit');
export const btnStageColorEdit = el('btn-stage-color-edit');
export const btnClearIfcEdits = el('btn-clear-ifc-edits');
export const btnExportEditedIfc = el('btn-export-edited-ifc');
export const btnExportAllIfc = el('btn-export-all-ifc');
export const metadataPset = el('metadata-pset');
export const metadataRows = el('metadata-rows');
export const btnAddMetadataRow = el('btn-add-metadata-row');
export const btnCopyPreviousMetadata = el('btn-copy-previous-metadata');
export const btnStageMetadata = el('btn-stage-metadata');

// Multi-Selection Properties DOM Elements
export const multiSelectHeader = el('multi-select-header');
export const multiSelectBadge = el('multi-select-badge');
export const multiSelectTypeBreakdown = el('multi-select-type-breakdown');
export const btnMultiCombined = el('btn-multi-combined');
export const btnMultiPrev = el('btn-multi-prev');
export const btnMultiNext = el('btn-multi-next');
export const multiSelectIndex = el('multi-select-index');

// Tagged Tray Highlighting DOM Elements
export const toggleHighlightTagged = el('toggle-highlight-tagged');
export const toggleHighlightTaggedSidebar = el('toggle-highlight-tagged-sidebar');
export const taggedHighlightColorInput = el('tagged-highlight-color');
export const taggedHighlightHexInput = el('tagged-highlight-hex');
export const taggedHighlightCountBadge = el('tagged-highlight-count');
export const toggleFloatingLabels = el('toggle-floating-labels');
export const toggleFloatingLabelsSidebar = el('toggle-floating-labels-sidebar');
