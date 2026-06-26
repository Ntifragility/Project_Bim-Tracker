import './style.css';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import * as XLSX from 'xlsx';
import { initExcelBridge, sendMeasurementToExcel } from './viewer-socket.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

// Global variables for active model and state
let activeModel = null;
let loadedModels = []; // Track all loaded models: { uuid, name, size, model, visible }
let isWireframe = false;
let excelData = [];
let excelColumns = [];
let selectedExcelIdColumn = "";
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

const modelStats = document.getElementById('model-stats');
const statName = document.getElementById('stat-name');
const statSize = document.getElementById('stat-size');
const statMeshes = document.getElementById('stat-meshes');
const statElements = document.getElementById('stat-elements');

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

  // 7. Set up Highlighter
  const highlighter = components.get(OBF.Highlighter);
  highlighter.setup({ world });
  highlighter.styles.set('select', { color: new THREE.Color('#6366f1'), opacity: 0.6, transparent: true });

  // Bidirectional highlighting: 3D Selection -> Excel Selection & Loaded Models Sync
  highlighter.events.select.onHighlight.add(async (fragmentMap) => {
    if (highlighter.isProgrammaticSelect) return;

    let selectedExpressId = null;
    if (fragmentMap && Object.keys(fragmentMap).length > 0) {
      for (const fragId in fragmentMap) {
        const ids = fragmentMap[fragId];
        if (ids && ids.size > 0) {
          selectedExpressId = Array.from(ids)[0];
          break;
        } else if (Array.isArray(ids) && ids.length > 0) {
          selectedExpressId = ids[0];
          break;
        }
      }
    }
    
    if (selectedExpressId !== null) {
      const expressIdNum = Number(selectedExpressId);
      
      // 1. Sync viewport selection to Excel table row if matching column is defined
      if (selectedExcelIdColumn) {
        const rows = excelTableBody.querySelectorAll('tr');
        let foundRow = null;
        rows.forEach(tr => {
          tr.classList.remove('active');
          if (Number(tr.dataset.expressId) === expressIdNum) {
            foundRow = tr;
          }
        });
        
        if (foundRow) {
          foundRow.classList.add('active');
          foundRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      // 2. Sync viewport selection back to active model state and Loaded Models sidebar list
      let foundModelEntry = null;
      for (const m of loadedModels) {
        if (m.model.expressIDToFragmentMap && (expressIdNum in m.model.expressIDToFragmentMap)) {
          foundModelEntry = m;
          break;
        }
      }
      
      if (foundModelEntry) {
        activeModel = foundModelEntry.model;
        updateStats(foundModelEntry.name, foundModelEntry.size, foundModelEntry.model);
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

    excelTableBody.querySelectorAll('tr').forEach(tr => tr.classList.remove('active'));
    
    activeModel = null;
    autoRotateActive = false;
    if (orbitIndicator) {
      orbitIndicator.style.display = 'none';
    }

    // Reset stats panel
    modelStats.classList.add('empty');
    modelStats.classList.remove('active');
    modelStats.querySelector('.stats-placeholder').style.display = 'block';
    modelStats.querySelector('.stats-data').style.display = 'none';
    
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
        updateStats(nextActive.name, nextActive.size, nextActive.model);
      } else {
        activeModel = null;
        // Reset properties panel
        modelStats.classList.add('empty');
        modelStats.classList.remove('active');
        modelStats.querySelector('.stats-placeholder').style.display = 'block';
        modelStats.querySelector('.stats-data').style.display = 'none';
      }
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

  // Helper: Update model statistics
  function updateStats(fileName, fileSize, model) {
    const modelObject = model.object || model;

    // Count meshes
    let meshCount = 0;
    modelObject.traverse(child => {
      if (child.isMesh) meshCount++;
    });

    // Count elements/Express IDs
    let elementCount = 0;
    if (model.items && Array.isArray(model.items)) {
      const expressIDs = new Set();
      for (const item of model.items) {
        if (item.ids) {
          for (const id of item.ids) {
            expressIDs.add(id);
          }
        }
      }
      elementCount = expressIDs.size > 0 ? expressIDs.size : model.items.length;
    } else if (model.expressIDToFragmentMap) {
      elementCount = Object.keys(model.expressIDToFragmentMap).length;
    } else {
      elementCount = meshCount;
    }

    statName.innerText = fileName;
    statSize.innerText = fileSize;
    statMeshes.innerText = meshCount;
    statElements.innerText = elementCount;

    modelStats.classList.remove('empty');
    modelStats.classList.add('active');
    modelStats.querySelector('.stats-placeholder').style.display = 'none';
    modelStats.querySelector('.stats-data').style.display = 'flex';
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
          
          // Reset stats panel
          modelStats.classList.add('empty');
          modelStats.classList.remove('active');
          modelStats.querySelector('.stats-placeholder').style.display = 'block';
          modelStats.querySelector('.stats-data').style.display = 'none';
          
          // Detach TransformControls
          updateTransformAttachment();
          
          refreshLoadedModelsList();
          return;
        }

        // Select the clicked model
        activeModel = modelEntry.model;
        updateStats(modelEntry.name, modelEntry.size, modelEntry.model);
        
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

      // Create model entry
      const modelEntry = {
        uuid: model.uuid || Math.random().toString(36).substring(7),
        name: name,
        size: sizeFormatted,
        model: model,
        visible: true
      };

      loadedModels.push(modelEntry);

      // Fit camera to model
      fitModelToView(model);

      // Apply current wireframe setting
      setWireframeForModel(model, isWireframe);

      // Refresh loaded models UI
      refreshLoadedModelsList();

      // Update UI stats
      updateStats(name, sizeFormatted, model);

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
      
      if (selectedExcelIdColumn && row[selectedExcelIdColumn]) {
        tr.dataset.expressId = row[selectedExcelIdColumn];
      }
      
      excelColumns.forEach(col => {
        const td = document.createElement('td');
        td.innerText = row[col] !== undefined ? row[col] : "";
        td.title = td.innerText;
        tr.appendChild(td);
      });
      
      tr.addEventListener('click', async () => {
        excelTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
        tr.classList.add('active');
        
        if (selectedExcelIdColumn && row[selectedExcelIdColumn]) {
          const expressId = Number(row[selectedExcelIdColumn]);
          if (!isNaN(expressId)) {
            // Find which loaded model has this express ID
            let foundModelEntry = null;
            let selectedFragmentMap = null;
            
            for (const m of loadedModels) {
              if (m.model.expressIDToFragmentMap && (expressId in m.model.expressIDToFragmentMap)) {
                foundModelEntry = m;
                selectedFragmentMap = m.model.getFragmentMap([expressId]);
                break;
              }
            }
            
            if (foundModelEntry && selectedFragmentMap) {
              // Ensure the model is visible to highlight and zoom to it
              if (!foundModelEntry.visible) {
                foundModelEntry.visible = true;
                const modelObject = foundModelEntry.model.object || foundModelEntry.model;
                if (modelObject) modelObject.visible = true;
                refreshLoadedModelsList();
              }
              
              highlighter.isProgrammaticSelect = true;
              try {
                await highlighter.highlightByID("select", selectedFragmentMap, true);
              } catch (err) {
                console.warn("[Excel Linkage] Selection highlight failed:", err);
              } finally {
                highlighter.isProgrammaticSelect = false;
              }
              zoomToElementInModel(foundModelEntry.model, expressId);
            } else {
              console.warn(`[Excel Linkage] Express ID '${expressId}' not found in any loaded model.`);
            }
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
          
          excelIdColumn.innerHTML = '<option value="">(Select column)</option>';
          let preselectedCol = "";
          excelColumns.forEach(col => {
            const option = document.createElement('option');
            option.value = col;
            option.innerText = col;
            excelIdColumn.appendChild(option);
            
            const lowerCol = col.toLowerCase();
            if (lowerCol === 'express id' || lowerCol === 'expressid' || lowerCol === 'id' || lowerCol === 'tag' || lowerCol === 'element id' || lowerCol === 'elementid') {
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
  });

  excelSearch.addEventListener('input', () => {
    renderExcelTable();
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
