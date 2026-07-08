import './style.css';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import * as XLSX from 'xlsx';
import { initExcelBridge, sendMeasurementToExcel } from './viewer-socket.js';
import { initRoutingController } from './routing/routing-controller.js';
import { addProjectTagsToIfc, taggedIfcFileName } from './ifc/ifc-tag-exporter.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

// Global variables for active model and state
let activeModel = null;
let loadedModels = []; // Track all loaded models: { uuid, name, size, model, visible }
let isWireframe = false;
let excelData = [];
let excelColumns = [];
let selectedExcelIdColumn = "";
let selectedExcelRowIndex = null;
let selectedIfcElement = null;
const tagAssignments = new Map();
let autoRotateActive = false;
let isTransformEnabled = false;

// DOM Elements
const container = document.getElementById('viewer-container');
const sidebar = document.getElementById('sidebar');
const btnSidebarToggle = document.getElementById('sidebar-toggle');
const btnLoadSample = document.getElementById('btn-load-sample');
const btnUpload = document.getElementById('btn-upload');
const fileInput = document.getElementById('file-input');
const btnResetCamera = document.getElementById('btn-reset-camera');
const toggleGrid = document.getElementById('toggle-grid');
const toggleWireframe = document.getElementById('toggle-wireframe');
const toggleDarkMode = document.getElementById('toggle-darkmode');

// Measurement DOM Elements
const btnToggleMeasure = document.getElementById('btn-toggle-measure');
const btnClearMeasure = document.getElementById('btn-clear-measure');
const measurementsListContainer = document.getElementById('measurements-list-container');
const measurementsListItems = document.getElementById('measurements-list-items');

// Excel DOM Elements
const excelFileInput = document.getElementById('excel-file-input');
const btnUploadExcel = document.getElementById('btn-upload-excel');
const excelPanel = document.getElementById('excel-panel');
const btnExcelPanelClose = document.getElementById('excel-panel-close');
const excelFileName = document.getElementById('excel-file-name');
const excelIdColumn = document.getElementById('excel-id-column');
const excelSearch = document.getElementById('excel-search');
const excelDataTable = document.getElementById('excel-data-table');
const excelTableHeader = document.getElementById('excel-table-header');
const excelTableBody = document.getElementById('excel-table-body');
const tagAssignmentStatus = document.getElementById('tag-assignment-status');
const tagAssignmentSummary = document.getElementById('tag-assignment-summary');
const btnAssignTag = document.getElementById('btn-assign-tag');
const btnUnassignTag = document.getElementById('btn-unassign-tag');
const btnExportTags = document.getElementById('btn-export-tags');
const btnExportTaggedIfc = document.getElementById('btn-export-tagged-ifc');

// Loaded Models DOM Elements
const loadedModelsContainer = document.getElementById('loaded-models-container');
const loadedModelsList = document.getElementById('loaded-models-list');
const modelsPlaceholder = loadedModelsContainer ? loadedModelsContainer.querySelector('.models-placeholder') : null;

// Transform & Orbit DOM Elements
const toggleTransform = document.getElementById('toggle-transform');
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
  //  MODEL DRAGGING (TransformControls)
  // ──────────────────────────────────────────────
  let transformControls = null;

  // Lock camera when dragging transform axes
  function onTransformDraggingChanged(event) {
    if (world.camera && world.camera.controls) {
      world.camera.controls.enabled = !event.value;
    }
  }

  function enableTransformControls() {
    if (!transformControls && world.camera && world.renderer) {
      transformControls = new TransformControls(world.camera.three, world.renderer.three.domElement);
      world.scene.three.add(transformControls);
      transformControls.addEventListener('dragging-changed', onTransformDraggingChanged);
      console.log("[TransformControls] Enabled and listeners bound.");
    }
  }

  function disableTransformControls() {
    if (transformControls) {
      transformControls.detach();
      transformControls.removeEventListener('dragging-changed', onTransformDraggingChanged);
      world.scene.three.remove(transformControls);
      transformControls.dispose();
      transformControls = null;
      console.log("[TransformControls] Disabled and listeners disposed.");
      
      // Ensure camera controls are re-enabled
      if (world.camera && world.camera.controls) {
        world.camera.controls.enabled = true;
      }
    }
  }

  // Attach/Detach controls to active model
  function updateTransformAttachment() {
    if (isTransformEnabled) {
      enableTransformControls();
      if (transformControls && activeModel) {
        const modelObject = activeModel.object || activeModel;
        if (modelObject) {
          transformControls.attach(modelObject);
          return;
        }
      }
    } else {
      disableTransformControls();
    }
  }

  // Handle Dragging Checkbox Toggle
  if (toggleTransform) {
    toggleTransform.addEventListener('change', () => {
      isTransformEnabled = toggleTransform.checked;
      updateTransformAttachment();
    });
  }

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

  // 6. Set up IfcLoader and Configure WASM path
  const ifcLoader = components.get(OBC.IfcLoader);
  ifcLoader.settings.autoSetWasm = false;
  ifcLoader.settings.wasm = {
    path: "https://unpkg.com/web-ifc@0.0.77/",
    absolute: true
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
  highlighter.styles.set('select', { color: new THREE.Color('#6366f1'), opacity: 0.6, transparent: true });
  const routingController = initRoutingController({ world, getLoadedModels: () => loadedModels });

  function getAssignmentKey(modelId, localId) {
    return `${modelId}:${Number(localId)}`;
  }

  function getSelectedExcelTag() {
    if (selectedExcelRowIndex === null || !selectedExcelIdColumn) return '';
    return String(excelData[selectedExcelRowIndex]?.[selectedExcelIdColumn] ?? '').trim();
  }

  function getAssignmentForElement(element = selectedIfcElement) {
    if (!element) return null;
    return tagAssignments.get(getAssignmentKey(element.modelId, element.localId)) || null;
  }

  function updateTagAssignmentUi(message = '', tone = '') {
    const selectedTag = getSelectedExcelTag();
    const assignment = getAssignmentForElement();
    const elementLabel = selectedIfcElement
      ? `${selectedIfcElement.name || selectedIfcElement.type || 'IFC element'} (#${selectedIfcElement.localId})`
      : 'no IFC element selected';
    const rowLabel = selectedTag ? `tag “${selectedTag}”` : 'no Excel tag selected';

    tagAssignmentStatus.textContent = message || `${rowLabel}; ${elementLabel}.`;
    if (tone) tagAssignmentStatus.dataset.tone = tone;
    else delete tagAssignmentStatus.dataset.tone;
    tagAssignmentSummary.textContent = `${tagAssignments.size} assignment${tagAssignments.size === 1 ? '' : 's'}`;
    btnAssignTag.disabled = !selectedTag || !selectedIfcElement;
    btnUnassignTag.disabled = !assignment;
    btnExportTags.disabled = tagAssignments.size === 0;
    btnExportTaggedIfc.disabled = tagAssignments.size === 0;

    if (selectedIfcElement) {
      const displayedTag = assignment?.tag || selectedIfcElement.ifcTag || '-';
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

    let selectedModelId = null;
    let selectedExpressId = null;
    if (fragmentMap && Object.keys(fragmentMap).length > 0) {
      for (const modelId in fragmentMap) {
        const ids = fragmentMap[modelId];
        if (ids && ids.size > 0) {
          selectedModelId = modelId;
          selectedExpressId = Array.from(ids)[0];
          break;
        } else if (Array.isArray(ids) && ids.length > 0) {
          selectedModelId = modelId;
          selectedExpressId = ids[0];
          break;
        }
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
        updateTagAssignmentUi();
        refreshLoadedModelsList();
        
        // Auto-attach transform controls to this model if transform mode is enabled
        if (isTransformEnabled && transformControls) {
          const modelObject = activeModel.object || activeModel;
          if (modelObject) {
            transformControls.attach(modelObject);
          }
        }
      }
    }
  });

  highlighter.events.select.onClear.add(() => {
    if (highlighter.isProgrammaticSelect) return;

    activeModel = null;
    selectedIfcElement = null;
    routingController.setSelectedElement(null, null);
    updateTagAssignmentUi();
    autoRotateActive = false;
    if (orbitIndicator) {
      orbitIndicator.style.display = 'none';
    }

    // Reset element properties panel
    clearElementProperties();
    
    // Detach transform controls if active selection cleared
    if (transformControls) {
      transformControls.detach();
    }

    refreshLoadedModelsList();
  });

  // ──────────────────────────────────────────────
  //  3D LENGTH MEASUREMENT TOOLKIT
  // ──────────────────────────────────────────────
  const measurer = components.get(OBF.LengthMeasurement);
  measurer.world = world;
  measurer.units = 'm';
  measurer.rounding = 2;
  measurer.color = new THREE.Color('#6366f1');
  let isMeasuring = false;

  // Format distance value for display
  function formatMeasureValue(line) {
    try {
      return `${line.value.toFixed(2)} m`;
    } catch {
      return '—';
    }
  }

  // Rebuild the sidebar dimension list from the measurer's dataset
  function refreshMeasurementsList() {
    if (!measurementsListItems) return;
    measurementsListItems.innerHTML = '';

    const entries = Array.from(measurer.list);
    if (entries.length === 0) {
      if (measurementsListContainer) measurementsListContainer.style.display = 'none';
      return;
    }
    if (measurementsListContainer) measurementsListContainer.style.display = 'block';

    entries.forEach((line, idx) => {
      const li = document.createElement('li');
      li.className = 'measure-item';

      // Distance value
      const valueSpan = document.createElement('span');
      valueSpan.className = 'measure-value';
      valueSpan.textContent = formatMeasureValue(line);

      // Action buttons container
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'measure-actions';

      // Zoom button
      const zoomBtn = document.createElement('button');
      zoomBtn.className = 'measure-btn zoom';
      zoomBtn.title = 'Zoom to fit';
      zoomBtn.textContent = '🔍';
      zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          const center = new THREE.Vector3();
          line.getCenter(center);
          const sphere = new THREE.Sphere(center, Math.max(line.distance() * 0.8, 1.0));
          if (world.camera && world.camera.controls) {
            world.camera.controls.fitToSphere(sphere, true);
          }
        } catch (err) {
          console.warn('[Measurements] Zoom to dimension failed:', err);
        }
      });

      // Link to Excel button
      const linkBtn = document.createElement('button');
      linkBtn.className = 'measure-btn link';
      linkBtn.title = 'Send value to Excel';
      linkBtn.textContent = '📊';
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = formatMeasureValue(line);
        const sent = sendMeasurementToExcel(val);
        if (sent) {
          linkBtn.textContent = '✅';
          setTimeout(() => { linkBtn.textContent = '📊'; }, 1200);
        } else {
          linkBtn.textContent = '⚠️';
          setTimeout(() => { linkBtn.textContent = '📊'; }, 1200);
        }
      });

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'measure-btn delete';
      deleteBtn.title = 'Delete measurement';
      deleteBtn.textContent = '🗑️';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          measurer.list.delete(line);
        } catch (err) {
          console.warn('[Measurements] Delete single dimension failed:', err);
        }
      });

      actionsDiv.appendChild(zoomBtn);
      actionsDiv.appendChild(linkBtn);
      actionsDiv.appendChild(deleteBtn);

      li.appendChild(valueSpan);
      li.appendChild(actionsDiv);
      measurementsListItems.appendChild(li);
    });
  }

  // Subscribe to DataSet events on the measurer's list
  measurer.list.onItemAdded.add(() => refreshMeasurementsList());
  measurer.list.onItemDeleted.add(() => refreshMeasurementsList());
  measurer.list.onCleared.add(() => refreshMeasurementsList());

  // Toggle measuring mode
  if (btnToggleMeasure) {
    btnToggleMeasure.addEventListener('click', () => {
      isMeasuring = !isMeasuring;
      measurer.enabled = isMeasuring;
      btnToggleMeasure.innerHTML = isMeasuring
        ? '<span>📐</span> Disable Measuring'
        : '<span>📐</span> Enable Measuring';
      btnToggleMeasure.classList.toggle('btn-primary', isMeasuring);
      btnToggleMeasure.classList.toggle('btn-action', !isMeasuring);
    });
  }

  // Clear all measurements
  if (btnClearMeasure) {
    btnClearMeasure.addEventListener('click', () => {
      try {
        measurer.list.clear();
      } catch (err) {
        console.warn('[Measurements] Clear all failed:', err);
      }
    });
  }

  // Allow Delete key to remove hovered measurement
  window.addEventListener('keydown', (event) => {
    if ((event.code === 'Delete' || event.code === 'Backspace') && measurer.enabled) {
      measurer.delete();
    }
  });

  // Helper: Fit camera to all visible models or a single model
  function fitModelsToView(modelsToFit = null) {
    const targets = modelsToFit || loadedModels.filter(m => m.visible).map(m => m.model);
    if (targets.length === 0) {
      world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
      return;
    }

    try {
      const bboxer = components.get(OBC.BoundingBoxer);
      bboxer.list.clear();
      
      let added = false;
      for (const model of targets) {
        const modelObject = model.object || model;
        if (modelObject) {
          bboxer.add(modelObject);
          added = true;
        }
      }

      if (added) {
        const box = bboxer.get();
        if (box && !box.isEmpty()) {
          const sphere = new THREE.Sphere();
          box.getBoundingSphere(sphere);
          world.camera.controls.fitToSphere(sphere, true);
        }
      }
      bboxer.list.clear();
    } catch (e) {
      console.warn("BoundingBoxer failed, computing bounding sphere manually:", e);
      let combinedBox = new THREE.Box3();
      let hasBox = false;
      for (const model of targets) {
        const modelObject = model.object || model;
        if (modelObject) {
          const box = new THREE.Box3().setFromObject(modelObject);
          if (!hasBox) {
            combinedBox.copy(box);
            hasBox = true;
          } else {
            combinedBox.union(box);
          }
        }
      }
      if (hasBox && !combinedBox.isEmpty()) {
        const sphere = new THREE.Sphere();
        combinedBox.getBoundingSphere(sphere);
        world.camera.controls.fitToSphere(sphere, true);
      }
    }
  }

  // Helper: Fit camera to a single model
  function fitModelToView(model) {
    fitModelsToView([model]);
  }

  // Helper: Unload a single model
  function unloadModel(modelEntry) {
    const model = modelEntry.model;
    const modelObject = model.object || model;
    
    // Detach TransformControls if attached to the model being unloaded
    if (transformControls && transformControls.object === modelObject) {
      transformControls.detach();
    }
    
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
    loadedModels = loadedModels.filter(m => m.uuid !== modelEntry.uuid);

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

    const details = document.createElement('details');
    details.className = `pset-group${isQuantity ? ' quantity-group' : ''}`;

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
    propPsetsContainer.appendChild(details);
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
      zoomBtn.title = 'Zoom to model';
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
          
          // Detach TransformControls
          updateTransformAttachment();
          
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

        // 4. Update model transform axes attachment
        updateTransformAttachment();
        
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
        model = await ifcLoader.load(buffer, false, name, {
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
        model = await ifcLoader.load(buffer);
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
        visible: true
      };

      loadedModels.push(modelEntry);

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

  // Helper: Zoom to a specific Express ID inside a specific model
  async function zoomToElementInModel(model, expressId) {
    if (!model) return;
    try {
      const bboxer = components.get(OBC.BoundingBoxer);
      bboxer.list.clear();
      await bboxer.addFromModelIdMap({ [model.uuid]: new Set([Number(expressId)]) });
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

  // Render parsed Excel table rows in UI
  function renderExcelTable() {
    excelTableHeader.innerHTML = '';
    excelTableBody.innerHTML = '';
    
    if (excelData.length === 0) {
      excelDataTable.style.display = 'none';
      excelPanel.querySelector('.excel-placeholder').style.display = 'block';
      return;
    }
    
    excelPanel.querySelector('.excel-placeholder').style.display = 'none';
    excelDataTable.style.display = 'table';
    
    // Create header row
    excelColumns.forEach(col => {
      const th = document.createElement('th');
      th.innerText = col;
      excelTableHeader.appendChild(th);
    });
    const assignmentHeader = document.createElement('th');
    assignmentHeader.innerText = 'Assignment';
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

      const rowAssignment = Array.from(tagAssignments.values()).find((assignment) => assignment.excelRowIndex === index);
      if (rowAssignment) tr.classList.add('assigned');
      
      excelColumns.forEach(col => {
        const td = document.createElement('td');
        td.innerText = row[col] !== undefined ? row[col] : "";
        td.title = td.innerText;
        tr.appendChild(td);
      });

      const statusCell = document.createElement('td');
      statusCell.className = 'assignment-cell';
      statusCell.textContent = rowAssignment ? `Assigned #${rowAssignment.localId}` : 'Unassigned';
      statusCell.title = rowAssignment
        ? `${rowAssignment.modelName} / ${rowAssignment.globalId || `local ID ${rowAssignment.localId}`}`
        : 'This Excel tag has not been assigned.';
      tr.appendChild(statusCell);
      
      tr.addEventListener('click', async () => {
        excelTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
        tr.classList.add('active');
        selectedExcelRowIndex = index;
        updateTagAssignmentUi();

        if (rowAssignment) {
          const modelEntry = loadedModels.find((entry) =>
            entry.model?.modelId === rowAssignment.modelId || entry.model?.uuid === rowAssignment.modelId
          );
          if (!modelEntry) {
            updateTagAssignmentUi(`Warning: the model for tag “${rowAssignment.tag}” is not loaded.`, 'warning');
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
            await highlighter.highlightByID(
              'select',
              { [rowAssignment.modelId]: new Set([Number(rowAssignment.localId)]) },
              true,
              true,
            );
            activeModel = modelEntry.model;
            await displayElementProperties(modelEntry.model, rowAssignment.localId, modelEntry.name);
            selectedIfcElement = await readElementIdentity(modelEntry.model, rowAssignment.localId, modelEntry.name);
            routingController.setSelectedElement(modelEntry.model, rowAssignment.localId);
            updateTagAssignmentUi(`Highlighted element #${rowAssignment.localId} for tag “${rowAssignment.tag}”.`);
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
          tagAssignments.clear();
          
          excelIdColumn.innerHTML = '<option value="">(Select tag column)</option>';
          let preselectedCol = "";
          excelColumns.forEach(col => {
            const option = document.createElement('option');
            option.value = col;
            option.innerText = col;
            excelIdColumn.appendChild(option);
            
            const lowerCol = col.toLowerCase();
            if (lowerCol === 'tag' || lowerCol === 'element tag' || lowerCol === 'elementtag' || lowerCol === 'tray tag' || lowerCol === 'traytag') {
              preselectedCol = col;
            }
          });
          
          if (preselectedCol) {
            excelIdColumn.value = preselectedCol;
            selectedExcelIdColumn = preselectedCol;
          } else {
            selectedExcelIdColumn = "";
          }

          renderExcelTable();
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
    updateTagAssignmentUi();
  });

  excelSearch.addEventListener('input', () => {
    renderExcelTable();
  });

  btnAssignTag.addEventListener('click', () => {
    const tag = getSelectedExcelTag();
    if (!tag || !selectedIfcElement) return;

    const currentAssignment = getAssignmentForElement();
    if (currentAssignment) {
      updateTagAssignmentUi(
        `Warning: element #${selectedIfcElement.localId} already has tag “${currentAssignment.tag}”. Unassign it before assigning another tag.`,
        'warning',
      );
      return;
    }

    let conflictingAssignment = null;
    for (const [key, assignment] of tagAssignments) {
      if (assignment.tag.toLowerCase() === tag.toLowerCase() &&
          key !== getAssignmentKey(selectedIfcElement.modelId, selectedIfcElement.localId)) {
        conflictingAssignment = assignment;
        break;
      }
    }
    if (conflictingAssignment) {
      updateTagAssignmentUi(
        `Warning: tag “${tag}” is already assigned to element #${conflictingAssignment.localId}.`,
        'warning',
      );
      return;
    }

    for (const [key, assignment] of tagAssignments) {
      if (assignment.excelRowIndex === selectedExcelRowIndex) tagAssignments.delete(key);
    }

    const key = getAssignmentKey(selectedIfcElement.modelId, selectedIfcElement.localId);
    tagAssignments.set(key, {
      ...selectedIfcElement,
      tag,
      excelRowIndex: selectedExcelRowIndex,
    });

    const assignedTag = tag;
    const nextIndex = excelData.findIndex((_, index) =>
      index > selectedExcelRowIndex &&
      !Array.from(tagAssignments.values()).some((assignment) => assignment.excelRowIndex === index)
    );
    if (nextIndex !== -1) selectedExcelRowIndex = nextIndex;

    renderExcelTable();
    updateTagAssignmentUi(
      `Successfully assigned “${assignedTag}” to element #${selectedIfcElement.localId}.`,
      'success',
    );
  });

  btnUnassignTag.addEventListener('click', () => {
    const assignment = getAssignmentForElement();
    if (!assignment) return;
    tagAssignments.delete(getAssignmentKey(assignment.modelId, assignment.localId));
    selectedExcelRowIndex = assignment.excelRowIndex;
    renderExcelTable();
    updateTagAssignmentUi(`Removed “${assignment.tag}” from element #${assignment.localId}.`);
  });

  btnExportTags.addEventListener('click', () => {
    if (tagAssignments.size === 0) return;
    const rows = Array.from(tagAssignments.values())
      .sort((a, b) => a.excelRowIndex - b.excelRowIndex)
      .map((assignment) => ({
        Model: assignment.modelName,
        IFC_GlobalId: assignment.globalId,
        Local_ID: assignment.localId,
        Tag: assignment.tag,
        Element_Name: assignment.name,
        IFC_Type: assignment.type,
        Excel_Row: assignment.excelRowIndex + 2,
      }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tag Mapping');
    XLSX.writeFile(workbook, 'IFC_Tag_Mapping.xlsx');
    updateTagAssignmentUi(`Exported ${rows.length} tag assignment${rows.length === 1 ? '' : 's'}.`);
  });

  btnExportTaggedIfc.addEventListener('click', () => {
    if (tagAssignments.size === 0) return;

    let exportedModels = 0;
    let exportedTags = 0;
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
        const result = addProjectTagsToIfc(modelEntry.sourceIfcBytes, assignments);
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
    updateTagAssignmentUi(
      `Successfully exported ${exportedTags} tag${exportedTags === 1 ? '' : 's'} into ${exportedModels} new IFC file${exportedModels === 1 ? '' : 's'}${skippedTags ? `; ${skippedTags} skipped` : ''}.`,
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
