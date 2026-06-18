import './style.css';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import * as XLSX from 'xlsx';
import { initExcelBridge } from './viewer-socket.js';

// Global variables for active model and state
let activeModel = null;
let isWireframe = false;
let excelData = [];
let excelColumns = [];
let selectedExcelIdColumn = "";

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

  // 7. Set up Highlighter
  const highlighter = components.get(OBF.Highlighter);
  highlighter.setup({ world });
  highlighter.add('select', { color: new THREE.Color('#6366f1'), opacity: 0.6 });

  // Bidirectional highlighting: 3D Selection -> Excel Selection
  highlighter.events.select.onHighlight.add((fragmentMap) => {
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
    
    if (selectedExpressId !== null && selectedExcelIdColumn) {
      const rows = excelTableBody.querySelectorAll('tr');
      let foundRow = null;
      rows.forEach(tr => {
        tr.classList.remove('active');
        if (Number(tr.dataset.expressId) === Number(selectedExpressId)) {
          foundRow = tr;
        }
      });
      
      if (foundRow) {
        foundRow.classList.add('active');
        foundRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });

  highlighter.events.select.onClear.add(() => {
    excelTableBody.querySelectorAll('tr').forEach(tr => tr.classList.remove('active'));
  });

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

  // Helper: Zoom to a specific Express ID inside activeModel
  async function zoomToElement(expressId) {
    if (!activeModel) return;
    try {
      const bboxer = components.get(OBC.BoundingBoxer);
      bboxer.list.clear();
      await bboxer.addFromModelIdMap({ [activeModel.uuid]: new Set([Number(expressId)]) });
      const box = bboxer.get();
      if (box && !box.isEmpty()) {
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius < 0.5) sphere.radius = 1.0;
        world.camera.controls.fitToSphere(sphere, true);
      }
      bboxer.list.clear();
    } catch (e) {
      console.warn("zoomToElement failed:", e);
    }
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
          if (!isNaN(expressId) && activeModel) {
            const selectedFragmentMap = activeModel.getFragmentMap([expressId]);
            await highlighter.highlightByID("select", selectedFragmentMap, true);
            zoomToElement(expressId);
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
