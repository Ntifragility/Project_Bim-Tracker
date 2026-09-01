import './style.css';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import * as XLSX from 'xlsx';
import { initExcelBridge } from './viewer-socket.js';
import { initRoutingController } from './routing/routing-controller.js';
import { addTraySystemAssignmentsToIfc, extractTraySystemAssignmentsFromIfc, taggedIfcFileName } from './ifc/ifc-tag-exporter.js';
import { validateTagIntegrity } from './ifc/tag-validator.js';
import { allocateElementTags, getSystemTag, normalizeTagScheme } from './tagging/tag-scheme.js';
import { classifyTaggableElement } from './tagging/element-classifier.js';

// Global variables for active model and state
let activeModel = null;
let loadedModels = []; // Track all loaded models: { uuid, name, size, model, visible }
let isWireframe = false;
let excelData = [];
let excelColumns = [];
let selectedExcelIdColumn = "";
let selectedExcelRowIndex = null;
let selectedIfcElement = null;
let currentSelectionMap = {};
let lastIsolatedSelectionMap = {};
let isolationActive = false;
let selectedAppearanceColor = '#f54242';
let selectionHighlightColor = localStorage.getItem('bim-selection-highlight-color') || '#6366f1';
const appearanceColorMaps = new Map();
const continuityHighlightStyleNames = new Set();
const tagAssignments = new Map();
const traySelection = new Map();
let autoRotateActive = false;

// DOM Elements
const container = document.getElementById('viewer-container');
const viewerContextMenu = document.getElementById('viewer-context-menu');
const contextFocusItem = document.getElementById('context-focus-item');
const contextIsolateItem = document.getElementById('context-isolate-item');
const contextColorControl = document.getElementById('context-color-control');
const contextSelectionColor = document.getElementById('context-selection-color');
const contextColorHex = document.getElementById('context-color-hex');
const contextShowAll = document.getElementById('context-show-all');
const sidebar = document.getElementById('sidebar');
const btnSidebarToggle = document.getElementById('sidebar-toggle');
const btnLoadSample = document.getElementById('btn-load-sample');
const btnUpload = document.getElementById('btn-upload');
const fileInput = document.getElementById('file-input');
const btnResetCamera = document.getElementById('btn-reset-camera');
const btnViewerSettings = document.getElementById('btn-viewer-settings');
const viewerSettingsPanel = document.getElementById('viewer-settings-panel');
const selectionHighlightColorInput = document.getElementById('selection-highlight-color');
const selectionHighlightHex = document.getElementById('selection-highlight-hex');
const toggleGrid = document.getElementById('toggle-grid');
const toggleWireframe = document.getElementById('toggle-wireframe');
const toggleDarkMode = document.getElementById('toggle-darkmode');

// Excel DOM Elements
const excelFileInput = document.getElementById('excel-file-input');
const btnUploadExcel = document.getElementById('btn-upload-excel');
const excelPanel = document.getElementById('excel-panel');
const btnExcelPanelClose = document.getElementById('excel-panel-close');
const excelFileName = document.getElementById('excel-file-name');
const excelIdColumn = document.getElementById('excel-id-column');
const excelSearch = document.getElementById('excel-search');
const excelOnlyFields = document.querySelectorAll('.excel-only-field');
const systemTagInput = document.getElementById('system-tag-input');
const systemTagSuggestions = document.getElementById('system-tag-suggestions');
const excelDataTable = document.getElementById('excel-data-table');
const excelTableColgroup = document.getElementById('excel-table-colgroup');
const excelTableHeader = document.getElementById('excel-table-header');
const excelTableBody = document.getElementById('excel-table-body');
const tagAssignmentStatus = document.getElementById('tag-assignment-status');
const tagAssignmentSummary = document.getElementById('tag-assignment-summary');
const traySystemManagerSummary = document.getElementById('tray-system-manager-summary');
const traySystemFilter = document.getElementById('tray-system-filter');
const traySystemSort = document.getElementById('tray-system-sort');
const traySystemList = document.getElementById('tray-system-list');
const traySystemComponentList = document.getElementById('tray-system-component-list');
const traySystemSequenceStatus = document.getElementById('tray-system-sequence-status');
const traySystemContinuityPanel = document.getElementById('tray-system-continuity-panel');
const traySystemContinuityStatus = document.getElementById('tray-system-continuity-status');
const traySystemContinuityBody = document.getElementById('tray-system-continuity-body');
const btnClearContinuityColors = document.getElementById('btn-clear-continuity-colors');
const traySystemDeletionsPanel = document.getElementById('tray-system-deletions-panel');
const traySystemDeletionList = document.getElementById('tray-system-deletion-list');
const btnRestoreAllDeletions = document.getElementById('btn-restore-all-deletions');
const btnAssignTag = document.getElementById('btn-assign-tag');
const btnHighlightSystem = document.getElementById('btn-highlight-system');
const btnAddTraySelection = document.getElementById('btn-add-tray-selection');
const btnUnassignTag = document.getElementById('btn-unassign-tag');
const btnValidateTags = document.getElementById('btn-validate-tags');
const btnExportTags = document.getElementById('btn-export-tags');
const btnExportTaggedIfc = document.getElementById('btn-export-tagged-ifc');
const btnRefreshTraySystems = document.getElementById('btn-refresh-tray-systems');
const btnManagerHighlight = document.getElementById('btn-manager-highlight');
const btnManagerIsolate = document.getElementById('btn-manager-isolate');
const btnManagerAddSelection = document.getElementById('btn-manager-add-selection');
const btnManagerRemoveSelection = document.getElementById('btn-manager-remove-selection');
const btnManagerCheckContinuity = document.getElementById('btn-manager-check-continuity');
const btnManagerRegenerateSequence = document.getElementById('btn-manager-regenerate-sequence');
const btnManagerRename = document.getElementById('btn-manager-rename');
const tagValidationReport = document.getElementById('tag-validation-report');
const tagValidationBadge = document.getElementById('tag-validation-badge');
const tagValidationCounts = document.getElementById('tag-validation-counts');
const tagValidationIssues = document.getElementById('tag-validation-issues');
const traySelectionSummary = document.getElementById('tray-selection-summary');
const tagReplaceDialog = document.getElementById('tag-replace-dialog');
const tagReplaceMessage = document.getElementById('tag-replace-message');
const tagReplaceCancel = document.getElementById('tag-replace-cancel');
const tagReplaceConfirm = document.getElementById('tag-replace-confirm');
const taggingTabAssign = document.getElementById('tagging-tab-assign');
const taggingTabManage = document.getElementById('tagging-tab-manage');
const batchTaggingPane = document.getElementById('batch-tagging-pane');
const tagManagementPane = document.getElementById('tag-management-pane');
const batchPrefix = document.getElementById('batch-prefix');
const batchSystem = document.getElementById('batch-system');
const batchElementKind = document.getElementById('batch-element-kind');
const batchTrayCode = document.getElementById('batch-tray-code');
const batchFittingCode = document.getElementById('batch-fitting-code');
const batchStartSequence = document.getElementById('batch-start-sequence');
const batchSequenceDigits = document.getElementById('batch-sequence-digits');
const batchPatternExample = document.getElementById('batch-pattern-example');
const batchSelectionCount = document.getElementById('batch-selection-count');
const batchStatus = document.getElementById('batch-status');
const batchPreviewPanel = document.getElementById('batch-preview-panel');
const batchPreviewList = document.getElementById('batch-preview-list');
const batchReplaceConflictsRow = document.getElementById('batch-replace-conflicts-row');
const batchReplaceConflicts = document.getElementById('batch-replace-conflicts');
const btnPreviewBatchTags = document.getElementById('btn-preview-batch-tags');
const btnApplyBatchTags = document.getElementById('btn-apply-batch-tags');
const btnUndoBatchTags = document.getElementById('btn-undo-batch-tags');
const excelColumnWidths = new Map();
const MIN_EXCEL_COLUMN_WIDTH = 92;
const DEFAULT_EXCEL_COLUMN_WIDTH = 150;
const ASSIGNMENT_COLUMN_KEY = '__assignment__';
let selectedTraySystemTag = '';
let traySystemFilterText = '';
let traySystemSortMode = 'tag';
let traySystemContinuityReport = null;
let selectionOrderKeys = [];
let batchPreviewElements = [];
let batchPreviewAssignments = [];
let lastBatchSnapshot = null;
const CONTINUITY_GROUP_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#a855f7', '#ef4444'];

// Loaded Models DOM Elements
const loadedModelsContainer = document.getElementById('loaded-models-container');
const loadedModelsList = document.getElementById('loaded-models-list');
const modelsPlaceholder = loadedModelsContainer ? loadedModelsContainer.querySelector('.models-placeholder') : null;

// Orbit DOM Elements
const orbitIndicator = document.getElementById('orbit-indicator');

const loadingOverlay = document.getElementById('loading-overlay');
const loaderTitle = document.getElementById('loader-title');
const loaderStatus = document.getElementById('loader-status');
const loaderProgress = document.getElementById('loader-progress');

const elementPropsPanel = document.getElementById('element-props-panel');
const propTypeBadge = document.getElementById('prop-type-badge');
const propName = document.getElementById('prop-name');
const propGlobalId = document.getElementById('prop-globalid');
const propTag = document.getElementById('prop-tag');
const propExpressId = document.getElementById('prop-expressid');
const propModel = document.getElementById('prop-model');
const propPsetsContainer = document.getElementById('prop-psets-container');

// Utility: Show loading overlay
function showLoader(title, status, progressVal) {
  loadingOverlay.style.display = 'flex';
  loaderTitle.innerText = title;
  loaderStatus.innerText = status;
  loaderProgress.style.width = `${progressVal}%`;
}

// Utility: Hide loading overlay
function hideLoader() {
  loadingOverlay.style.display = 'none';
}

// Utility: Update loading overlay
function updateLoader(status, progressVal) {
  loaderStatus.innerText = status;
  loaderProgress.style.width = `${progressVal}%`;
}

function requestTagReplacement(localId, currentTag, replacementTag) {
  tagReplaceMessage.textContent = `Element #${localId} belongs to tray system “${currentTag}”. Move it to “${replacementTag}”?`;
  tagReplaceDialog.hidden = false;
  tagReplaceConfirm.focus();

  return new Promise((resolve) => {
    const finish = (confirmed) => {
      tagReplaceDialog.hidden = true;
      tagReplaceConfirm.removeEventListener('click', confirm);
      tagReplaceCancel.removeEventListener('click', cancel);
      tagReplaceDialog.removeEventListener('click', cancelFromBackdrop);
      document.removeEventListener('keydown', cancelFromEscape);
      resolve(confirmed);
    };
    const confirm = () => finish(true);
    const cancel = () => finish(false);
    const cancelFromBackdrop = (event) => {
      if (event.target === tagReplaceDialog) finish(false);
    };
    const cancelFromEscape = (event) => {
      if (event.key === 'Escape') finish(false);
    };

    tagReplaceConfirm.addEventListener('click', confirm);
    tagReplaceCancel.addEventListener('click', cancel);
    tagReplaceDialog.addEventListener('click', cancelFromBackdrop);
    document.addEventListener('keydown', cancelFromEscape);
  });
}

// Utility: Format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Main App Initialization
async function initApp() {
  console.log("Initializing BIM Tracker & Viewer...");

  // 1. Initialize Components
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create();

  // 2. Set up Scene, Renderer and Camera
  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.SimpleCamera(components);

  components.init();

  // Initialize Raycaster for the world to enable selection/picking
  components.get(OBC.Raycasters).get(world);


  // ──────────────────────────────────────────────
  //  AUTOCAD-STYLE CAMERA PANNING
  // ──────────────────────────────────────────────
  // AutoCAD-style navigation: hold the mouse wheel and drag to pan the view.
  // This moves the camera target, never the IFC model or its coordinates.
  world.camera.controls.mouseButtons.middle = world.camera.controls.constructor.ACTION.TRUCK;

  // ──────────────────────────────────────────────
  //  AUTO-ORBIT CAMERA ROTATION
  // ──────────────────────────────────────────────
  const autoRotateSpeed = 0.003; // Radians per frame
  
  function updateAutoRotate() {
    if (autoRotateActive && world.camera && world.camera.controls && world.camera.controls.enabled) {
      world.camera.controls.azimuthAngle += autoRotateSpeed;
    }
    requestAnimationFrame(updateAutoRotate);
  }
  
  // Start the animation loop
  updateAutoRotate();

  // Stop auto-orbit on any canvas user interaction
  const stopAutoOrbit = () => {
    if (autoRotateActive) {
      autoRotateActive = false;
      if (orbitIndicator) {
        orbitIndicator.style.display = 'none';
      }
      console.log("[Auto-Orbit] Deactivated by user interaction.");
    }
  };

  if (container) {
    container.addEventListener('pointerdown', stopAutoOrbit);
    container.addEventListener('wheel', stopAutoOrbit);
  }

  // 3. Set up environment (lights and background color)
  world.scene.setup();
  world.scene.three.background = new THREE.Color('#0a0b0e'); // Default match to dark mode

  // Set initial camera position
  world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0);

  // 4. Create Grid
  const grids = components.get(OBC.Grids);
  const grid = grids.create(world);
  if (grid.three) {
    grid.three.position.y = -0.01; // Avoid z-fighting with models resting on 0
  }

  // 5. Initialize Fragments Manager with worker URL from unpkg
  const fragments = components.get(OBC.FragmentsManager);
  try {
    let workerUrl = "";
    if (OBC.FragmentsManager && OBC.FragmentsManager.getWorker) {
      workerUrl = await OBC.FragmentsManager.getWorker();
    } else if (fragments && fragments.getWorker) {
      workerUrl = await fragments.getWorker();
    }
    if (workerUrl) {
      fragments.init(workerUrl);
      console.log("FragmentsManager initialized with worker.");
    } else {
      fragments.init();
      console.log("FragmentsManager initialized without worker.");
    }
  } catch (e) {
    console.warn("FragmentsManager worker setup failed, falling back to main-thread processing:", e);
    fragments.init();
  }
  // Low-quality LOD lines are visible but intentionally carry no element ID,
  // so the picker cannot select them. Prefer full selectable geometry.
  fragments.core.settings.graphicsQuality = 1;

  // 6. Set up IfcLoader and Configure WASM path
  const ifcLoader = components.get(OBC.IfcLoader);
  ifcLoader.settings.autoSetWasm = false;
  ifcLoader.settings.wasm = {
    path: "https://unpkg.com/web-ifc@0.0.77/",
    absolute: true
  };
  // Rebase the first IFC near the viewer origin for numerical stability.
  // The `coordinate: true` load option below retains the source coordination
  // data and positions later federated models relative to that first model.
  ifcLoader.settings.webIfc = {
    ...ifcLoader.settings.webIfc,
    COORDINATE_TO_ORIGIN: true,
  };
  await ifcLoader.setup();
  console.log("IfcLoader WASM set up successfully.");

  // Current FragmentsModel versions expose relations through getItemsData().
  // Keep the legacy variable for the old-property fallback without requesting
  // the removed IfcRelationsIndexer component.
  let indexer = null;

  // 7. Set up Highlighter
  const highlighter = components.get(OBF.Highlighter);
  highlighter.setup({ world });
  // Allow normal hand jitter without interpreting an intended click as orbiting.
  highlighter.mouseMoveThreshold = 10;
  setSelectionHighlightStyle(selectionHighlightColor);
  const hider = components.get(OBC.Hider);
  const routingController = initRoutingController({
    world,
    getLoadedModels: () => loadedModels,
    onClear: () => {
      traySystemContinuityReport = null;
      renderTraySystemContinuityReport();
      clearContinuityGroupHighlights();
    },
  });

  function getAssignmentKey(modelId, localId) {
    return `${modelId}:${Number(localId)}`;
  }

  function getBatchScheme() {
    return normalizeTagScheme({
      prefix: batchPrefix?.value,
      system: batchSystem?.value,
      separator: '.',
      sequenceDigits: batchSequenceDigits?.value,
      startSequence: batchStartSequence?.value,
      typeCodes: {
        tray: batchTrayCode?.value,
        fitting: batchFittingCode?.value,
      },
    });
  }

  function setBatchStatus(message, tone = '') {
    if (!batchStatus) return;
    batchStatus.textContent = message;
    if (tone) batchStatus.dataset.tone = tone;
    else delete batchStatus.dataset.tone;
  }

  function updateBatchPatternExample() {
    if (!batchPatternExample) return;
    const scheme = getBatchScheme();
    const requestedKind = batchElementKind?.value === 'fitting' ? 'fitting' : 'tray';
    const sequence = String(scheme.startSequence).padStart(scheme.sequenceDigits, '0');
    batchPatternExample.textContent = [
      getSystemTag(scheme),
      scheme.typeCodes[requestedKind],
      sequence,
    ].join(scheme.separator);
  }

  function setTaggingMode(mode) {
    const assignActive = mode !== 'manage';
    batchTaggingPane.hidden = !assignActive;
    tagManagementPane.hidden = assignActive;
    taggingTabAssign.classList.toggle('active', assignActive);
    taggingTabManage.classList.toggle('active', !assignActive);
    taggingTabAssign.setAttribute('aria-selected', String(assignActive));
    taggingTabManage.setAttribute('aria-selected', String(!assignActive));
  }

  function selectedKeysFromMap(modelIdMap = getSelectedModelIdMap()) {
    const keys = [];
    for (const [modelId, ids] of Object.entries(modelIdMap || {})) {
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      for (const localId of values) keys.push(getAssignmentKey(modelId, localId));
    }
    return keys;
  }

  function reconcileSelectionOrder(modelIdMap = getSelectedModelIdMap()) {
    const selectedKeys = selectedKeysFromMap(modelIdMap);
    const selectedSet = new Set(selectedKeys);
    selectionOrderKeys = [
      ...selectionOrderKeys.filter((key) => selectedSet.has(key)),
      ...selectedKeys.filter((key) => !selectionOrderKeys.includes(key)),
    ];
    if (batchSelectionCount) {
      const count = selectedKeys.length;
      batchSelectionCount.textContent = `${count} selected`;
    }
    if (btnPreviewBatchTags) btnPreviewBatchTags.disabled = selectedKeys.length === 0;
  }

  async function getOrderedCurrentSelectionElements() {
    const selection = getSelectedModelIdMap();
    reconcileSelectionOrder(selection);
    const selectedSet = new Set(selectedKeysFromMap(selection));
    const elements = [];
    for (const key of selectionOrderKeys) {
      if (!selectedSet.has(key)) continue;
      const separatorIndex = key.lastIndexOf(':');
      const modelId = key.slice(0, separatorIndex);
      const localId = Number(key.slice(separatorIndex + 1));
      const modelEntry = findLoadedModelEntry(modelId);
      if (!modelEntry || !Number.isInteger(localId)) continue;
      elements.push(await readElementIdentity(modelEntry.model, localId, modelEntry.name));
    }
    return elements;
  }

  function getEffectiveAssignmentForElement(element) {
    const key = getAssignmentKey(element.modelId, element.localId);
    return getEffectiveTaggedElements().find((item) => getAssignmentKey(item.modelId, item.localId) === key) || null;
  }

  function clearBatchPreview(message = '') {
    batchPreviewElements = [];
    batchPreviewAssignments = [];
    batchPreviewList.innerHTML = '';
    batchPreviewPanel.hidden = true;
    batchReplaceConflictsRow.hidden = true;
    batchReplaceConflicts.checked = false;
    btnApplyBatchTags.disabled = true;
    if (message) setBatchStatus(message);
  }

  function invalidateBatchUndo() {
    lastBatchSnapshot = null;
    if (btnUndoBatchTags) btnUndoBatchTags.disabled = true;
  }

  function renderBatchPreview() {
    batchPreviewList.innerHTML = '';
    const hasConflicts = batchPreviewAssignments.some((item) => item.conflict);
    batchReplaceConflictsRow.hidden = !hasConflicts;
    for (let index = 0; index < batchPreviewAssignments.length; index += 1) {
      const assignment = batchPreviewAssignments[index];
      const item = document.createElement('li');
      item.className = 'batch-preview-item';
      item.dataset.conflict = String(Boolean(assignment.conflict));

      const copy = document.createElement('div');
      copy.className = 'batch-preview-copy';
      const tag = document.createElement('strong');
      tag.className = 'batch-preview-tag';
      tag.textContent = assignment.elementTag;
      const meta = document.createElement('span');
      meta.className = 'batch-preview-meta';
      const kindLabel = assignment.elementKind === 'fitting' ? 'Cable fitting' : 'Cable tray';
      const conflictLabel = assignment.conflict ? ` · replaces ${assignment.previousTag}` : '';
      meta.textContent = `${kindLabel} · ${assignment.name || assignment.type || `Element #${assignment.localId}`}${conflictLabel}`;
      copy.append(tag, meta);

      const actions = document.createElement('div');
      actions.className = 'batch-order-actions';
      for (const [label, offset] of [['↑', -1], ['↓', 1]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'batch-order-button';
        button.textContent = label;
        button.title = offset < 0 ? 'Move earlier' : 'Move later';
        button.setAttribute('aria-label', `${button.title}: ${assignment.elementTag}`);
        button.disabled = offset < 0 ? index === 0 : index === batchPreviewAssignments.length - 1;
        button.addEventListener('click', async () => {
          const target = index + offset;
          [batchPreviewElements[index], batchPreviewElements[target]] = [batchPreviewElements[target], batchPreviewElements[index]];
          await generateBatchPreview(batchPreviewElements);
        });
        actions.appendChild(button);
      }
      item.append(copy, actions);
      batchPreviewList.appendChild(item);
    }
    batchPreviewPanel.hidden = false;
    btnApplyBatchTags.disabled = hasConflicts && !batchReplaceConflicts.checked;
  }

  async function generateBatchPreview(elements) {
    const requestedKind = batchElementKind.value;
    const classified = elements.map((element) => {
      if (requestedKind !== 'auto') {
        return { ...element, resolvedKind: requestedKind, classificationMethod: 'manual', classificationConfidence: 1 };
      }
      const result = classifyTaggableElement(element);
      return {
        ...element,
        resolvedKind: result.kind,
        classificationMethod: result.evidence,
        classificationConfidence: result.confidence,
      };
    });
    const unresolved = classified.filter((element) => !element.resolvedKind);
    if (unresolved.length) {
      clearBatchPreview();
      setBatchStatus(
        `${unresolved.length} selected element${unresolved.length === 1 ? '' : 's'} could not be classified. Choose Cable Tray or Cable Fitting explicitly.`,
        'warning',
      );
      return false;
    }

    const existingAssignments = getEffectiveTaggedElements();
    const generatedByKey = new Map();
    for (const kind of ['tray', 'fitting']) {
      const kindElements = classified.filter((element) => element.resolvedKind === kind);
      if (!kindElements.length) continue;
      const result = allocateElementTags({
        elements: kindElements,
        elementKind: kind,
        scheme: getBatchScheme(),
        existingAssignments,
      });
      if (!result.valid) {
        clearBatchPreview();
        setBatchStatus(result.errors.join(' '), 'warning');
        return false;
      }
      for (const assignment of result.assignments) {
        generatedByKey.set(getAssignmentKey(assignment.modelId, assignment.localId), assignment);
      }
    }

    batchPreviewAssignments = classified.map((element) => {
      const key = getAssignmentKey(element.modelId, element.localId);
      const generated = generatedByKey.get(key);
      const previousAssignment = getEffectiveAssignmentForElement(element);
      const previousTag = previousAssignment?.componentId || element.ifcTag || '';
      const conflict = Boolean(previousTag && previousTag.toLowerCase() !== generated.componentId.toLowerCase());
      return {
        ...generated,
        classificationMethod: element.classificationMethod,
        classificationConfidence: element.classificationConfidence,
        originalIfcTag: element.ifcTag || '',
        previousAssignment,
        previousTag,
        conflict,
      };
    });
    renderBatchPreview();
    const conflictCount = batchPreviewAssignments.filter((item) => item.conflict).length;
    setBatchStatus(
      conflictCount
        ? `Preview ready with ${conflictCount} existing assignment conflict${conflictCount === 1 ? '' : 's'}.`
        : `${batchPreviewAssignments.length} tag${batchPreviewAssignments.length === 1 ? '' : 's'} ready to apply in the displayed order.`,
      conflictCount ? 'warning' : 'success',
    );
    return true;
  }

  function cloneModelIdMap(modelIdMap = {}) {
    const clone = {};
    for (const [modelId, ids] of Object.entries(modelIdMap || {})) {
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      if (values.length) clone[modelId] = new Set(values.map(Number));
    }
    return clone;
  }

  function countModelIdMapItems(modelIdMap = {}) {
    return Object.values(modelIdMap).reduce((sum, ids) => {
      if (ids instanceof Set) return sum + ids.size;
      if (Array.isArray(ids)) return sum + ids.length;
      return sum;
    }, 0);
  }

  function areModelIdMapsEqual(a = {}, b = {}) {
    const aKeys = Object.keys(a).filter((key) => countModelIdMapItems({ [key]: a[key] }) > 0).sort();
    const bKeys = Object.keys(b).filter((key) => countModelIdMapItems({ [key]: b[key] }) > 0).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const key = aKeys[i];
      if (key !== bKeys[i]) return false;
      const aValues = a[key] instanceof Set ? Array.from(a[key]) : Array.isArray(a[key]) ? a[key] : [];
      const bValues = b[key] instanceof Set ? Array.from(b[key]) : Array.isArray(b[key]) ? b[key] : [];
      if (aValues.length !== bValues.length) return false;
      const bSet = new Set(bValues.map(Number));
      if (aValues.some((id) => !bSet.has(Number(id)))) return false;
    }
    return true;
  }

  function getSelectedModelIdMap() {
    if (countModelIdMapItems(currentSelectionMap)) return cloneModelIdMap(currentSelectionMap);
    if (!selectedIfcElement) return {};
    return { [selectedIfcElement.modelId]: new Set([Number(selectedIfcElement.localId)]) };
  }

  function addModelIdMapItems(target, source) {
    for (const [modelId, ids] of Object.entries(source || {})) {
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      if (!values.length) continue;
      if (!target[modelId]) target[modelId] = new Set();
      for (const id of values) target[modelId].add(Number(id));
    }
  }

  function removeModelIdMapItems(target, source) {
    for (const [modelId, ids] of Object.entries(source || {})) {
      if (!target[modelId]) continue;
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      for (const id of values) target[modelId].delete(Number(id));
      if (target[modelId].size === 0) delete target[modelId];
    }
  }

  function appearanceStyleName(color) {
    return `appearance-${color.replace('#', '').toLowerCase()}`;
  }

  function normalizeHexColor(value) {
    const raw = String(value || '').trim();
    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
  }

  function setSelectionHighlightStyle(color) {
    const normalized = normalizeHexColor(color) || '#6366f1';
    selectionHighlightColor = normalized;
    highlighter.styles.set('select', {
      color: new THREE.Color(selectionHighlightColor),
      opacity: 0.6,
      transparent: true,
    });
    if (selectionHighlightColorInput) selectionHighlightColorInput.value = selectionHighlightColor;
    if (selectionHighlightHex) selectionHighlightHex.value = selectionHighlightColor.toUpperCase();
    localStorage.setItem('bim-selection-highlight-color', selectionHighlightColor);
  }

  async function applySelectionHighlightSetting(color) {
    setSelectionHighlightStyle(color);
    const selection = getSelectedModelIdMap();
    if (countModelIdMapItems(selection) === 0) return;

    highlighter.isProgrammaticSelect = true;
    try {
      await highlighter.clear('select');
      await highlighter.highlightByID('select', selection, false, false);
      currentSelectionMap = cloneModelIdMap(selection);
    } catch (error) {
      console.warn('[Selection Highlight] Could not refresh selected element color:', error);
      updateTagAssignmentUi('Warning: selected element highlight color could not be refreshed.', 'warning');
    } finally {
      highlighter.isProgrammaticSelect = false;
    }
  }

  async function reapplyAppearanceColors() {
    for (const [color, modelIdMap] of appearanceColorMaps) {
      const styleName = appearanceStyleName(color);
      await highlighter.clear(styleName);
      if (countModelIdMapItems(modelIdMap) === 0) continue;
      highlighter.styles.set(styleName, {
        color: new THREE.Color(color),
        opacity: 0.85,
        transparent: true,
      });
      await highlighter.highlightByID(styleName, modelIdMap, false, false);
    }
  }

  async function applyAppearanceColorToCurrentSelection() {
    const selection = getSelectedModelIdMap();
    if (countModelIdMapItems(selection) === 0) return;
    highlighter.isProgrammaticSelect = true;
    try {
      for (const [, modelIdMap] of appearanceColorMaps) {
        removeModelIdMapItems(modelIdMap, selection);
      }
      if (!appearanceColorMaps.has(selectedAppearanceColor)) {
        appearanceColorMaps.set(selectedAppearanceColor, {});
      }
      addModelIdMapItems(appearanceColorMaps.get(selectedAppearanceColor), selection);
      await reapplyAppearanceColors();
      currentSelectionMap = cloneModelIdMap(selection);
    } catch (error) {
      console.warn('[Appearance Color] Could not color selected elements:', error);
      updateTagAssignmentUi('Warning: selected elements could not be colored.', 'warning');
    } finally {
      highlighter.isProgrammaticSelect = false;
    }
  }

  async function clearContinuityGroupHighlights() {
    for (const styleName of continuityHighlightStyleNames) {
      await highlighter.clear(styleName);
    }
    continuityHighlightStyleNames.clear();
  }

  async function applyContinuityGroupHighlights(groups = []) {
    await clearContinuityGroupHighlights();
    highlighter.isProgrammaticSelect = true;
    try {
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const color = CONTINUITY_GROUP_COLORS[index % CONTINUITY_GROUP_COLORS.length];
        const styleName = `continuity-group-${index + 1}`;
        const fragmentMap = {};
        for (const member of group.members || []) {
          if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
          fragmentMap[member.modelId].add(Number(member.localId));
        }
        if (countModelIdMapItems(fragmentMap) === 0) continue;
        highlighter.styles.set(styleName, {
          color: new THREE.Color(color),
          opacity: 0.85,
          transparent: true,
        });
        continuityHighlightStyleNames.add(styleName);
        await highlighter.highlightByID(styleName, fragmentMap, false, false);
      }
    } catch (error) {
      console.warn('[Tray Systems] Continuity group highlight failed:', error);
      updateTagAssignmentUi('Warning: continuity groups could not be colored in the viewer.', 'warning');
    } finally {
      highlighter.isProgrammaticSelect = false;
    }
  }

  function getEnteredSystemTag() {
    return systemTagInput.value.trim();
  }

  function getAssignmentForElement(element = selectedIfcElement) {
    if (!element) return null;
    return tagAssignments.get(getAssignmentKey(element.modelId, element.localId)) || null;
  }

  function getExistingProjectTag(element = selectedIfcElement) {
    if (!element) return '';
    const modelEntry = loadedModels.find((entry) =>
      entry.model?.modelId === element.modelId || entry.model?.uuid === element.modelId
    );
    return modelEntry?.existingProjectTags?.get(Number(element.localId))?.systemTag || '';
  }

  function findLoadedModelEntry(modelId) {
    return loadedModels.find((entry) =>
      entry.model?.modelId === modelId ||
      entry.model?.uuid === modelId ||
      entry.uuid === modelId
    ) || null;
  }

  function getExistingTrayAssignment(element) {
    if (!element) return null;
    return findLoadedModelEntry(element.modelId)?.existingProjectTags?.get(Number(element.localId)) || null;
  }

  function getAssignmentSourceLabel(element) {
    if (!element) return 'Unknown';
    if (element.delete === true) return 'Deleted';
    if (element.source === 'pending' && element.wasSaved) return 'Modified';
    if (element.source === 'pending') return 'Pending';
    return 'Saved';
  }

  function findSystemMembers(tag) {
    const normalizedTag = String(tag || '').trim().toLowerCase();
    if (!normalizedTag) return [];
    const members = [];

    for (const [key, assignment] of tagAssignments) {
      if (assignment.delete === true) continue;
      if (assignment.systemTag.toLowerCase() === normalizedTag) {
        const existing = getExistingTrayAssignment(assignment);
        members.push({
          ...assignment,
          source: 'pending',
          wasSaved: Boolean(existing),
        });
      }
    }

    for (const modelEntry of loadedModels) {
      const modelId = modelEntry.model.modelId || modelEntry.model.uuid;
      for (const [localId, projectTag] of modelEntry.existingProjectTags || []) {
        const key = getAssignmentKey(modelId, localId);
        if (tagAssignments.has(key)) continue;
        if (projectTag.systemTag.toLowerCase() === normalizedTag) {
          members.push({
            modelId,
            modelName: modelEntry.name,
            localId: Number(localId),
            globalId: '',
            systemTag: projectTag.systemTag,
            elementTag: projectTag.elementTag || projectTag.componentId,
            componentId: projectTag.componentId,
            elementKind: projectTag.elementKind || '',
            typeCode: projectTag.typeCode || '',
            sequenceNumber: projectTag.sequenceNumber,
            schemeVersion: projectTag.schemeVersion || '',
            source: 'ifc',
          });
        }
      }
    }
    return members;
  }

  function getTraySystemSummaries() {
    const systems = new Map();
    for (const element of getEffectiveTaggedElements()) {
      const tag = String(element.systemTag || '').trim();
      if (!tag) continue;
      const normalized = tag.toLowerCase();
      if (!systems.has(normalized)) {
        systems.set(normalized, {
          tag,
          members: [],
          modelNames: new Set(),
          modifiedCount: 0,
          pendingCount: 0,
          ifcCount: 0,
          deletedCount: 0,
        });
      }
      const system = systems.get(normalized);
      system.members.push(element);
      if (element.modelName) system.modelNames.add(element.modelName);
      if (element.source === 'pending' && element.wasSaved) system.modifiedCount += 1;
      else if (element.source === 'pending') system.pendingCount += 1;
      else system.ifcCount += 1;
    }

    for (const assignment of tagAssignments.values()) {
      if (assignment.delete !== true) continue;
      const tag = String(assignment.systemTag || '').trim();
      if (!tag) continue;
      const normalized = tag.toLowerCase();
      if (!systems.has(normalized)) {
        systems.set(normalized, {
          tag,
          members: [],
          modelNames: new Set(),
          modifiedCount: 0,
          pendingCount: 0,
          ifcCount: 0,
          deletedCount: 0,
        });
      }
      const system = systems.get(normalized);
      system.deletedCount += 1;
      if (assignment.modelName) system.modelNames.add(assignment.modelName);
    }

    return Array.from(systems.values())
      .map((system) => ({
        ...system,
        count: system.members.length,
        models: Array.from(system.modelNames).sort((a, b) => a.localeCompare(b)),
        status: system.deletedCount && !system.modifiedCount && !system.pendingCount && !system.ifcCount
          ? 'Deleted'
          : system.deletedCount
          ? 'Mixed'
          : system.modifiedCount && !system.pendingCount && !system.ifcCount
          ? 'Modified'
          : (system.pendingCount || system.modifiedCount) && system.ifcCount
          ? 'Mixed'
          : system.pendingCount ? 'Pending'
          : system.modifiedCount ? 'Modified'
          : 'Saved',
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  function parseSequenceNumber(value) {
    const parsed = Number.parseInt(String(value || '').replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sortSystemMembers(members = []) {
    return [...members].sort((a, b) => {
      const aSeq = parseSequenceNumber(a.sequenceNumber);
      const bSeq = parseSequenceNumber(b.sequenceNumber);
      if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq;
      if (aSeq !== null && bSeq === null) return -1;
      if (aSeq === null && bSeq !== null) return 1;
      return Number(a.localId) - Number(b.localId);
    });
  }

  function getSequenceDiagnostics(members = []) {
    if (!members.length) return { tone: '', message: 'Select a system' };
    const sequenceCounts = new Map();
    let missing = 0;
    for (const member of members) {
      const sequence = parseSequenceNumber(member.sequenceNumber);
      if (sequence === null) {
        missing += 1;
        continue;
      }
      sequenceCounts.set(sequence, (sequenceCounts.get(sequence) || 0) + 1);
    }
    const duplicates = Array.from(sequenceCounts.values()).filter((count) => count > 1).length;
    const sequenceValues = Array.from(sequenceCounts.keys()).sort((a, b) => a - b);
    let gaps = 0;
    for (let expected = 1; expected <= sequenceValues.length; expected++) {
      if (!sequenceCounts.has(expected)) gaps += 1;
    }
    if (missing || duplicates || gaps) {
      const parts = [];
      if (missing) parts.push(`${missing} missing`);
      if (duplicates) parts.push(`${duplicates} duplicate`);
      if (gaps) parts.push(`${gaps} gap${gaps === 1 ? '' : 's'}`);
      return { tone: 'warning', message: parts.join(' | ') };
      return { tone: 'warning', message: parts.join(' · ') };
    }
    return { tone: 'success', message: 'Sequence OK' };
  }

  async function highlightSingleTrayComponent(member) {
    const modelEntry = findLoadedModelEntry(member.modelId);
    if (!modelEntry) {
      updateTagAssignmentUi(`Warning: model for component #${member.localId} is not loaded.`, 'warning');
      return;
    }
    const modelId = modelEntry.model.modelId || modelEntry.model.uuid || member.modelId;
    highlighter.isProgrammaticSelect = true;
    try {
      const fragmentMap = { [modelId]: new Set([Number(member.localId)]) };
      await highlighter.highlightByID('select', fragmentMap, true, true);
      currentSelectionMap = cloneModelIdMap(fragmentMap);
      activeModel = modelEntry.model;
      await displayElementProperties(modelEntry.model, member.localId, modelEntry.name);
      selectedIfcElement = await readElementIdentity(modelEntry.model, member.localId, modelEntry.name);
      routingController.setSelectedElement(modelEntry.model, member.localId);
      updateTagAssignmentUi(`Highlighted component "${member.componentId || `#${member.localId}`}".`);
    } catch (error) {
      console.warn('[Tray Systems] Component highlight failed:', error);
      updateTagAssignmentUi(`Warning: component #${member.localId} could not be highlighted.`, 'warning');
    } finally {
      highlighter.isProgrammaticSelect = false;
    }
  }

  async function checkSelectedTraySystemContinuity() {
    if (!selectedTraySystemTag) return;
    const graph = routingController.getGraph?.();
    const diagnostics = routingController.getDiagnostics?.();
    if (!graph || !diagnostics) {
      traySystemContinuityReport = null;
      renderTraySystemContinuityReport();
      updateTagAssignmentUi('Warning: build the routing graph before checking tray-system continuity.', 'warning');
      return;
    }

    const members = findSystemMembers(selectedTraySystemTag);
    if (!members.length) {
      traySystemContinuityReport = null;
      renderTraySystemContinuityReport();
      updateTagAssignmentUi(`Warning: tray system "${selectedTraySystemTag}" has no loaded components.`, 'warning');
      return;
    }

    const memberEntries = members.map((member) => ({
      member,
      edgeId: `${member.modelId}:${member.localId}`,
      componentIndex: null,
    }));
    const missingEntries = memberEntries.filter((entry) => !graph.edges.has(entry.edgeId));
    const groupMap = new Map();
    diagnostics.components.forEach((component, index) => {
      for (const entry of memberEntries) {
        if (!component.edgeIds.has(entry.edgeId)) continue;
        entry.componentIndex = index;
        if (!groupMap.has(index)) groupMap.set(index, []);
        groupMap.get(index).push(entry.member);
      }
    });
    const groups = Array.from(groupMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, groupMembers]) => ({
        number: index + 1,
        color: CONTINUITY_GROUP_COLORS[index % CONTINUITY_GROUP_COLORS.length],
        members: groupMembers,
        components: groupMembers.map(formatContinuityComponent),
      }));
    const representedCount = memberEntries.length - missingEntries.length;
    const missingComponents = missingEntries.map((entry) => formatContinuityComponent(entry.member));
    const isContinuous = groups.length === 1 && !missingComponents.length;
    const tone = isContinuous ? 'success' : 'warning';
    const statusLabel = groups.length === 1
      ? missingComponents.length ? 'Partial' : 'Continuous'
      : groups.length > 1 ? 'Split' : 'Not represented';

    traySystemContinuityReport = {
      systemTag: selectedTraySystemTag,
      statusLabel,
      tone,
      totalComponents: members.length,
      representedComponents: representedCount,
      missingComponents,
      groups,
    };
    renderTraySystemContinuityReport();
    await applyContinuityGroupHighlights(groups);

    if (!groups.length) {
      updateTagAssignmentUi(
        `Warning: tray system "${selectedTraySystemTag}" has no components represented in the routing graph.`,
        'warning',
      );
      return;
    }

    const missingSuffix = missingComponents.length
      ? ` ${missingComponents.length} component${missingComponents.length === 1 ? '' : 's'} are not represented in the graph.`
      : '';
    if (groups.length === 1) {
      updateTagAssignmentUi(
        `Tray system "${selectedTraySystemTag}" is graph-continuous across ${representedCount}/${members.length} component${members.length === 1 ? '' : 's'}.${missingSuffix}`,
        missingComponents.length ? 'warning' : 'success',
      );
      return;
    }

    updateTagAssignmentUi(
      `Warning: tray system "${selectedTraySystemTag}" is split across ${groups.length} disconnected graph components.${missingSuffix}`,
      'warning',
    );
  }

  function formatContinuityComponent(member) {
    return member.componentId || `#${member.localId}`;
  }

  function renderTraySystemContinuityReport() {
    if (!traySystemContinuityPanel || !traySystemContinuityStatus || !traySystemContinuityBody) return;
    const report = traySystemContinuityReport;
    const reportMatchesSelection = report?.systemTag?.toLowerCase() === selectedTraySystemTag.toLowerCase();
    traySystemContinuityPanel.hidden = !report || !reportMatchesSelection;
    traySystemContinuityBody.innerHTML = '';
    delete traySystemContinuityStatus.dataset.tone;
    if (!report || !reportMatchesSelection) {
      traySystemContinuityStatus.textContent = 'Not checked';
      return;
    }

    traySystemContinuityStatus.textContent = report.statusLabel;
    traySystemContinuityStatus.dataset.tone = report.tone;

    const stats = document.createElement('div');
    stats.className = 'tray-system-continuity-stats';
    const statItems = [
      ['Total', report.totalComponents],
      ['In graph', report.representedComponents],
      ['Missing', report.missingComponents.length],
      ['Groups', report.groups.length],
    ];
    for (const [label, value] of statItems) {
      const item = document.createElement('span');
      item.className = 'tray-system-continuity-stat';
      const valueElement = document.createElement('strong');
      valueElement.textContent = value;
      const labelElement = document.createElement('small');
      labelElement.textContent = label;
      item.append(valueElement, labelElement);
      stats.appendChild(item);
    }
    traySystemContinuityBody.appendChild(stats);

    if (report.groups.length) {
      const groups = document.createElement('div');
      groups.className = 'tray-system-continuity-section';
      const heading = document.createElement('span');
      heading.className = 'tray-system-continuity-section-title';
      heading.textContent = 'Connected graph groups';
      groups.appendChild(heading);
      for (const group of report.groups) {
        const item = document.createElement('div');
        item.className = 'tray-system-continuity-group';
        const chip = document.createElement('span');
        chip.className = 'tray-system-continuity-color';
        chip.style.background = group.color;
        const text = document.createElement('span');
        text.textContent = `Group ${group.number}: ${group.components.join(', ')}`;
        item.append(chip, text);
        groups.appendChild(item);
      }
      traySystemContinuityBody.appendChild(groups);
    }

    if (report.missingComponents.length) {
      const missing = document.createElement('div');
      missing.className = 'tray-system-continuity-section';
      const heading = document.createElement('span');
      heading.className = 'tray-system-continuity-section-title';
      heading.textContent = 'Missing from graph';
      const body = document.createElement('div');
      body.className = 'tray-system-continuity-group warning';
      body.textContent = report.missingComponents.join(', ');
      missing.append(heading, body);
      traySystemContinuityBody.appendChild(missing);
    }
  }

  function renderTraySystemComponents(system) {
    if (!traySystemComponentList || !traySystemSequenceStatus) return;
    traySystemComponentList.innerHTML = '';
    if (!system) {
      traySystemSequenceStatus.textContent = 'Select a system';
      delete traySystemSequenceStatus.dataset.tone;
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'Select a tray system to inspect its components.';
      traySystemComponentList.appendChild(empty);
      return;
    }

    const members = sortSystemMembers(system.members);
    const diagnostics = getSequenceDiagnostics(members);
    traySystemSequenceStatus.textContent = diagnostics.message;
    if (diagnostics.tone) traySystemSequenceStatus.dataset.tone = diagnostics.tone;
    else delete traySystemSequenceStatus.dataset.tone;

    if (!members.length) {
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'This tray system has no components.';
      traySystemComponentList.appendChild(empty);
      return;
    }

    for (const member of members) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tray-system-component-item';
      item.title = 'Click to highlight this component in the viewer.';

      const componentId = document.createElement('span');
      componentId.className = 'tray-system-component-id';
      componentId.textContent = member.componentId || '(missing component ID)';

      const meta = document.createElement('span');
      meta.className = 'tray-system-component-meta';
      meta.textContent = `Seq ${member.sequenceNumber || '-'} · #${member.localId} · ${member.source === 'pending' ? 'Pending' : 'Saved'}`;

      item.append(componentId, meta);
      meta.textContent = `Seq ${member.sequenceNumber || '-'} | #${member.localId} | ${getAssignmentSourceLabel(member)}`;
      item.addEventListener('click', () => highlightSingleTrayComponent(member));
      traySystemComponentList.appendChild(item);
    }
  }

  function getPendingTrayDeletions() {
    return Array.from(tagAssignments.values())
      .filter((assignment) => assignment.delete === true)
      .sort((a, b) =>
        String(a.systemTag || '').localeCompare(String(b.systemTag || '')) ||
        Number(a.localId) - Number(b.localId)
      );
  }

  function restorePendingTrayDeletion(assignment) {
    if (!assignment) return;
    invalidateBatchUndo();
    tagAssignments.delete(getAssignmentKey(assignment.modelId, assignment.localId));
    const model = findLoadedModelEntry(assignment.modelId)?.model || activeModel;
    syncProjectTagPropertyGroup(model, assignment.localId);
    renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi(`Restored saved IFC tag for element #${assignment.localId}.`, 'success');
  }

  function restoreAllPendingTrayDeletions() {
    const deletions = getPendingTrayDeletions();
    if (!deletions.length) return;
    invalidateBatchUndo();
    for (const deletion of deletions) {
      tagAssignments.delete(getAssignmentKey(deletion.modelId, deletion.localId));
      const model = findLoadedModelEntry(deletion.modelId)?.model || activeModel;
      syncProjectTagPropertyGroup(model, deletion.localId);
    }
    renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi(`Restored ${deletions.length} pending deletion${deletions.length === 1 ? '' : 's'}.`, 'success');
  }

  function renderPendingTrayDeletions() {
    if (!traySystemDeletionsPanel || !traySystemDeletionList) return;
    const deletions = getPendingTrayDeletions();
    traySystemDeletionsPanel.hidden = deletions.length === 0;
    traySystemDeletionList.innerHTML = '';
    if (!deletions.length) return;

    for (const deletion of deletions) {
      const item = document.createElement('div');
      item.className = 'tray-system-deletion-item';

      const details = document.createElement('span');
      details.className = 'tray-system-deletion-details';
      details.textContent = `${deletion.systemTag || '(no system)'} | #${deletion.localId} | ${deletion.componentId || 'no component'}`;

      const showButton = document.createElement('button');
      showButton.type = 'button';
      showButton.className = 'tray-system-deletion-action';
      showButton.textContent = 'Show';
      showButton.addEventListener('click', () => highlightSingleTrayComponent(deletion));

      const restoreButton = document.createElement('button');
      restoreButton.type = 'button';
      restoreButton.className = 'tray-system-deletion-action tray-system-deletion-restore';
      restoreButton.textContent = 'Restore';
      restoreButton.addEventListener('click', () => restorePendingTrayDeletion(deletion));

      item.append(details, showButton, restoreButton);
      traySystemDeletionList.appendChild(item);
    }
  }

  function getVisibleTraySystems(systems = []) {
    const normalizedFilter = traySystemFilterText.trim().toLowerCase();
    const filtered = normalizedFilter
      ? systems.filter((system) =>
          system.tag.toLowerCase().includes(normalizedFilter) ||
          system.models.some((modelName) => modelName.toLowerCase().includes(normalizedFilter)) ||
          system.status.toLowerCase().includes(normalizedFilter)
        )
      : [...systems];

    return filtered.sort((a, b) => {
      if (traySystemSortMode === 'count-desc') {
        if (b.count !== a.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag);
      }
      if (traySystemSortMode === 'status') {
        const statusCompare = a.status.localeCompare(b.status);
        return statusCompare || a.tag.localeCompare(b.tag);
      }
      return a.tag.localeCompare(b.tag);
    });
  }

  function createTraySystemBadge(label, state = label) {
    const badge = document.createElement('span');
    badge.className = 'tray-system-badge';
    badge.dataset.state = String(state || label).toLowerCase();
    badge.textContent = label;
    return badge;
  }

  function renderTraySystemManager() {
    if (!traySystemList) return;
    const systems = getTraySystemSummaries();
    const visibleSystems = getVisibleTraySystems(systems);
    const selectedStillExists = systems.some((system) => system.tag.toLowerCase() === selectedTraySystemTag.toLowerCase());
    if (!selectedStillExists) selectedTraySystemTag = '';

    if (traySystemManagerSummary) {
      const pendingDeletions = Array.from(tagAssignments.values()).filter((assignment) => assignment.delete === true).length;
      const filterSuffix = visibleSystems.length !== systems.length
        ? ` | ${visibleSystems.length}/${systems.length} shown`
        : '';
      traySystemManagerSummary.textContent = systems.length
        ? `${systems.length} system${systems.length === 1 ? '' : 's'} loaded${filterSuffix}${pendingDeletions ? ` · ${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}` : ''}.`
        : pendingDeletions
          ? `${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}.`
          : 'No tray systems loaded.';
      const deletionSuffix = pendingDeletions
        ? ` | ${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}`
        : '';
      traySystemManagerSummary.textContent = systems.length
        ? `${systems.length} system${systems.length === 1 ? '' : 's'} loaded${filterSuffix}${deletionSuffix}.`
        : pendingDeletions
          ? `${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}.`
          : 'No tray systems loaded.';
    }
    traySystemList.innerHTML = '';

    if (!systems.length) {
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'Assign or load tray-system tags to manage them here.';
      traySystemList.appendChild(empty);
    } else if (!visibleSystems.length) {
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'No tray systems match the current search.';
      traySystemList.appendChild(empty);
    } else {
      for (const system of visibleSystems) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tray-system-item';
        if (system.tag.toLowerCase() === selectedTraySystemTag.toLowerCase()) button.classList.add('active');
        button.innerHTML = `
          <span class="tray-system-tag">${system.tag}</span>
          <span class="tray-system-meta">
            <span>${system.count} component${system.count === 1 ? '' : 's'}</span>
            <span>${system.status}</span>
          </span>
          <span class="tray-system-state-counts">
            ${system.ifcCount} saved · ${system.pendingCount} pending · ${system.modifiedCount} modified
          </span>
          <span class="tray-system-models">${system.models.join(', ') || 'Loaded model'}</span>
        `;
        button.textContent = '';

        const tag = document.createElement('span');
        tag.className = 'tray-system-tag';
        tag.textContent = system.tag;

        const meta = document.createElement('span');
        meta.className = 'tray-system-meta';

        const count = document.createElement('span');
        count.textContent = `${system.count} component${system.count === 1 ? '' : 's'}`;
        meta.append(count, createTraySystemBadge(system.status));

        const stateCounts = document.createElement('span');
        stateCounts.className = 'tray-system-state-counts';
        stateCounts.append(
          createTraySystemBadge(`${system.ifcCount} saved`, 'saved'),
          createTraySystemBadge(`${system.pendingCount} pending`, 'pending'),
          createTraySystemBadge(`${system.modifiedCount} modified`, 'modified'),
        );
        if (system.deletedCount) {
          stateCounts.append(createTraySystemBadge(`${system.deletedCount} deleted`, 'deleted'));
        }

        const models = document.createElement('span');
        models.className = 'tray-system-models';
        models.textContent = system.models.join(', ') || 'Loaded model';

        button.append(tag, meta, stateCounts, models);

        button.addEventListener('click', () => {
          selectedTraySystemTag = system.tag;
          systemTagInput.value = system.tag;
          updateTagAssignmentUi(`Selected tray system "${system.tag}".`);
        });
        traySystemList.appendChild(button);
      }
    }

    const selectedSystem = systems.find((system) => system.tag.toLowerCase() === selectedTraySystemTag.toLowerCase()) || null;
    renderTraySystemComponents(selectedSystem);
    renderTraySystemContinuityReport();
    renderPendingTrayDeletions();

    const hasSelectedSystem = Boolean(selectedSystem);
    const selectedElementCount = countModelIdMapItems(getSelectedModelIdMap());
    if (btnManagerHighlight) btnManagerHighlight.disabled = !hasSelectedSystem;
    if (btnManagerIsolate) btnManagerIsolate.disabled = !hasSelectedSystem;
    if (btnManagerAddSelection) btnManagerAddSelection.disabled = !hasSelectedSystem || selectedElementCount === 0;
    if (btnManagerRemoveSelection) btnManagerRemoveSelection.disabled = !hasSelectedSystem || selectedElementCount === 0;
    if (btnManagerCheckContinuity) btnManagerCheckContinuity.disabled = !hasSelectedSystem;
    if (btnManagerRegenerateSequence) btnManagerRegenerateSequence.disabled = !hasSelectedSystem;
    if (btnManagerRename) {
      btnManagerRename.disabled = !hasSelectedSystem ||
        !getEnteredSystemTag() ||
        getEnteredSystemTag().toLowerCase() === selectedTraySystemTag.toLowerCase();
    }
  }

  function normalizeColumnName(name) {
    return String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function isComponentIdColumn(name = selectedExcelIdColumn) {
    return ['elementtag', 'componentid', 'componenttag', 'pieceid'].includes(normalizeColumnName(name));
  }

  function isSystemTagColumn(name = selectedExcelIdColumn) {
    return ['systemtag', 'tag', 'traytag'].includes(normalizeColumnName(name));
  }

  function findComponentById(componentId) {
    const normalizedId = String(componentId || '').trim().toLowerCase();
    if (!normalizedId) return null;
    return getEffectiveTaggedElements().find(
      (element) => element.componentId?.trim().toLowerCase() === normalizedId,
    ) || null;
  }

  function getEffectiveTaggedElements() {
    const elements = new Map();
    for (const modelEntry of loadedModels) {
      const modelId = modelEntry.model.modelId || modelEntry.model.uuid;
      for (const [localId, projectTag] of modelEntry.existingProjectTags || []) {
        const key = getAssignmentKey(modelId, localId);
        elements.set(key, {
          modelId,
          modelName: modelEntry.name,
          localId: Number(localId),
          systemTag: projectTag.systemTag,
          elementTag: projectTag.elementTag || projectTag.componentId,
          componentId: projectTag.componentId,
          elementKind: projectTag.elementKind || '',
          typeCode: projectTag.typeCode || '',
          sequenceNumber: projectTag.sequenceNumber,
          schemeVersion: projectTag.schemeVersion || '',
          source: 'ifc',
        });
      }
    }
    for (const [key, assignment] of tagAssignments) {
      if (loadedModels.some((entry) =>
        entry.model.modelId === assignment.modelId || entry.model.uuid === assignment.modelId
      )) {
        if (assignment.delete === true) {
          elements.delete(key);
          continue;
        }
        elements.set(key, { ...assignment, source: 'pending' });
      }
    }
    return Array.from(elements.values());
  }

  function getExcelTagsForValidation() {
    if (!selectedExcelIdColumn || !isSystemTagColumn()) return [];
    return excelData.map((row, index) => ({
      rowNumber: index + 2,
      tag: String(row[selectedExcelIdColumn] ?? '').trim(),
    }));
  }

  function runTagValidation() {
    const result = validateTagIntegrity({
      elements: getEffectiveTaggedElements(),
      excelTags: getExcelTagsForValidation(),
    });

    tagValidationReport.hidden = false;
    const tone = !result.valid ? 'error' : result.warnings.length ? 'warning' : 'success';
    tagValidationReport.dataset.tone = tone;
    tagValidationBadge.textContent = !result.valid ? 'Blocked' : result.warnings.length ? 'Warnings' : 'Ready';
    tagValidationCounts.textContent = `${result.counts.ifcTags} tray systems · ${result.counts.excelTags} Excel rows · ${result.counts.matchedTags} matched`;
    tagValidationIssues.innerHTML = '';

    const issues = [
      ...result.errors.map((issue) => ({ ...issue, level: 'error' })),
      ...result.warnings.map((issue) => ({ ...issue, level: 'warning' })),
    ];
    if (!issues.length) issues.push({ level: 'success', message: 'No tag integrity problems found.' });
    for (const issue of issues) {
      const item = document.createElement('li');
      item.className = `validation-${issue.level}`;
      item.textContent = issue.message;
      tagValidationIssues.appendChild(item);
    }
    return result;
  }

  function refreshValidationReportIfOpen() {
    if (!tagValidationReport.hidden) runTagValidation();
  }

  function refreshSystemTagSuggestions() {
    const tags = Array.from(new Set(
      getEffectiveTaggedElements().map((element) => element.systemTag).filter(Boolean),
    )).sort((a, b) => a.localeCompare(b));
    systemTagSuggestions.innerHTML = '';
    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag;
      systemTagSuggestions.appendChild(option);
    }
  }

  function updateExcelNavigationUi() {
    const hasExcelRows = excelData.length > 0;
    excelOnlyFields.forEach((field) => {
      field.hidden = !hasExcelRows;
      field.style.display = hasExcelRows ? '' : 'none';
    });
  }

  function updateTagAssignmentUi(message = '', tone = '') {
    refreshSystemTagSuggestions();
    updateExcelNavigationUi();
    const selectedTag = getEnteredSystemTag();
    const assignment = getAssignmentForElement();
    const viewerSelectionCount = countModelIdMapItems(getSelectedModelIdMap());
    const selectedElementCount = traySelection.size || viewerSelectionCount;
    const elementLabel = selectedIfcElement
      ? `${selectedIfcElement.name || selectedIfcElement.type || 'IFC element'} (#${selectedIfcElement.localId})`
      : 'no IFC element selected';
    const rowLabel = selectedTag ? `system “${selectedTag}”` : 'no system tag entered';

    tagAssignmentStatus.textContent = message || `${rowLabel}; ${elementLabel}.`;
    if (tone) tagAssignmentStatus.dataset.tone = tone;
    else delete tagAssignmentStatus.dataset.tone;
    tagAssignmentSummary.textContent = `${tagAssignments.size} pending change${tagAssignments.size === 1 ? '' : 's'}`;
    traySelectionSummary.textContent = selectedElementCount
      ? `${selectedElementCount} element${selectedElementCount === 1 ? '' : 's'} selected · click empty space to clear`
      : '0 elements selected';
    btnAssignTag.textContent = selectedTag && selectedElementCount
      ? `Assign ${selectedTag} to ${selectedElementCount} element${selectedElementCount === 1 ? '' : 's'}`
      : 'Assign System Tag';
    btnAddTraySelection.disabled = !selectedIfcElement;
    btnAssignTag.disabled = !selectedTag || selectedElementCount === 0;
    btnHighlightSystem.disabled = !selectedTag || findSystemMembers(selectedTag).length === 0;
    btnUnassignTag.disabled = !assignment;
    btnValidateTags.disabled = loadedModels.length === 0 || getEffectiveTaggedElements().length === 0;
    btnExportTags.disabled = getEffectiveTaggedElements().length === 0;
    btnExportTaggedIfc.disabled = tagAssignments.size === 0;
    reconcileSelectionOrder();
    renderTraySystemManager();

    if (selectedIfcElement) {
      const existingAssignment = getExistingTrayAssignment(selectedIfcElement);
      const displayedTag = assignment?.delete === true
        ? '-'
        : assignment?.elementTag || assignment?.componentId ||
          existingAssignment?.elementTag || existingAssignment?.componentId ||
          selectedIfcElement.ifcTag || assignment?.systemTag || existingAssignment?.systemTag || '-';
      propTag.textContent = displayedTag;
      propTag.title = displayedTag;
    }
  }

  async function readElementIdentity(model, localId, modelName) {
    const data = (await model.getItemsData([Number(localId)], {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
    }))?.[0] || {};
    const read = (attribute) => attribute && typeof attribute === 'object' && 'value' in attribute
      ? attribute.value
      : attribute;
    return {
      modelId: model.modelId || model.uuid,
      modelName,
      localId: Number(localId),
      globalId: read(data.GlobalId ?? data._guid) || '',
      name: read(data.Name) || '',
      type: getModernIfcTypeName(data),
      ifcTag: read(data.Tag) || '',
    };
  }

  // Bidirectional highlighting: 3D Selection -> Excel Selection & Loaded Models Sync
  highlighter.events.select.onHighlight.add(async (fragmentMap) => {
    if (highlighter.isProgrammaticSelect) return;

    currentSelectionMap = cloneModelIdMap(fragmentMap);
    if (batchPreviewAssignments.length) clearBatchPreview('Selection changed. Preview the current selection again.');
    reconcileSelectionOrder(currentSelectionMap);
    let selectedModelId = null;
    let selectedExpressId = null;
    const viewportSelection = [];
    if (fragmentMap && Object.keys(fragmentMap).length > 0) {
      for (const modelId in fragmentMap) {
        const ids = fragmentMap[modelId];
        if (ids && ids.size > 0) {
          for (const id of ids) viewportSelection.push({ modelId, localId: Number(id) });
        } else if (Array.isArray(ids) && ids.length > 0) {
          for (const id of ids) viewportSelection.push({ modelId, localId: Number(id) });
        }
      }
      selectedModelId = viewportSelection[0]?.modelId ?? null;
      selectedExpressId = viewportSelection[0]?.localId ?? null;
    }

    if (viewportSelection.length > 1) {
      traySelection.clear();
      for (const selected of viewportSelection) {
        const modelEntry = loadedModels.find((entry) =>
          entry.model?.modelId === selected.modelId ||
          entry.model?.uuid === selected.modelId ||
          entry.uuid === selected.modelId
        );
        if (!modelEntry) continue;
        const identity = await readElementIdentity(modelEntry.model, selected.localId, modelEntry.name);
        traySelection.set(getAssignmentKey(identity.modelId, identity.localId), identity);
      }
    }
    
    if (selectedExpressId !== null) {
      const expressIdNum = Number(selectedExpressId);
      
      // Sync viewport selection back to active model state and Loaded Models sidebar list
      const foundModelEntry = loadedModels.find((entry) =>
        entry.model?.modelId === selectedModelId ||
        entry.model?.uuid === selectedModelId ||
        entry.uuid === selectedModelId
      );
      
      if (foundModelEntry) {
        activeModel = foundModelEntry.model;
        await displayElementProperties(foundModelEntry.model, expressIdNum, foundModelEntry.name);
        selectedIfcElement = await readElementIdentity(foundModelEntry.model, expressIdNum, foundModelEntry.name);
        routingController.setSelectedElement(foundModelEntry.model, expressIdNum);
        await setOrbitTargetToElement(foundModelEntry.model, expressIdNum);
        updateTagAssignmentUi();
        refreshLoadedModelsList();
        
      }
    }
  });

  highlighter.events.select.onClear.add(() => {
    if (highlighter.isProgrammaticSelect) return;

    activeModel = null;
    selectedIfcElement = null;
    currentSelectionMap = {};
    selectionOrderKeys = [];
    reconcileSelectionOrder({});
    clearBatchPreview('Select one or more IFC elements to begin.');
    traySelection.clear();
    routingController.setSelectedElement(null, null);
    updateTagAssignmentUi();
    autoRotateActive = false;
    if (orbitIndicator) {
      orbitIndicator.style.display = 'none';
    }

    // Reset element properties panel
    clearElementProperties();
    
    refreshLoadedModelsList();
  });

  // Helper: Fit camera to all visible models or a single model
  function fitModelsToView(modelsToFit = null) {
    const targets = modelsToFit || loadedModels.filter(m => m.visible).map(m => m.model);
    if (targets.length === 0) {
      world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
      return;
    }

    const combinedBox = new THREE.Box3();
    let hasBox = false;
    for (const model of targets) {
      // FragmentsModel.box contains the complete IFC bounds even when its
      // distant tiles have not yet been rendered by the current camera view.
      const storedBox = model?.box;
      const box = storedBox && !storedBox.isEmpty()
        // FragmentsModel.box is already returned in world coordinates.
        ? storedBox
        : new THREE.Box3().setFromObject(model?.object || model);
      if (!box || box.isEmpty()) continue;
      if (!hasBox) combinedBox.copy(box);
      else combinedBox.union(box);
      hasBox = true;
    }

    if (!hasBox) {
      console.warn('[Camera Focus] No valid model bounds were available.');
      return;
    }

    const sphere = new THREE.Sphere();
    combinedBox.getBoundingSphere(sphere);
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) sphere.radius = 1;
    world.camera.controls.fitToSphere(sphere, true);
  }

  // Helper: Fit camera to a single model
  function fitModelToView(model) {
    fitModelsToView([model]);
  }

  // Helper: Unload a single model
  function unloadModel(modelEntry) {
    const model = modelEntry.model;
    const modelObject = model.object || model;
    
    // Stop auto-rotate if the model being deleted was the active model
    if (activeModel === model) {
      autoRotateActive = false;
      if (orbitIndicator) {
        orbitIndicator.style.display = 'none';
      }
    }

    world.scene.three.remove(modelObject);
    try {
      if (fragments.disposeGroup) {
        fragments.disposeGroup(model);
      } else if (fragments.dispose) {
        if (model.uuid) {
          fragments.dispose(model.uuid);
        } else {
          fragments.dispose();
        }
      }
    } catch (e) {
      console.warn("Error disposing model in FragmentsManager:", e);
    }

    // Remove from loadedModels
    invalidateBatchUndo();
    for (const [key, assignment] of tagAssignments) {
      if (assignment.modelId === model.modelId || assignment.modelId === model.uuid) tagAssignments.delete(key);
    }
    loadedModels = loadedModels.filter(m => m.uuid !== modelEntry.uuid);
    renderExcelTable();
    refreshValidationReportIfOpen();

    // If the unloaded model was the active model, update activeModel reference
    if (activeModel === model) {
      if (loadedModels.length > 0) {
        const nextActive = loadedModels[loadedModels.length - 1];
        activeModel = nextActive.model;
      } else {
        activeModel = null;
      }
      // Reset element properties panel
      clearElementProperties();
    }

    // Clear highlights on unload to prevent stale highlight references
    try {
      highlighter.clear('select');
    } catch (err) {
      console.warn(err);
    }

    refreshLoadedModelsList();
  }

  // Helper: Clear active model (for backwards compatibility/reset)
  function clearActiveModel() {
    if (activeModel) {
      const entry = loadedModels.find(m => m.model === activeModel);
      if (entry) {
        unloadModel(entry);
      } else {
        const modelObject = activeModel.object || activeModel;
        world.scene.three.remove(modelObject);
        activeModel = null;
      }
    }
  }

  // ──────────────────────────────────────────────
  //  IFC ELEMENT PROPERTIES INSPECTOR
  // ──────────────────────────────────────────────

  // Common IFC type codes → human-readable names
  const IFC_TYPE_MAP = {
    3588315303: 'IfcWall', 103090709: 'IfcWallStandardCase',
    1281925730: 'IfcSlab', 4278956645: 'IfcWindow', 395920057: 'IfcDoor',
    4243806635: 'IfcColumn', 3027567501: 'IfcBeam', 2391406531: 'IfcStair',
    331165859: 'IfcStairFlight', 900683007: 'IfcFooting', 1687234759: 'IfcPile',
    2262370178: 'IfcRailing', 3171933400: 'IfcPlate', 1783015770: 'IfcMember',
    263784265: 'IfcFurnishingElement', 1529196076: 'IfcBuildingElementProxy',
    3573737166: 'IfcRoof', 3758799889: 'IfcCovering', 1051757585: 'IfcCurtainWall',
    1335981549: 'IfcDiscreteAccessory', 4105962743: 'IfcMechanicalFastener',
    3415622556: 'IfcFastener', 843113511: 'IfcColumn',
    4031249490: 'IfcBuilding', 3124254112: 'IfcBuildingStorey',
    3856911033: 'IfcSpace', 1674181508: 'IfcProject', 2706606064: 'IfcSite',
    3508470533: 'IfcFlowTerminal', 3132237377: 'IfcFlowMovingDevice',
    987401354: 'IfcFlowSegment', 707683696: 'IfcFlowFitting',
    2058353004: 'IfcFlowController', 3304561284: 'IfcWindow',
    3512223829: 'IfcWallStandardCase', 1973544240: 'IfcCovering',
    2979338954: 'IfcBuildingElementPart', 1095909175: 'IfcBuildingElementProxy',
    2938176219: 'IfcBurner', 32344328: 'IfcBoiler',
    3649129432: 'IfcDistributionElement', 1945004755: 'IfcDistributionPort',
    3040386961: 'IfcDistributionFlowElement', 3313531582: 'IfcSensorType',
    2188021234: 'IfcFlowMeter', 4136498852: 'IfcCooledBeam',
    4017108033: 'IfcPipeFitting', 3640358203: 'IfcPipeSegment',
    4207607924: 'IfcValve', 2056796094: 'IfcAirTerminal',
    177149247: 'IfcAirTerminalBox', 1060000209: 'IfcLamp',
    1890029508: 'IfcElectricDistributionBoard', 857184966: 'IfcElectricAppliance',
    484807127: 'IfcUnitaryEquipment', 4292641817: 'IfcUnitaryControlElement',
    3415753249: 'IfcSwitchingDevice', 1620046519: 'IfcOutlet',
    3518393246: 'IfcDuctSegment', 342316401: 'IfcDuctFitting',
    3760055223: 'IfcDuctSilencer', 2272882330: 'IfcDamper',
    3902619387: 'IfcChiller', 2474470126: 'IfcMotorConnection',
    2295281155: 'IfcProtectiveDeviceTrippingUnit', 738039164: 'IfcProtectiveDevice',
    1904799276: 'IfcElectricMotor', 3694346114: 'IfcCableSegment',
    1051575348: 'IfcCableCarrierSegment', 635142910: 'IfcCableCarrierFitting',
    1285652485: 'IfcCableFitting', 3296154744: 'IfcChimney',
    2143335405: 'IfcPump', 3132237377: 'IfcFan',
  };

  // IFC property set / quantity type codes
  const IFCPROPERTYSET = 1451395588;
  const IFCELEMENTQUANTITY = 1883228015;
  const IFCRELDEFINESBYPROPERTIES = 4186316022;

  // Format a property value for display
  function formatPropValue(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(3);
    }
    if (value === '.T.') return 'Yes';
    if (value === '.F.') return 'No';
    if (value === '.U.') return 'Unknown';
    return String(value);
  }

  // Render a single property set group (collapsible <details>)
  function renderPsetGroup(name, entries, isQuantity = false) {
    const entryKeys = Object.keys(entries);
    if (entryKeys.length === 0) return;

    const normalizedName = name.trim().toUpperCase();
    if (normalizedName === 'CCP_TRAY_SYSTEM') {
      propPsetsContainer.querySelector(`[data-pset-name="${normalizedName}"]`)?.remove();
    }

    const details = document.createElement('details');
    details.className = `pset-group${isQuantity ? ' quantity-group' : ''}`;
    details.dataset.psetName = normalizedName;

    const summary = document.createElement('summary');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    const countSpan = document.createElement('span');
    countSpan.className = 'pset-count';
    countSpan.textContent = `${entryKeys.length}`;
    summary.appendChild(nameSpan);
    summary.appendChild(countSpan);

    const propsDiv = document.createElement('div');
    propsDiv.className = 'pset-properties';

    for (const [key, value] of Object.entries(entries)) {
      const row = document.createElement('div');
      row.className = 'prop-row';
      const label = document.createElement('span');
      label.className = 'prop-label';
      label.textContent = key;
      const val = document.createElement('span');
      val.className = 'prop-value';
      const displayVal = formatPropValue(value);
      val.textContent = displayVal;
      val.title = displayVal;
      row.appendChild(label);
      row.appendChild(val);
      propsDiv.appendChild(row);
    }

    details.appendChild(summary);
    details.appendChild(propsDiv);
    if (normalizedName === 'CCP_TRAY_SYSTEM') {
      propPsetsContainer.insertBefore(details, propPsetsContainer.firstChild);
    } else {
      propPsetsContainer.appendChild(details);
    }
  }

  function syncProjectTagPropertyGroup(model, localId) {
    if (!model || !localId) return;
    const element = { modelId: model.modelId || model.uuid, localId: Number(localId) };
    const assignment = getAssignmentForElement(element);
    const existing = loadedModels.find((entry) =>
      entry.model.modelId === element.modelId || entry.model.uuid === element.modelId
    )?.existingProjectTags?.get(element.localId);
    if (assignment?.delete === true) {
      propPsetsContainer.querySelector('[data-pset-name="CCP_TRAY_SYSTEM"]')?.remove();
      if (selectedIfcElement?.modelId === element.modelId && Number(selectedIfcElement.localId) === element.localId) {
        propTag.textContent = '-';
        propTag.title = '-';
      }
      return;
    }
    const systemTag = assignment?.systemTag || existing?.systemTag || '';
    const componentId = assignment?.componentId || existing?.componentId || '';
    const sequenceNumber = assignment?.sequenceNumber || existing?.sequenceNumber || '';
    const elementTag = assignment?.elementTag || existing?.elementTag || componentId;
    const elementKind = assignment?.elementKind || existing?.elementKind || '';
    const typeCode = assignment?.typeCode || existing?.typeCode || '';

    if (!systemTag) {
      propPsetsContainer.querySelector('[data-pset-name="CCP_TRAY_SYSTEM"]')?.remove();
      return;
    }
    renderPsetGroup('CCP_TRAY_SYSTEM', {
      SystemTag: systemTag,
      ElementTag: elementTag,
      ComponentId: componentId,
      ElementKind: elementKind,
      TypeCode: typeCode,
      SequenceNumber: sequenceNumber,
    });
  }

  // Extract property set entries from an IfcPropertySet or IfcElementQuantity
  async function extractPsetEntries(model, psetProps) {
    const entries = {};

    // IfcPropertySet → HasProperties
    if (psetProps.HasProperties) {
      for (const propRef of psetProps.HasProperties) {
        const propId = propRef.value ?? propRef;
        try {
          const sp = await model.getProperties(propId);
          if (sp && sp.Name) {
            const name = sp.Name.value ?? sp.Name;
            let value = '-';
            if (sp.NominalValue !== undefined && sp.NominalValue !== null) {
              value = sp.NominalValue.value ?? sp.NominalValue;
            }
            entries[name] = value;
          }
        } catch (_) { /* skip */ }
      }
    }

    // IfcElementQuantity → Quantities
    if (psetProps.Quantities) {
      for (const qRef of psetProps.Quantities) {
        const qId = qRef.value ?? qRef;
        try {
          const qp = await model.getProperties(qId);
          if (qp && qp.Name) {
            const name = qp.Name.value ?? qp.Name;
            let value = qp.LengthValue?.value ??
                        qp.AreaValue?.value ??
                        qp.VolumeValue?.value ??
                        qp.CountValue?.value ??
                        qp.WeightValue?.value ??
                        qp.TimeValue?.value ?? '-';
            if (typeof value === 'number') value = Math.round(value * 1000) / 1000;
            entries[name] = value;
          }
        } catch (_) { /* skip */ }
      }
    }

    return entries;
  }

  // Strategy 1: Use IfcRelationsIndexer (fast, indexed lookup)
  async function displayPsetsViaIndexer(model, expressId) {
    if (!indexer) return false;
    try {
      const rels = indexer.getEntityRelations(model, expressId, "IsDefinedBy");
      if (!rels || rels.length === 0) return false;

      for (const relExpressId of rels) {
        const psetProps = await model.getProperties(relExpressId);
        if (!psetProps) continue;
        const psetName = psetProps.Name?.value || `PropertySet (${relExpressId})`;
        const isQuantity = psetProps.type === IFCELEMENTQUANTITY;
        const entries = await extractPsetEntries(model, psetProps);
        renderPsetGroup(psetName, entries, isQuantity);
      }
      return true;
    } catch (e) {
      console.warn('[Props] Indexer lookup failed:', e);
      return false;
    }
  }

  // Strategy 2: Manual traversal of IfcRelDefinesByProperties (fallback)
  async function displayPsetsManual(model, expressId) {
    try {
      const allRels = await model.getAllPropertiesOfType(IFCRELDEFINESBYPROPERTIES);
      if (!allRels) return;

      for (const relId in allRels) {
        const rel = allRels[relId];
        if (!rel || !rel.RelatedObjects) continue;

        const relatedIds = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [rel.RelatedObjects];
        const isRelated = relatedIds.some(obj => Number(obj.value ?? obj) === Number(expressId));
        if (!isRelated) continue;

        const psetRef = rel.RelatingPropertyDefinition;
        if (!psetRef) continue;

        const psetId = psetRef.value ?? psetRef;
        const psetProps = await model.getProperties(psetId);
        if (!psetProps) continue;

        const psetName = psetProps.Name?.value || `PropertySet (${psetId})`;
        const isQuantity = psetProps.type === IFCELEMENTQUANTITY;
        const entries = await extractPsetEntries(model, psetProps);
        renderPsetGroup(psetName, entries, isQuantity);
      }
    } catch (e) {
      console.warn('[Props] Manual pset retrieval failed:', e);
    }
  }

  function unwrapItemValue(attribute) {
    if (attribute && typeof attribute === 'object' && !Array.isArray(attribute) && 'value' in attribute) {
      return attribute.value;
    }
    return attribute;
  }

  function collectDimensionCandidates(value, candidates, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => collectDimensionCandidates(item, candidates, visited));
      return;
    }

    const propertyName = unwrapItemValue(value.Name);
    const propertyValue = unwrapItemValue(
      value.NominalValue ?? value.LengthValue ?? value.Description,
    );
    if (propertyName && propertyValue !== undefined && propertyValue !== null) {
      candidates.set(String(propertyName).replace(/[^a-z0-9]/gi, '').toLowerCase(), propertyValue);
    }

    for (const [key, rawValue] of Object.entries(value)) {
      const unwrapped = unwrapItemValue(rawValue);
      if (unwrapped !== undefined && unwrapped !== null && typeof unwrapped !== 'object') {
        candidates.set(key.replace(/[^a-z0-9]/gi, '').toLowerCase(), unwrapped);
      } else {
        collectDimensionCandidates(rawValue, candidates, visited);
      }
    }
  }

  async function readElementDimensions(assignment) {
    const modelEntry = loadedModels.find((entry) =>
      entry.model.modelId === assignment.modelId || entry.model.uuid === assignment.modelId
    );
    if (!modelEntry || typeof modelEntry.model.getItemsData !== 'function') {
      return { Width: '', Height: '', Length: '' };
    }
    let data;
    try {
      data = (await modelEntry.model.getItemsData([Number(assignment.localId)], {
        attributesDefault: true,
        relations: {
          IsDefinedBy: { attributes: true, relations: true },
          DefinesOccurrence: { attributes: true, relations: true },
        },
        relationsDefault: { attributes: false, relations: false },
      }))?.[0];
    } catch (error) {
      console.warn(`[Mapping Export] Could not read dimensions for element #${assignment.localId}:`, error);
      return { Width: '', Height: '', Length: '' };
    }
    const candidates = new Map();
    collectDimensionCandidates(data, candidates);
    const pick = (...names) => {
      for (const name of names) {
        const value = candidates.get(name);
        if (value !== undefined && value !== null && value !== '') return formatPropValue(value);
      }
      return '';
    };
    return {
      Width: pick('width', 'overallwidth', 'traywidth', 'nominalwidth'),
      Height: pick('height', 'overallheight', 'trayheight', 'nominalheight'),
      Length: pick('length', 'overalllength', 'traylength', 'segmentlength'),
    };
  }

  function getModernIfcTypeName(itemData) {
    const category = unwrapItemValue(itemData?._category ?? itemData?.Category ?? itemData?.type);
    if (typeof category === 'number') return IFC_TYPE_MAP[category] || `IFC Type ${category}`;
    if (typeof category === 'string') {
      const normalized = category.replace(/^IFC/i, 'Ifc').toLowerCase();
      const knownType = Object.values(IFC_TYPE_MAP).find((name) => name.toLowerCase() === normalized);
      if (knownType) return knownType;
      return category.replace(/^IFC/i, 'Ifc');
    }
    return 'IfcElement';
  }

  function collectModernPropertySets(value, groups, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => collectModernPropertySets(item, groups, visited));
      return;
    }

    const properties = Array.isArray(value.HasProperties) ? value.HasProperties : null;
    const quantities = Array.isArray(value.Quantities) ? value.Quantities : null;
    const members = properties || quantities;

    if (members) {
      const groupName = formatPropValue(unwrapItemValue(value.Name) || (quantities ? 'Quantities' : 'Property Set'));
      const groupKey = `${quantities ? 'quantity' : 'property'}:${groupName}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { name: groupName, entries: {}, isQuantity: Boolean(quantities) });
      }
      const group = groups.get(groupKey);

      for (const member of members) {
        if (!member || typeof member !== 'object') continue;
        const propertyName = unwrapItemValue(member.Name);
        if (!propertyName) continue;

        const propertyValue = unwrapItemValue(
          member.NominalValue ??
          member.LengthValue ??
          member.AreaValue ??
          member.VolumeValue ??
          member.CountValue ??
          member.WeightValue ??
          member.TimeValue ??
          member.Description
        );
        group.entries[propertyName] = propertyValue ?? '-';
      }
    }

    for (const nested of Object.values(value)) {
      collectModernPropertySets(nested, groups, visited);
    }
  }

  async function displayElementPropertiesModern(model, localId, modelName) {
    const results = await model.getItemsData([localId], {
      attributesDefault: true,
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        DefinesOccurrence: { attributes: true, relations: true },
      },
      relationsDefault: { attributes: false, relations: false },
    });
    const itemData = results?.[0];
    if (!itemData) throw new Error(`No IFC data found for local ID ${localId}.`);

    const name = unwrapItemValue(itemData.Name);
    const globalId = unwrapItemValue(itemData.GlobalId ?? itemData._guid);
    const tag = unwrapItemValue(itemData.Tag);

    propTypeBadge.textContent = getModernIfcTypeName(itemData);
    propName.textContent = formatPropValue(name);
    propName.title = formatPropValue(name);
    propGlobalId.textContent = formatPropValue(globalId);
    propGlobalId.title = formatPropValue(globalId);
    propTag.textContent = formatPropValue(tag);
    propTag.title = formatPropValue(tag);
    propExpressId.textContent = localId;
    propModel.textContent = modelName || '-';
    propModel.title = modelName || '';

    propPsetsContainer.innerHTML = '';

    const attributes = {};
    const relationNames = new Set(['IsDefinedBy', 'DefinesOccurrence']);
    for (const [key, rawValue] of Object.entries(itemData)) {
      if (key.startsWith('_') || relationNames.has(key) || Array.isArray(rawValue)) continue;
      const value = unwrapItemValue(rawValue);
      if (value === undefined || value === null || typeof value === 'object') continue;
      if (['Name', 'GlobalId', 'Tag'].includes(key)) continue;
      attributes[key] = value;
    }
    renderPsetGroup('IFC Attributes', attributes);

    const groups = new Map();
    collectModernPropertySets(itemData, groups);
    groups.forEach(({ name: groupName, entries, isQuantity }) => {
      renderPsetGroup(groupName, entries, isQuantity);
    });
    syncProjectTagPropertyGroup(model, localId);
  }

  // Main display function: show full element properties panel
  async function displayElementProperties(model, expressId, modelName) {
    // Activate panel, show loading
    elementPropsPanel.classList.remove('empty');
    elementPropsPanel.classList.add('active');
    elementPropsPanel.querySelector('.element-props-placeholder').style.display = 'none';
    elementPropsPanel.querySelector('.element-props-content').style.display = 'flex';
    propPsetsContainer.innerHTML = '<div class="props-loading"><div class="props-loading-spinner"></div>Loading properties…</div>';

    try {
      if (typeof model.getItemsData === 'function') {
        await displayElementPropertiesModern(model, expressId, modelName);
        if (propPsetsContainer.children.length === 0) {
          propPsetsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px 0; text-align: center;">No additional properties found for this element.</div>';
        }
        return;
      }

      const props = await model.getProperties(expressId);

      // Identity fields
      const typeName = (props && IFC_TYPE_MAP[props.type]) || (props ? `IFC Type ${props.type}` : 'Unknown');
      propTypeBadge.textContent = typeName;
      propName.textContent = props?.Name?.value ?? '-';
      propName.title = props?.Name?.value ?? '';
      propGlobalId.textContent = props?.GlobalId?.value ?? '-';
      propGlobalId.title = props?.GlobalId?.value ?? '';
      propTag.textContent = props?.Tag?.value ?? '-';
      propTag.title = props?.Tag?.value ?? '';
      propExpressId.textContent = expressId;
      propModel.textContent = modelName || '-';
      propModel.title = modelName || '';

      // Property sets — try indexed first, fall back to manual
      propPsetsContainer.innerHTML = '';
      const foundViaIndexer = await displayPsetsViaIndexer(model, expressId);
      if (!foundViaIndexer) {
        await displayPsetsManual(model, expressId);
      }
      syncProjectTagPropertyGroup(model, expressId);

      // If no psets found at all, show a note
      if (propPsetsContainer.children.length === 0) {
        propPsetsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px 0; text-align: center;">No property sets found for this element.</div>';
      }
    } catch (err) {
      console.warn('[Element Properties] Failed:', err);
      propPsetsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px 0; text-align: center;">Could not load properties.</div>';
    }
  }

  // Clear the element properties panel back to placeholder state
  function clearElementProperties() {
    elementPropsPanel.classList.add('empty');
    elementPropsPanel.classList.remove('active');
    elementPropsPanel.querySelector('.element-props-placeholder').style.display = 'flex';
    elementPropsPanel.querySelector('.element-props-content').style.display = 'none';
    propPsetsContainer.innerHTML = '';
  }

  // Helper: Refresh the loaded models UI sidebar list
  function refreshLoadedModelsList() {
    if (!loadedModelsList) return;
    loadedModelsList.innerHTML = '';

    if (loadedModels.length === 0) {
      if (modelsPlaceholder) modelsPlaceholder.style.display = 'block';
      loadedModelsList.style.display = 'none';
      return;
    }

    if (modelsPlaceholder) modelsPlaceholder.style.display = 'none';
    loadedModelsList.style.display = 'flex';

    loadedModels.forEach((modelEntry) => {
      const li = document.createElement('li');
      li.className = 'model-item';
      if (activeModel === modelEntry.model) {
        li.classList.add('active');
      }

      // Model info container
      const infoDiv = document.createElement('div');
      infoDiv.className = 'model-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'model-name';
      nameSpan.textContent = modelEntry.name;
      nameSpan.title = modelEntry.name;

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'model-size';
      sizeSpan.textContent = modelEntry.size;

      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(sizeSpan);

      // Model actions container
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'model-actions';

      // Visibility button
      const visBtn = document.createElement('button');
      visBtn.className = 'model-btn visible-toggle';
      if (!modelEntry.visible) {
        visBtn.classList.add('hidden-model');
      }
      visBtn.title = modelEntry.visible ? 'Hide model' : 'Show model';
      visBtn.textContent = '👁️';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelEntry.visible = !modelEntry.visible;
        const modelObject = modelEntry.model.object || modelEntry.model;
        if (modelObject) {
          modelObject.visible = modelEntry.visible;
        }
        
        // If we hid the active model, clear select highlighter highlight
        if (!modelEntry.visible) {
          try {
            highlighter.clear('select');
          } catch (err) {
            console.warn(err);
          }
        }
        
        refreshLoadedModelsList();
      });

      // Zoom button
      const zoomBtn = document.createElement('button');
      zoomBtn.className = 'model-btn zoom';
      zoomBtn.title = 'Focus on model';
      zoomBtn.setAttribute('aria-label', `Focus on ${modelEntry.name}`);
      zoomBtn.textContent = '🔍';
      zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fitModelToView(modelEntry.model);
      });

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'model-btn delete';
      deleteBtn.title = 'Delete model';
      deleteBtn.textContent = '🗑️';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unloadModel(modelEntry);
      });

      actionsDiv.appendChild(visBtn);
      actionsDiv.appendChild(zoomBtn);
      actionsDiv.appendChild(deleteBtn);

      li.appendChild(infoDiv);
      li.appendChild(actionsDiv);

      // Clicking the item selects/deselects the active model, showing properties, highlighting, and auto-orbiting
      li.addEventListener('click', async () => {
        if (activeModel === modelEntry.model) {
          // Deselect active model (toggle off)
          activeModel = null;
          autoRotateActive = false;
          if (orbitIndicator) {
            orbitIndicator.style.display = 'none';
          }
          try {
            highlighter.clear('select');
          } catch (err) {
            console.warn(err);
          }
          
          // Reset element properties panel
          clearElementProperties();
          
          refreshLoadedModelsList();
          return;
        }

        // Select the clicked model
        activeModel = modelEntry.model;
        clearElementProperties();
        
        // 1. Highlight all elements of this model
        if (modelEntry.model.expressIDToFragmentMap) {
          const allExpressIds = Object.keys(modelEntry.model.expressIDToFragmentMap).map(Number);
          const selectedFragmentMap = modelEntry.model.getFragmentMap(allExpressIds);
          highlighter.isProgrammaticSelect = true;
          try {
            await highlighter.highlightByID("select", selectedFragmentMap, true);
          } catch (err) {
            console.warn("[Highlighter] Failed to select all elements of model:", err);
          } finally {
            highlighter.isProgrammaticSelect = false;
          }
        }
        
        // 2. Zoom to the selected model
        fitModelToView(modelEntry.model);
        
        // 3. Trigger Auto-Orbit
        autoRotateActive = true;
        if (orbitIndicator) {
          orbitIndicator.style.display = 'flex';
        }
        console.log(`[Auto-Orbit] Activated for model: ${modelEntry.name}`);

        refreshLoadedModelsList();
      });

      loadedModelsList.appendChild(li);
    });
  }

  // Loader function
  async function loadModel(buffer, name, sizeFormatted) {
    showLoader("Loading Model", `Parsing '${name}'...`, 30);
    const sourceIfcBytes = buffer.slice();
    
    // Check if the model with the same name is already loaded to avoid collisions
    if (loadedModels.some(m => m.name === name)) {
      let baseName = name;
      let extension = "";
      const dotIndex = name.lastIndexOf('.');
      if (dotIndex !== -1) {
        baseName = name.substring(0, dotIndex);
        extension = name.substring(dotIndex);
      }
      let counter = 1;
      while (loadedModels.some(m => m.name === `${baseName} (${counter})${extension}`)) {
        counter++;
      }
      name = `${baseName} (${counter})${extension}`;
    }

    try {
      let model;
      // Load model using IfcLoader
      try {
        model = await ifcLoader.load(buffer, true, name, {
          instanceCallback: (importer) => {
            importer.addAllAttributes();
            importer.addAllRelations();
          },
          processData: {
            progressCallback: (progress) => {
              const pct = Math.round(progress * 100);
              updateLoader(`Parsing IFC geometries... (${pct}%)`, 30 + pct * 0.6);
            }
          }
        });
      } catch (loadErr) {
        console.warn("Loading with options failed, attempting simple load:", loadErr);
        model = await ifcLoader.load(buffer, true, name);
      }

      if (!model) {
        throw new Error("Parsed model is empty or invalid.");
      }

      activeModel = model;
      const modelObject = model.object || model;

      // Add to scene
      world.scene.three.add(modelObject);

      // Index model relations for property queries
      if (indexer) {
        try {
          await indexer.process(model);
          console.log(`[IfcRelationsIndexer] Indexed relations for '${name}'.`);
        } catch (e) {
          console.warn('[IfcRelationsIndexer] Failed to process model:', e);
        }
      }

      // Create model entry
      const modelEntry = {
        uuid: model.uuid || Math.random().toString(36).substring(7),
        name: name,
        size: sizeFormatted,
        model: model,
        sourceIfcBytes,
        existingProjectTags: extractTraySystemAssignmentsFromIfc(sourceIfcBytes),
        visible: true
      };

      loadedModels.push(modelEntry);
      renderExcelTable();
      renderTraySystemManager();
      refreshValidationReportIfOpen();

      // Fit camera to model
      fitModelToView(model);

      // Apply current wireframe setting
      setWireframeForModel(model, isWireframe);

      // Refresh loaded models UI
      refreshLoadedModelsList();

      // Reset element properties (no element selected yet)
      clearElementProperties();

      hideLoader();
      console.log(`Model '${name}' loaded successfully.`);
    } catch (err) {
      console.error("Error loading IFC model:", err);
      updateLoader(`Error loading model: ${err.message}`, 0);
      setTimeout(hideLoader, 3000);
    }
  }

  // Toggle helpers
  function setWireframeForModel(model, wireframeState) {
    const modelObject = model.object || model;
    if (!modelObject) return;
    modelObject.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => mat.wireframe = wireframeState);
          } else if (child.material) {
            child.material.wireframe = wireframeState;
          }
        }
      }
    });
  }

  function setWireframe(value) {
    isWireframe = value;
    loadedModels.forEach(m => {
      setWireframeForModel(m.model, isWireframe);
    });
  }

  // Listeners: Sidebar controls
  btnLoadSample.addEventListener('click', async () => {
    const url = "https://raw.githubusercontent.com/andrewisen/bim-whale-ifc-samples/main/BasicHouse/IFC/BasicHouse.ifc";
    showLoader("Downloading Sample", "Fetching BasicHouse.ifc from remote repository...", 10);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download sample: HTTP ${response.status}`);
      }
      
      updateLoader("Reading sample data...", 20);
      const data = await response.arrayBuffer();
      const buffer = new Uint8Array(data);

      await loadModel(buffer, "BasicHouse.ifc", formatBytes(data.byteLength));
    } catch (err) {
      console.error(err);
      updateLoader(`Download failed: ${err.message}`, 0);
      setTimeout(hideLoader, 3000);
    }
  });

  btnUpload.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    fileInput.value = ''; // Reset file input

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const progressLabel = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
      
      showLoader(`Uploading File${progressLabel}`, `Reading ${file.name}...`, 10);
      
      await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          updateLoader(`File ${file.name} loaded, parsing...`, 25);
          const data = e.target.result;
          const buffer = new Uint8Array(data);
          try {
            await loadModel(buffer, file.name, formatBytes(file.size));
          } catch (err) {
            console.error(`Failed to load ${file.name}:`, err);
          }
          resolve();
        };
        reader.onerror = () => {
          console.error(`Failed to read file ${file.name}`);
          resolve();
        };
        reader.readAsArrayBuffer(file);
      });
    }
  });

  // Optional deep link for local review and automated validation:
  // ?ifc=/path/to/model.ifc
  const linkedIfcUrl = new URLSearchParams(window.location.search).get('ifc');
  if (linkedIfcUrl) {
    const linkedName = decodeURIComponent(linkedIfcUrl.split('/').pop() || 'LinkedModel.ifc');
    showLoader('Loading Linked IFC', `Fetching ${linkedName}...`, 10);
    try {
      const response = await fetch(linkedIfcUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      await loadModel(new Uint8Array(data), linkedName, formatBytes(data.byteLength));
    } catch (error) {
      console.error('[Linked IFC] Load failed:', error);
      updateLoader(`Linked IFC failed: ${error.message}`, 0);
      setTimeout(hideLoader, 3000);
    }
  }

  btnResetCamera.addEventListener('click', () => {
    fitModelsToView();
  });

  if (btnViewerSettings && viewerSettingsPanel) {
    btnViewerSettings.addEventListener('click', () => {
      const willOpen = viewerSettingsPanel.hidden;
      viewerSettingsPanel.hidden = !willOpen;
      btnViewerSettings.setAttribute('aria-expanded', String(willOpen));
    });
  }

  selectionHighlightColorInput?.addEventListener('input', async () => {
    await applySelectionHighlightSetting(selectionHighlightColorInput.value);
  });

  selectionHighlightHex?.addEventListener('change', async () => {
    const normalized = normalizeHexColor(selectionHighlightHex.value);
    if (!normalized) {
      selectionHighlightHex.value = selectionHighlightColor.toUpperCase();
      return;
    }
    await applySelectionHighlightSetting(normalized);
  });

  toggleGrid.addEventListener('change', () => {
    if ('visible' in grid) {
      grid.visible = toggleGrid.checked;
    } else if (grid.three) {
      grid.three.visible = toggleGrid.checked;
    }
  });

  toggleWireframe.addEventListener('change', () => {
    setWireframe(toggleWireframe.checked);
  });

  toggleDarkMode.addEventListener('change', () => {
    const isDark = toggleDarkMode.checked;
    const color = isDark ? new THREE.Color('#0a0b0e') : new THREE.Color('#f3f4f6');
    world.scene.three.background = color;
  });

  // Toggle Sidebar Collapse
  if (btnSidebarToggle && sidebar) {
    btnSidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      
      const isCollapsed = sidebar.classList.contains('collapsed');
      const toggleSpan = btnSidebarToggle.querySelector('span');
      if (toggleSpan) {
        toggleSpan.innerText = isCollapsed ? '▶' : '◀';
      }
      
      if (world.renderer && world.renderer.resize) {
        world.renderer.resize();
      }
    });

    sidebar.addEventListener('transitionend', () => {
      if (world.renderer && world.renderer.resize) {
        world.renderer.resize();
      }
    });
  }

  // Make an IFC element the pivot for subsequent left-mouse orbiting.
  async function setOrbitTargetToElement(model, expressId) {
    if (!model) return;
    const bboxer = components.get(OBC.BoundingBoxer);
    try {
      bboxer.list.clear();
      const modelId = model.modelId || model.uuid;
      await bboxer.addFromModelIdMap({ [modelId]: new Set([Number(expressId)]) });
      const box = bboxer.get();
      if (box && !box.isEmpty()) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        world.camera.controls.setOrbitPoint(center.x, center.y, center.z);
      }
    } catch (error) {
      console.warn('[Camera Orbit] Could not set the selected element as pivot:', error);
    } finally {
      bboxer.list.clear();
    }
  }

  // Helper: Zoom to a specific Express ID inside a specific model
  async function zoomToElementInModel(model, expressId) {
    if (!model) return;
    try {
      const bboxer = components.get(OBC.BoundingBoxer);
      bboxer.list.clear();
      const modelId = model.modelId || model.uuid;
      await bboxer.addFromModelIdMap({ [modelId]: new Set([Number(expressId)]) });
      const box = bboxer.get();
      if (box && !box.isEmpty()) {
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius < 0.5) sphere.radius = 1.0;
        world.camera.controls.fitToSphere(sphere, true);
      }
      bboxer.list.clear();
    } catch (e) {
      console.warn("zoomToElementInModel failed:", e);
    }
  }

  // Helper: Zoom to a specific Express ID inside activeModel
  async function zoomToElement(expressId) {
    await zoomToElementInModel(activeModel, expressId);
  }

  function closeViewerContextMenu() {
    viewerContextMenu.hidden = true;
  }

  function ensureModelObjectsVisible(modelIdMap) {
    for (const modelId of Object.keys(modelIdMap || {})) {
      const modelEntry = loadedModels.find((entry) =>
        entry.model?.modelId === modelId ||
        entry.model?.uuid === modelId ||
        entry.uuid === modelId
      );
      if (!modelEntry) continue;
      modelEntry.visible = true;
      const modelObject = modelEntry.model.object || modelEntry.model;
      if (modelObject) modelObject.visible = true;
    }
    refreshLoadedModelsList();
  }

  function updateContextMenuActions() {
    const selection = getSelectedModelIdMap();
    const selectionCount = countModelIdMapItems(selection);
    const currentSelectionIsAlreadyIsolated = isolationActive && areModelIdMapsEqual(selection, lastIsolatedSelectionMap);
    contextFocusItem.hidden = !selectedIfcElement;
    contextIsolateItem.hidden = selectionCount === 0 || currentSelectionIsAlreadyIsolated;
    contextColorControl.hidden = selectionCount === 0;
    contextIsolateItem.textContent = selectionCount > 1
      ? `◌ Isolate ${selectionCount} Selected`
      : '◌ Isolate Selected';
    contextSelectionColor.value = selectedAppearanceColor;
    contextColorHex.value = selectedAppearanceColor.toUpperCase();
    contextShowAll.hidden = !isolationActive;
  }

  container.addEventListener('contextmenu', (event) => {
    closeViewerContextMenu();
    updateContextMenuActions();
    if (contextFocusItem.hidden && contextIsolateItem.hidden && contextColorControl.hidden && contextShowAll.hidden) return;

    event.preventDefault();
    viewerContextMenu.hidden = false;
    const menuRect = viewerContextMenu.getBoundingClientRect();
    viewerContextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuRect.width - 8))}px`;
    viewerContextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuRect.height - 8))}px`;
    const firstVisibleAction = [
      contextFocusItem,
      contextIsolateItem,
      contextColorControl.hidden ? null : contextSelectionColor,
      contextShowAll,
    ].filter(Boolean).find((item) => !item.hidden);
    firstVisibleAction?.focus();
  });

  contextSelectionColor.addEventListener('input', async () => {
    selectedAppearanceColor = contextSelectionColor.value.toLowerCase();
    contextColorHex.value = selectedAppearanceColor.toUpperCase();
    await applyAppearanceColorToCurrentSelection();
  });

  contextColorHex.addEventListener('change', async () => {
    const normalized = normalizeHexColor(contextColorHex.value);
    if (!normalized) {
      contextColorHex.value = selectedAppearanceColor.toUpperCase();
      return;
    }
    selectedAppearanceColor = normalized;
    contextSelectionColor.value = selectedAppearanceColor;
    contextColorHex.value = selectedAppearanceColor.toUpperCase();
    await applyAppearanceColorToCurrentSelection();
  });

  contextIsolateItem.addEventListener('click', async () => {
    const selection = getSelectedModelIdMap();
    const selectionCount = countModelIdMapItems(selection);
    closeViewerContextMenu();
    if (!selectionCount) return;
    if (isolationActive && areModelIdMapsEqual(selection, lastIsolatedSelectionMap)) return;

    try {
      ensureModelObjectsVisible(selection);
      await hider.isolate(selection);
      isolationActive = true;
      lastIsolatedSelectionMap = cloneModelIdMap(selection);
      updateTagAssignmentUi(
        `Isolated ${selectionCount} selected element${selectionCount === 1 ? '' : 's'}.`,
        'success',
      );
    } catch (error) {
      console.warn('[Isolate] Failed:', error);
      updateTagAssignmentUi('Warning: selected elements could not be isolated.', 'warning');
    }
  });

  contextShowAll.addEventListener('click', async () => {
    closeViewerContextMenu();
    try {
      await hider.set(true);
      isolationActive = false;
      lastIsolatedSelectionMap = {};
      for (const modelEntry of loadedModels) {
        modelEntry.visible = true;
        const modelObject = modelEntry.model.object || modelEntry.model;
        if (modelObject) modelObject.visible = true;
      }
      refreshLoadedModelsList();
      updateTagAssignmentUi('All IFC elements are visible again.', 'success');
    } catch (error) {
      console.warn('[Isolate] Show all failed:', error);
      updateTagAssignmentUi('Warning: hidden elements could not be restored.', 'warning');
    }
  });

  contextFocusItem.addEventListener('click', async () => {
    const element = selectedIfcElement ? { ...selectedIfcElement } : null;
    closeViewerContextMenu();
    if (!element) return;

    const modelEntry = loadedModels.find((entry) =>
      entry.model?.modelId === element.modelId ||
      entry.model?.uuid === element.modelId ||
      entry.uuid === element.modelId
    );
    if (!modelEntry) return;

    if (!modelEntry.visible) {
      modelEntry.visible = true;
      const modelObject = modelEntry.model.object || modelEntry.model;
      if (modelObject) modelObject.visible = true;
      refreshLoadedModelsList();
    }

    const modelId = modelEntry.model.modelId || modelEntry.model.uuid || element.modelId;
    highlighter.isProgrammaticSelect = true;
    try {
      await highlighter.highlightByID(
        'select',
        { [modelId]: new Set([Number(element.localId)]) },
        true,
        true,
      );
      activeModel = modelEntry.model;
      await displayElementProperties(modelEntry.model, element.localId, modelEntry.name);
      selectedIfcElement = await readElementIdentity(modelEntry.model, element.localId, modelEntry.name);
      routingController.setSelectedElement(modelEntry.model, element.localId);
      await zoomToElementInModel(modelEntry.model, element.localId);
      updateTagAssignmentUi(`Focused on element #${element.localId}.`);
    } catch (error) {
      console.warn('[Focus on Item] Failed:', error);
      updateTagAssignmentUi(`Warning: element #${element.localId} could not be focused.`, 'warning');
    } finally {
      highlighter.isProgrammaticSelect = false;
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!viewerContextMenu.hidden && !viewerContextMenu.contains(event.target)) {
      closeViewerContextMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeViewerContextMenu();
  });
  window.addEventListener('blur', closeViewerContextMenu);
  window.addEventListener('resize', closeViewerContextMenu);

  async function highlightTrayMembers(members, message) {
    if (!members.length) return false;
    const firstMember = members[0];
    const firstModelEntry = loadedModels.find((entry) =>
      entry.model?.modelId === firstMember.modelId || entry.model?.uuid === firstMember.modelId
    );
    if (!firstModelEntry) return false;

    const fragmentMap = {};
    for (const member of members) {
      const modelEntry = loadedModels.find((entry) =>
        entry.model?.modelId === member.modelId || entry.model?.uuid === member.modelId
      );
      if (!modelEntry) continue;
      if (!modelEntry.visible) {
        modelEntry.visible = true;
        const modelObject = modelEntry.model.object || modelEntry.model;
        if (modelObject) modelObject.visible = true;
      }
      if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
      fragmentMap[member.modelId].add(Number(member.localId));
    }
    refreshLoadedModelsList();

    highlighter.isProgrammaticSelect = true;
    try {
      await highlighter.highlightByID('select', fragmentMap, true, true);
      currentSelectionMap = cloneModelIdMap(fragmentMap);
      activeModel = firstModelEntry.model;
      await displayElementProperties(firstModelEntry.model, firstMember.localId, firstModelEntry.name);
      selectedIfcElement = await readElementIdentity(firstModelEntry.model, firstMember.localId, firstModelEntry.name);
      routingController.setSelectedElement(firstModelEntry.model, firstMember.localId);
      updateTagAssignmentUi(message);
      return true;
    } catch (error) {
      console.warn('[Tray Systems] Member highlight failed:', error);
      updateTagAssignmentUi('Warning: the tray-system elements could not be highlighted.', 'warning');
      return false;
    } finally {
      highlighter.isProgrammaticSelect = false;
    }
  }

  async function isolateTrayMembers(members, message) {
    if (!members.length) return false;
    const fragmentMap = {};
    for (const member of members) {
      if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
      fragmentMap[member.modelId].add(Number(member.localId));
    }

    try {
      ensureModelObjectsVisible(fragmentMap);
      await hider.isolate(fragmentMap);
      isolationActive = true;
      currentSelectionMap = cloneModelIdMap(fragmentMap);
      lastIsolatedSelectionMap = cloneModelIdMap(fragmentMap);
      updateTagAssignmentUi(message || `Isolated ${members.length} tray-system component${members.length === 1 ? '' : 's'}.`, 'success');
      return true;
    } catch (error) {
      console.warn('[Tray Systems] Member isolation failed:', error);
      updateTagAssignmentUi('Warning: the tray-system elements could not be isolated.', 'warning');
      return false;
    }
  }

  async function getElementsFromModelIdMap(modelIdMap) {
    const elements = [];
    for (const [modelId, ids] of Object.entries(modelIdMap || {})) {
      const modelEntry = findLoadedModelEntry(modelId);
      if (!modelEntry) continue;
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      for (const localId of values) {
        elements.push(await readElementIdentity(modelEntry.model, Number(localId), modelEntry.name));
      }
    }
    return elements;
  }

  async function getCurrentSelectionElements() {
    const selection = getSelectedModelIdMap();
    if (countModelIdMapItems(selection) > 0) return getElementsFromModelIdMap(selection);
    return selectedIfcElement ? [{ ...selectedIfcElement }] : [];
  }

  async function assignElementsToSystem(systemTag, selectedElements, options = {}) {
    const normalizedSystemTag = String(systemTag || '').trim();
    if (!normalizedSystemTag || !selectedElements.length) return false;

    const conflict = selectedElements.find((element) => {
      const assignment = getAssignmentForElement(element);
      const currentSystem = assignment?.systemTag || getExistingProjectTag(element);
      return currentSystem && currentSystem.toLowerCase() !== normalizedSystemTag.toLowerCase();
    });
    if (conflict && !options.skipConflictPrompt) {
      const currentSystem = getAssignmentForElement(conflict)?.systemTag || getExistingProjectTag(conflict);
      const confirmed = await requestTagReplacement(conflict.localId, currentSystem, normalizedSystemTag);
      if (!confirmed) {
        updateTagAssignmentUi('Tray-system assignment cancelled.', 'warning');
        return false;
      }
    }
    invalidateBatchUndo();

    const usedSequences = getEffectiveTaggedElements()
      .filter((element) => element.systemTag?.toLowerCase() === normalizedSystemTag.toLowerCase())
      .map((element) => Number.parseInt(element.sequenceNumber, 10))
      .filter(Number.isFinite);
    let nextSequence = usedSequences.length ? Math.max(...usedSequences) + 1 : 1;

    for (const element of selectedElements) {
      const key = getAssignmentKey(element.modelId, element.localId);
      const existingAssignment = getAssignmentForElement(element);
      const sourceAssignment = findLoadedModelEntry(element.modelId)?.existingProjectTags?.get(Number(element.localId));
      const keepSequence = (existingAssignment?.systemTag || sourceAssignment?.systemTag)?.toLowerCase() === normalizedSystemTag.toLowerCase();
      const sequenceNumber = keepSequence
        ? existingAssignment?.sequenceNumber || sourceAssignment?.sequenceNumber
        : String(nextSequence++).padStart(3, '0');
      tagAssignments.set(key, {
        ...element,
        systemTag: normalizedSystemTag,
        componentId: `${normalizedSystemTag}-C${sequenceNumber}`,
        sequenceNumber,
        excelRowIndex: selectedExcelRowIndex,
      });
      if (selectedIfcElement?.modelId === element.modelId && Number(selectedIfcElement.localId) === Number(element.localId)) {
        syncProjectTagPropertyGroup(findLoadedModelEntry(element.modelId)?.model || activeModel, element.localId);
      }
    }

    selectedTraySystemTag = normalizedSystemTag;
    systemTagInput.value = normalizedSystemTag;
    traySelection.clear();
    renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi(
      options.message || `Successfully assigned tray system "${normalizedSystemTag}" to ${selectedElements.length} element${selectedElements.length === 1 ? '' : 's'}.`,
      'success',
    );
    return true;
  }

  async function regenerateSelectedSystemSequence() {
    if (!selectedTraySystemTag) return false;
    const members = sortSystemMembers(findSystemMembers(selectedTraySystemTag));
    if (!members.length) {
      updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${selectedTraySystemTag}".`, 'warning');
      return false;
    }
    invalidateBatchUndo();

    let sequenceIndex = 1;
    const sequenceByType = new Map();
    for (const member of members) {
      const modelEntry = findLoadedModelEntry(member.modelId);
      if (!modelEntry) continue;
      const identity = await readElementIdentity(modelEntry.model, member.localId, modelEntry.name);
      const usesPatternV2 = Boolean(member.typeCode);
      const typeSequence = usesPatternV2 ? (sequenceByType.get(member.typeCode) || 1) : sequenceIndex++;
      if (usesPatternV2) sequenceByType.set(member.typeCode, typeSequence + 1);
      const sequenceDigits = usesPatternV2
        ? Math.max(2, String(member.sequenceNumber || '').length)
        : 3;
      const sequenceNumber = String(typeSequence).padStart(sequenceDigits, '0');
      const componentId = usesPatternV2
        ? `${selectedTraySystemTag}.${member.typeCode}.${sequenceNumber}`
        : `${selectedTraySystemTag}-C${sequenceNumber}`;
      tagAssignments.set(getAssignmentKey(member.modelId, member.localId), {
        ...identity,
        systemTag: selectedTraySystemTag,
        elementTag: componentId,
        componentId,
        elementKind: member.elementKind || '',
        typeCode: member.typeCode || '',
        sequenceNumber,
        schemeVersion: member.schemeVersion || (usesPatternV2 ? '2' : ''),
        originalIfcTag: member.originalIfcTag || identity.ifcTag || '',
        classificationMethod: member.classificationMethod || '',
        classificationConfidence: member.classificationConfidence ?? '',
        excelRowIndex: member.excelRowIndex ?? selectedExcelRowIndex,
      });
      if (selectedIfcElement?.modelId === member.modelId && Number(selectedIfcElement.localId) === Number(member.localId)) {
        syncProjectTagPropertyGroup(modelEntry.model, member.localId);
      }
    }

    renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi(
      `Regenerated ${members.length} element tag${members.length === 1 ? '' : 's'} for tray system "${selectedTraySystemTag}".`,
      'success',
    );
    return true;
  }

  function getExcelColumnKey(columnName) {
    return String(columnName || '');
  }

  function getDefaultExcelColumnWidth(columnName) {
    if (columnName === ASSIGNMENT_COLUMN_KEY) return 135;
    if (isComponentIdColumn(columnName)) return 240;
    const labelWidth = String(columnName || '').length * 9 + 48;
    return Math.max(DEFAULT_EXCEL_COLUMN_WIDTH, Math.min(labelWidth, 220));
  }

  function getExcelColumnWidth(columnName) {
    const key = getExcelColumnKey(columnName);
    return excelColumnWidths.get(key) || getDefaultExcelColumnWidth(columnName);
  }

  function setExcelColumnWidth(columnName, width) {
    const key = getExcelColumnKey(columnName);
    excelColumnWidths.set(key, Math.max(MIN_EXCEL_COLUMN_WIDTH, Math.round(width)));
  }

  function applyExcelColumnWidths(columns) {
    if (!excelTableColgroup) return;
    const totalWidth = columns.reduce((sum, columnName) => sum + getExcelColumnWidth(columnName), 0);
    const visibleWidth = excelDataTable.parentElement?.clientWidth || 0;
    excelDataTable.style.minWidth = `${Math.max(totalWidth, visibleWidth)}px`;

    Array.from(excelTableColgroup.children).forEach((colElement, index) => {
      const columnName = columns[index];
      if (!columnName) return;
      colElement.style.width = `${getExcelColumnWidth(columnName)}px`;
    });
  }

  function startExcelColumnResize(event, columnName, columns) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = getExcelColumnWidth(columnName);

    document.body.classList.add('is-resizing-excel-column');

    const resize = (moveEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setExcelColumnWidth(columnName, nextWidth);
      applyExcelColumnWidths(columns);
    };

    const stopResize = () => {
      document.body.classList.remove('is-resizing-excel-column');
      document.removeEventListener('pointermove', resize);
      document.removeEventListener('pointerup', stopResize);
      document.removeEventListener('pointercancel', stopResize);
    };

    document.addEventListener('pointermove', resize);
    document.addEventListener('pointerup', stopResize);
    document.addEventListener('pointercancel', stopResize);
  }

  // Render parsed Excel table rows in UI
  function renderExcelTable() {
    updateExcelNavigationUi();
    if (excelTableColgroup) excelTableColgroup.innerHTML = '';
    excelTableHeader.innerHTML = '';
    excelTableBody.innerHTML = '';
    
    if (excelData.length === 0) {
      excelDataTable.style.display = 'none';
      excelDataTable.style.minWidth = '';
      excelPanel.querySelector('.excel-placeholder').style.display = 'block';
      return;
    }
    
    excelPanel.querySelector('.excel-placeholder').style.display = 'none';
    excelDataTable.style.display = 'table';

    const tableColumns = [...excelColumns, ASSIGNMENT_COLUMN_KEY];
    if (excelTableColgroup) {
      tableColumns.forEach((columnName) => {
        const col = document.createElement('col');
        col.style.width = `${getExcelColumnWidth(columnName)}px`;
        excelTableColgroup.appendChild(col);
      });
      applyExcelColumnWidths(tableColumns);
    }
    
    // Create header row
    excelColumns.forEach(col => {
      const th = document.createElement('th');
      th.dataset.column = col;
      const label = document.createElement('span');
      label.className = 'excel-column-label';
      label.innerText = col;
      const resizeHandle = document.createElement('span');
      resizeHandle.className = 'excel-column-resizer';
      resizeHandle.setAttribute('aria-hidden', 'true');
      resizeHandle.addEventListener('pointerdown', (event) => startExcelColumnResize(event, col, tableColumns));
      th.append(label, resizeHandle);
      excelTableHeader.appendChild(th);
    });
    const assignmentHeader = document.createElement('th');
    assignmentHeader.dataset.column = ASSIGNMENT_COLUMN_KEY;
    const assignmentLabel = document.createElement('span');
    assignmentLabel.className = 'excel-column-label';
    assignmentLabel.innerText = 'Assignment';
    const assignmentResizeHandle = document.createElement('span');
    assignmentResizeHandle.className = 'excel-column-resizer';
    assignmentResizeHandle.setAttribute('aria-hidden', 'true');
    assignmentResizeHandle.addEventListener('pointerdown', (event) => startExcelColumnResize(event, ASSIGNMENT_COLUMN_KEY, tableColumns));
    assignmentHeader.append(assignmentLabel, assignmentResizeHandle);
    excelTableHeader.appendChild(assignmentHeader);
    
    // Create table body rows
    const searchTerm = excelSearch.value.toLowerCase().trim();
    
    excelData.forEach((row, index) => {
      if (searchTerm) {
        const rowMatch = Object.values(row).some(val => 
          String(val).toLowerCase().includes(searchTerm)
        );
        if (!rowMatch) return;
      }
      
      const tr = document.createElement('tr');
      tr.dataset.index = index;
      if (selectedExcelRowIndex === index) tr.classList.add('active');

      const rowTag = selectedExcelIdColumn ? String(row[selectedExcelIdColumn] ?? '').trim() : '';
      const componentMatch = isComponentIdColumn() ? findComponentById(rowTag) : null;
      const rowMembers = componentMatch ? [componentMatch] : isSystemTagColumn() ? findSystemMembers(rowTag) : [];
      const rowAssignment = rowMembers[0] || null;
      if (rowMembers.length) tr.classList.add('assigned');
      
      excelColumns.forEach(col => {
        const td = document.createElement('td');
        td.innerText = row[col] !== undefined ? row[col] : "";
        td.title = td.innerText;
        tr.appendChild(td);
      });

      const statusCell = document.createElement('td');
      statusCell.className = 'assignment-cell';
      statusCell.textContent = rowMembers.length
        ? `Assigned ${rowMembers.length} element${rowMembers.length === 1 ? '' : 's'}`
        : 'Unassigned';
      statusCell.title = rowMembers.length
        ? isComponentIdColumn()
          ? `Component ${rowAssignment.componentId} matches IFC element #${rowAssignment.localId}.`
          : `${rowMembers.length} IFC element${rowMembers.length === 1 ? '' : 's'} belong to this tray system.`
        : 'This Excel identifier has not been matched.';
      tr.appendChild(statusCell);
      
      tr.addEventListener('click', async () => {
        excelTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
        tr.classList.add('active');
        selectedExcelRowIndex = index;
        if (rowAssignment?.systemTag) systemTagInput.value = rowAssignment.systemTag;
        else if (rowTag && isSystemTagColumn()) systemTagInput.value = rowTag;
        updateTagAssignmentUi();

        if (rowMembers.length) {
          const modelEntry = loadedModels.find((entry) =>
            entry.model?.modelId === rowAssignment.modelId || entry.model?.uuid === rowAssignment.modelId
          );
          if (!modelEntry) {
            updateTagAssignmentUi(`Warning: the model for system “${rowTag}” is not loaded.`, 'warning');
            return;
          }

          if (!modelEntry.visible) {
            modelEntry.visible = true;
            const modelObject = modelEntry.model.object || modelEntry.model;
            if (modelObject) modelObject.visible = true;
            refreshLoadedModelsList();
          }

          highlighter.isProgrammaticSelect = true;
          try {
            const fragmentMap = {};
            for (const member of rowMembers) {
              if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
              fragmentMap[member.modelId].add(Number(member.localId));
            }
            await highlighter.highlightByID('select', fragmentMap, true, true);
            currentSelectionMap = cloneModelIdMap(fragmentMap);
            activeModel = modelEntry.model;
            await displayElementProperties(modelEntry.model, rowAssignment.localId, modelEntry.name);
            selectedIfcElement = await readElementIdentity(modelEntry.model, rowAssignment.localId, modelEntry.name);
            routingController.setSelectedElement(modelEntry.model, rowAssignment.localId);
            updateTagAssignmentUi(
              isComponentIdColumn()
                ? `Highlighted component “${rowAssignment.componentId}” (element #${rowAssignment.localId}).`
                : `Highlighted ${rowMembers.length} elements for tray system “${rowTag}”.`,
            );
          } catch (error) {
            console.warn('[Excel Linkage] Assigned element highlight failed:', error);
            updateTagAssignmentUi(`Warning: element #${rowAssignment.localId} could not be highlighted.`, 'warning');
          } finally {
            highlighter.isProgrammaticSelect = false;
          }
        }
      });
      
      excelTableBody.appendChild(tr);
    });
  }

  // Excel Upload Interactions
  btnUploadExcel.addEventListener('click', () => {
    excelFileInput.click();
  });

  excelFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    excelFileName.innerText = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (jsonData.length > 0) {
          excelColumns = Object.keys(jsonData[0]);
          excelData = jsonData;
          selectedExcelRowIndex = null;
          
          excelIdColumn.innerHTML = '<option value="">(Select tag column)</option>';
          let systemTagColumn = "";
          let componentIdColumn = "";
          excelColumns.forEach(col => {
            const option = document.createElement('option');
            option.value = col;
            option.innerText = col;
            excelIdColumn.appendChild(option);
            
            if (isComponentIdColumn(col)) componentIdColumn = col;
            else if (isSystemTagColumn(col)) systemTagColumn = col;
          });
          const preselectedCol = componentIdColumn || systemTagColumn;
          if (preselectedCol) {
            excelIdColumn.value = preselectedCol;
            selectedExcelIdColumn = preselectedCol;
          } else {
            selectedExcelIdColumn = "";
          }

          renderExcelTable();
          refreshValidationReportIfOpen();
          updateTagAssignmentUi('Excel tag list loaded. Select a row and an IFC element.');
          
          // Show the excel panel
          excelPanel.classList.remove('collapsed');
          const toggleSpan = btnExcelPanelClose.querySelector('span');
          if (toggleSpan) {
            toggleSpan.innerText = '▶';
          }
          
          if (world.renderer && world.renderer.resize) {
            world.renderer.resize();
          }
        } else {
          alert("The Excel file is empty.");
        }
      } catch (err) {
        console.error("Error parsing Excel file:", err);
        alert(`Failed to parse Excel file: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  });

  excelIdColumn.addEventListener('change', () => {
    selectedExcelIdColumn = excelIdColumn.value;
    renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi();
  });

  excelSearch.addEventListener('input', () => {
    renderExcelTable();
  });

  taggingTabAssign?.addEventListener('click', () => setTaggingMode('assign'));
  taggingTabManage?.addEventListener('click', () => setTaggingMode('manage'));

  for (const field of [
    batchPrefix,
    batchSystem,
    batchElementKind,
    batchTrayCode,
    batchFittingCode,
    batchStartSequence,
    batchSequenceDigits,
  ]) {
    const onBatchPatternChange = () => {
      updateBatchPatternExample();
      if (batchPreviewAssignments.length) clearBatchPreview('Pattern changed. Preview the selected elements again.');
    };
    field?.addEventListener('input', onBatchPatternChange);
    field?.addEventListener('change', onBatchPatternChange);
  }

  btnPreviewBatchTags?.addEventListener('click', async () => {
    const elements = await getOrderedCurrentSelectionElements();
    if (!elements.length) {
      clearBatchPreview('Select one or more IFC elements to begin.');
      return;
    }
    batchPreviewElements = elements;
    await generateBatchPreview(batchPreviewElements);
  });

  batchReplaceConflicts?.addEventListener('change', () => {
    const hasConflicts = batchPreviewAssignments.some((item) => item.conflict);
    btnApplyBatchTags.disabled = !batchPreviewAssignments.length || (hasConflicts && !batchReplaceConflicts.checked);
  });

  btnApplyBatchTags?.addEventListener('click', () => {
    if (!batchPreviewAssignments.length) return;
    const conflicts = batchPreviewAssignments.filter((item) => item.conflict);
    if (conflicts.length && !batchReplaceConflicts.checked) {
      setBatchStatus('Confirm replacement of the existing assignments before applying this batch.', 'warning');
      return;
    }

    lastBatchSnapshot = batchPreviewAssignments.map((assignment) => {
      const key = getAssignmentKey(assignment.modelId, assignment.localId);
      return {
        key,
        previous: tagAssignments.has(key) ? { ...tagAssignments.get(key) } : null,
      };
    });
    for (const assignment of batchPreviewAssignments) {
      const { previousAssignment, previousTag, conflict, ...committed } = assignment;
      tagAssignments.set(getAssignmentKey(committed.modelId, committed.localId), {
        ...committed,
        excelRowIndex: selectedExcelRowIndex,
      });
    }

    const systemTag = batchPreviewAssignments[0].systemTag;
    selectedTraySystemTag = systemTag;
    systemTagInput.value = systemTag;
    btnUndoBatchTags.disabled = false;
    renderExcelTable();
    refreshValidationReportIfOpen();
    if (selectedIfcElement) syncProjectTagPropertyGroup(activeModel, selectedIfcElement.localId);
    updateTagAssignmentUi(
      `Applied ${batchPreviewAssignments.length} element tag${batchPreviewAssignments.length === 1 ? '' : 's'} to system “${systemTag}”.`,
      'success',
    );
    setBatchStatus(
      `Applied ${batchPreviewAssignments.length} tag${batchPreviewAssignments.length === 1 ? '' : 's'}. You can undo this batch until another batch is applied.`,
      'success',
    );
  });

  btnUndoBatchTags?.addEventListener('click', () => {
    if (!lastBatchSnapshot?.length) return;
    for (const snapshot of lastBatchSnapshot) {
      if (snapshot.previous) tagAssignments.set(snapshot.key, snapshot.previous);
      else tagAssignments.delete(snapshot.key);
    }
    const restoredCount = lastBatchSnapshot.length;
    lastBatchSnapshot = null;
    btnUndoBatchTags.disabled = true;
    renderExcelTable();
    refreshValidationReportIfOpen();
    if (selectedIfcElement) syncProjectTagPropertyGroup(activeModel, selectedIfcElement.localId);
    updateTagAssignmentUi(`Undid the last batch of ${restoredCount} tag${restoredCount === 1 ? '' : 's'}.`, 'success');
    setBatchStatus(`Last batch undone. ${restoredCount} element${restoredCount === 1 ? '' : 's'} restored.`, 'success');
  });

  setTaggingMode('assign');
  updateBatchPatternExample();
  reconcileSelectionOrder({});

  traySystemFilter?.addEventListener('input', () => {
    traySystemFilterText = traySystemFilter.value;
    renderTraySystemManager();
  });

  traySystemSort?.addEventListener('change', () => {
    traySystemSortMode = traySystemSort.value || 'tag';
    renderTraySystemManager();
  });

  systemTagInput.addEventListener('input', () => {
    updateTagAssignmentUi();
  });

  systemTagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !btnHighlightSystem.disabled) {
      event.preventDefault();
      btnHighlightSystem.click();
    }
  });

  btnHighlightSystem.addEventListener('click', async () => {
    const systemTag = getEnteredSystemTag();
    const members = findSystemMembers(systemTag);
    if (!members.length) {
      updateTagAssignmentUi(`Warning: no loaded components belong to tray system “${systemTag}”.`, 'warning');
      return;
    }
    await highlightTrayMembers(
      members,
      `Highlighted ${members.length} components for tray system “${systemTag}”.`,
    );
  });

  btnAddTraySelection.addEventListener('click', () => {
    if (!selectedIfcElement) return;
    traySelection.set(
      getAssignmentKey(selectedIfcElement.modelId, selectedIfcElement.localId),
      { ...selectedIfcElement },
    );
    updateTagAssignmentUi(`Added element #${selectedIfcElement.localId} to the tray-system selection.`);
  });

  btnRefreshTraySystems?.addEventListener('click', () => {
    renderTraySystemManager();
    updateTagAssignmentUi('Tray System Manager refreshed.');
  });

  btnRestoreAllDeletions?.addEventListener('click', () => {
    restoreAllPendingTrayDeletions();
  });

  btnManagerCheckContinuity?.addEventListener('click', async () => {
    await checkSelectedTraySystemContinuity();
  });

  btnClearContinuityColors?.addEventListener('click', async () => {
    await clearContinuityGroupHighlights();
    updateTagAssignmentUi('Continuity group colors cleared.');
  });

  btnManagerHighlight?.addEventListener('click', async () => {
    if (!selectedTraySystemTag) return;
    const members = findSystemMembers(selectedTraySystemTag);
    if (!members.length) {
      updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${selectedTraySystemTag}".`, 'warning');
      return;
    }
    await highlightTrayMembers(
      members,
      `Highlighted ${members.length} components for tray system "${selectedTraySystemTag}".`,
    );
  });

  btnManagerIsolate?.addEventListener('click', async () => {
    if (!selectedTraySystemTag) return;
    const members = findSystemMembers(selectedTraySystemTag);
    if (!members.length) {
      updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${selectedTraySystemTag}".`, 'warning');
      return;
    }
    await isolateTrayMembers(
      members,
      `Isolated ${members.length} components for tray system "${selectedTraySystemTag}".`,
    );
  });

  btnManagerAddSelection?.addEventListener('click', async () => {
    if (!selectedTraySystemTag) return;
    const selectedElements = await getCurrentSelectionElements();
    if (!selectedElements.length) {
      updateTagAssignmentUi('Warning: select one or more IFC elements before adding to a tray system.', 'warning');
      return;
    }
    await assignElementsToSystem(selectedTraySystemTag, selectedElements, {
      message: `Added ${selectedElements.length} selected element${selectedElements.length === 1 ? '' : 's'} to tray system "${selectedTraySystemTag}".`,
    });
  });

  btnManagerRemoveSelection?.addEventListener('click', async () => {
    if (!selectedTraySystemTag) return;
    const selectedElements = await getCurrentSelectionElements();
    if (!selectedElements.length) {
      updateTagAssignmentUi('Warning: select one or more IFC elements before removing from a tray system.', 'warning');
      return;
    }
    invalidateBatchUndo();

    let removed = 0;
    let markedDeleted = 0;
    for (const element of selectedElements) {
      const key = getAssignmentKey(element.modelId, element.localId);
      const pending = tagAssignments.get(key);
      if (pending?.systemTag?.toLowerCase() === selectedTraySystemTag.toLowerCase()) {
        tagAssignments.delete(key);
        syncProjectTagPropertyGroup(findLoadedModelEntry(element.modelId)?.model || activeModel, element.localId);
        removed += 1;
      } else if (getExistingProjectTag(element).toLowerCase() === selectedTraySystemTag.toLowerCase()) {
        const existing = getExistingTrayAssignment(element);
        tagAssignments.set(key, {
          ...element,
          systemTag: existing?.systemTag || selectedTraySystemTag,
          componentId: existing?.componentId || '',
          sequenceNumber: existing?.sequenceNumber || '',
          delete: true,
          wasSaved: true,
          excelRowIndex: selectedExcelRowIndex,
        });
        syncProjectTagPropertyGroup(findLoadedModelEntry(element.modelId)?.model || activeModel, element.localId);
        markedDeleted += 1;
      }
    }

    renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi(
      removed || markedDeleted
        ? `Removed ${removed + markedDeleted} element${removed + markedDeleted === 1 ? '' : 's'} from "${selectedTraySystemTag}"${markedDeleted ? `; ${markedDeleted} saved IFC tag${markedDeleted === 1 ? '' : 's'} marked for export deletion` : ''}.`
        : `No selected pending elements belonged to "${selectedTraySystemTag}".`,
      removed || markedDeleted ? 'success' : 'warning',
    );
  });

  btnManagerRegenerateSequence?.addEventListener('click', async () => {
    await regenerateSelectedSystemSequence();
  });

  btnManagerRename?.addEventListener('click', async () => {
    const oldTag = selectedTraySystemTag;
    const newTag = getEnteredSystemTag();
    if (!oldTag || !newTag || oldTag.toLowerCase() === newTag.toLowerCase()) return;
    invalidateBatchUndo();

    const members = findSystemMembers(oldTag);
    if (!members.length) {
      updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${oldTag}".`, 'warning');
      return;
    }

    for (const member of members) {
      const modelEntry = findLoadedModelEntry(member.modelId);
      if (!modelEntry) continue;
      const identity = await readElementIdentity(modelEntry.model, member.localId, modelEntry.name);
      const sequenceNumber = member.sequenceNumber || '001';
      const componentId = member.typeCode
        ? `${newTag}.${member.typeCode}.${sequenceNumber}`
        : `${newTag}-C${sequenceNumber}`;
      tagAssignments.set(getAssignmentKey(member.modelId, member.localId), {
        ...identity,
        systemTag: newTag,
        elementTag: componentId,
        componentId,
        elementKind: member.elementKind || '',
        typeCode: member.typeCode || '',
        sequenceNumber,
        schemeVersion: member.schemeVersion || (member.typeCode ? '2' : ''),
        originalIfcTag: member.originalIfcTag || identity.ifcTag || '',
        classificationMethod: member.classificationMethod || '',
        classificationConfidence: member.classificationConfidence ?? '',
        excelRowIndex: member.excelRowIndex ?? selectedExcelRowIndex,
      });
      if (selectedIfcElement?.modelId === member.modelId && Number(selectedIfcElement.localId) === Number(member.localId)) {
        syncProjectTagPropertyGroup(modelEntry.model, member.localId);
      }
    }

    selectedTraySystemTag = newTag;
    renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi(`Renamed tray system "${oldTag}" to "${newTag}" for ${members.length} component${members.length === 1 ? '' : 's'}.`, 'success');
  });

  btnAssignTag.addEventListener('click', async () => {
    const systemTag = getEnteredSystemTag();
    const selectedElements = traySelection.size
      ? Array.from(traySelection.values())
      : await getCurrentSelectionElements();
    await assignElementsToSystem(systemTag, selectedElements);
  });

  btnUnassignTag.addEventListener('click', () => {
    const assignment = getAssignmentForElement();
    if (!assignment) return;
    invalidateBatchUndo();
    tagAssignments.delete(getAssignmentKey(assignment.modelId, assignment.localId));
    selectedExcelRowIndex = assignment.excelRowIndex;
    renderExcelTable();
    updateTagAssignmentUi(`Removed “${assignment.systemTag}” from element #${assignment.localId}.`);
    syncProjectTagPropertyGroup(activeModel, assignment.localId);
    refreshValidationReportIfOpen();
  });

  btnValidateTags.addEventListener('click', () => {
    const result = runTagValidation();
    updateTagAssignmentUi(
      result.valid
        ? `Validation complete: ${result.counts.errors} errors and ${result.counts.warnings} warnings.`
        : `Validation blocked export: ${result.counts.errors} error${result.counts.errors === 1 ? '' : 's'} found.`,
      result.valid ? (result.warnings.length ? 'warning' : 'success') : 'warning',
    );
  });

  btnExportTags.addEventListener('click', async () => {
    if (getEffectiveTaggedElements().length === 0) return;
    updateTagAssignmentUi('Reading tray dimensions for the mapping export...');
    btnExportTags.disabled = true;
    const assignments = getEffectiveTaggedElements()
      .sort((a, b) => a.systemTag.localeCompare(b.systemTag) || Number(a.sequenceNumber) - Number(b.sequenceNumber));
    const rows = await Promise.all(assignments.map(async (assignment) => {
      const modelEntry = findLoadedModelEntry(assignment.modelId);
      const identity = modelEntry
        ? await readElementIdentity(modelEntry.model, assignment.localId, modelEntry.name)
        : assignment;
      return {
        Model: assignment.modelName,
        IFC_GlobalId: assignment.globalId || identity.globalId || '',
        Local_ID: assignment.localId,
        SystemTag: assignment.systemTag,
        ElementTag: assignment.elementTag || assignment.componentId,
        ComponentId: assignment.componentId,
        ElementKind: assignment.elementKind || '',
        TypeCode: assignment.typeCode || '',
        SequenceNumber: assignment.sequenceNumber,
        SourceState: getAssignmentSourceLabel({
          ...assignment,
          source: assignment.source,
          wasSaved: Boolean(getExistingTrayAssignment(assignment)),
        }),
        Element_Name: assignment.name || identity.name || '',
        IFC_Type: assignment.type || identity.type || '',
        ...await readElementDimensions(assignment),
        Original_IFC_Tag: assignment.originalIfcTag || identity.ifcTag || '',
        Classification_Method: assignment.classificationMethod || '',
        Classification_Confidence: assignment.classificationConfidence ?? '',
        Excel_Row: Number.isInteger(assignment.excelRowIndex) ? assignment.excelRowIndex + 2 : '',
      };
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tag Register');
    const summaryRows = getTraySystemSummaries().map((system) => ({
      SystemTag: system.tag,
      Components: system.count,
      CableTrays: system.members.filter((member) => member.elementKind === 'tray').length,
      CableFittings: system.members.filter((member) => member.elementKind === 'fitting').length,
      Models: system.models.join(', '),
      Status: system.status,
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
    XLSX.writeFile(workbook, 'IFC_Tag_Mapping.xlsx');
    updateTagAssignmentUi(`Exported ${rows.length} tag assignment${rows.length === 1 ? '' : 's'}.`);
  });

  btnExportTaggedIfc.addEventListener('click', () => {
    if (tagAssignments.size === 0) return;

    const validation = runTagValidation();
    if (!validation.valid) {
      updateTagAssignmentUi(
        `Export blocked: resolve ${validation.counts.errors} tag validation error${validation.counts.errors === 1 ? '' : 's'} first.`,
        'warning',
      );
      return;
    }

    let exportedModels = 0;
    let exportedTags = 0;
    let createdTags = 0;
    let updatedTags = 0;
    let deletedTags = 0;
    let skippedTags = 0;
    for (const modelEntry of loadedModels) {
      const assignments = Array.from(tagAssignments.values()).filter((assignment) =>
        assignment.modelId === modelEntry.model.modelId || assignment.modelId === modelEntry.model.uuid
      );
      if (!assignments.length) continue;
      if (!modelEntry.sourceIfcBytes) {
        skippedTags += assignments.length;
        continue;
      }

      try {
        const result = addTraySystemAssignmentsToIfc(modelEntry.sourceIfcBytes, assignments);
        const blob = new Blob([result.bytes], { type: 'application/x-step' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = taggedIfcFileName(modelEntry.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        exportedModels += 1;
        exportedTags += result.applied.length;
        createdTags += result.applied.filter((item) => item.action === 'created').length;
        updatedTags += result.applied.filter((item) => item.action === 'updated').length;
        deletedTags += result.applied.filter((item) => item.action === 'deleted').length;
        skippedTags += result.skipped.length;
      } catch (error) {
        console.error(`[IFC Tag Export] ${modelEntry.name}:`, error);
        skippedTags += assignments.length;
      }
    }

    if (exportedModels === 0) {
      updateTagAssignmentUi('Warning: no tagged IFC could be generated from the loaded source models.', 'warning');
      return;
    }
    const actionSummary = [
      createdTags ? `${createdTags} created` : '',
      updatedTags ? `${updatedTags} updated` : '',
      deletedTags ? `${deletedTags} deleted` : '',
    ].filter(Boolean).join(', ');
    updateTagAssignmentUi(
      `Successfully exported ${exportedTags} change${exportedTags === 1 ? '' : 's'} into ${exportedModels} new IFC file${exportedModels === 1 ? '' : 's'}${actionSummary ? ` (${actionSummary})` : ''}${skippedTags ? `; ${skippedTags} skipped` : ''}.`,
      skippedTags ? 'warning' : 'success',
    );
  });

  // Toggle Excel Drawer Collapse
  if (btnExcelPanelClose && excelPanel) {
    btnExcelPanelClose.addEventListener('click', () => {
      excelPanel.classList.toggle('collapsed');
      
      const isCollapsed = excelPanel.classList.contains('collapsed');
      const toggleSpan = btnExcelPanelClose.querySelector('span');
      if (toggleSpan) {
        toggleSpan.innerText = isCollapsed ? '◀' : '▶';
      }
      
      if (world.renderer && world.renderer.resize) {
        world.renderer.resize();
      }
    });
  }

  // Handle window resizing
  window.addEventListener('resize', () => {
    if (world.renderer && world.renderer.resize) {
      world.renderer.resize();
    }
  });

  // Initialize Excel-IFC WebSocket bridge linkage
  initExcelBridge(components, world);
}

// Start app on load
window.addEventListener('DOMContentLoaded', () => {
  initApp().catch(err => {
    console.error("Failed to initialize the BIM app:", err);
  });
});
