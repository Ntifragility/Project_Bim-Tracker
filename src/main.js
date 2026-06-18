import './style.css';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';

// Global variables for active model and state
let activeModel = null;
let isWireframe = false;

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

  // Helper: Fit camera to active model
  function fitModelToView(model) {
    if (!model) return;
    const modelObject = model.object || model;
    try {
      const bboxer = components.get(OBC.BoundingBoxer);
      bboxer.add(modelObject);
      const box = bboxer.get();
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      world.camera.controls.fitToSphere(sphere, true);
      bboxer.reset();
    } catch (e) {
      console.warn("BoundingBoxer failed, computing bounding sphere manually:", e);
      const box = new THREE.Box3().setFromObject(modelObject);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      world.camera.controls.fitToSphere(sphere, true);
    }
  }

  // Helper: Clear active model
  function clearActiveModel() {
    if (activeModel) {
      const modelObject = activeModel.object || activeModel;
      world.scene.three.remove(modelObject);
      try {
        if (fragments.disposeGroup) {
          fragments.disposeGroup(activeModel);
        } else if (fragments.dispose) {
          if (activeModel.uuid) {
            fragments.dispose(activeModel.uuid);
          } else {
            fragments.dispose();
          }
        }
      } catch (e) {
        console.warn("Error disposing model in FragmentsManager:", e);
      }
      activeModel = null;
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

  // Loader function
  async function loadModel(buffer, name, sizeFormatted) {
    showLoader("Loading Model", "Parsing IFC structures...", 30);
    clearActiveModel();

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

      // Fit camera to model
      fitModelToView(model);

      // Apply current wireframe setting
      setWireframe(isWireframe);

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
  function setWireframe(value) {
    isWireframe = value;
    if (activeModel) {
      const modelObject = activeModel.object || activeModel;
      modelObject.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.wireframe = isWireframe);
            } else if (child.material) {
              child.material.wireframe = isWireframe;
            }
          }
        }
      });
    }
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
    const file = event.target.files[0];
    if (!file) return;

    showLoader("Uploading File", `Reading ${file.name}...`, 10);

    const reader = new FileReader();
    reader.onload = async (e) => {
      updateLoader("File loaded, preparing parsing...", 25);
      const data = e.target.result;
      const buffer = new Uint8Array(data);
      await loadModel(buffer, file.name, formatBytes(file.size));
    };
    reader.onerror = () => {
      updateLoader("Failed to read local file.", 0);
      setTimeout(hideLoader, 3000);
    };
    reader.readAsArrayBuffer(file);
  });

  btnResetCamera.addEventListener('click', () => {
    if (activeModel) {
      fitModelToView(activeModel);
    } else {
      world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
    }
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

  // Handle window resizing
  window.addEventListener('resize', () => {
    if (world.renderer && world.renderer.resize) {
      world.renderer.resize();
    }
  });
}

// Start app on load
window.addEventListener('DOMContentLoaded', () => {
  initApp().catch(err => {
    console.error("Failed to initialize the BIM app:", err);
  });
});
