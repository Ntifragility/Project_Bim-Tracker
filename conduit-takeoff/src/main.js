// Conduit Takeoff Viewer — Main Application
// Connects the COVILLAF 3D engine with conduit-core logic, drawing tools, and UI panels.

import './style.css';
import * as THREE from 'three';
import { createCovillafEngine } from '@covillaf/engine.js';
import {
  createNetwork,
  createCommandStack,
  createDiameterRegistry,
  createMarkerStore,
  computeTakeoff,
  computeRunTakeoff,
  deleteRun,
  serializeProject,
  deserializeProject,
  computeSha256,
  verifySourceHash,
  exportCompleteCsv,
  exportOverlayIfc,
  formatFileSize,
  formatLength,
  convertLength,
  analyzeRunBends,
  nodeById,
} from '@conduit-core';
import { createDrawingTool } from './drawing-tool.js';
import { createMepHud } from './mep-hud.js';

// Application State
const appState = {
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

// UI Elements
const els = {
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

function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showLoading(stage, percent = 0, detail = '') {
  els.loadingOverlay.hidden = false;
  els.loadingStage.textContent = stage;
  els.loadingBarFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  els.loadingDetail.textContent = detail;
}

function hideLoading() {
  els.loadingOverlay.hidden = true;
}

function updateUndoRedoButtons(drawingToolRef) {
  const tool = drawingToolRef || window.__drawingTool;
  const canUndo = Boolean((tool?.activePoints?.length > 0) || appState.commandStack.canUndo());
  els.btnUndo.disabled = !canUndo;
  els.btnRedo.disabled = !appState.commandStack.canRedo();
}

function renderDiameterPicker() {
  const diameters = appState.diameterRegistry.getAll();
  const selected = appState.diameterRegistry.getSelected();

  // Sync top options bar select
  if (els.topDiameterSelect) {
    els.topDiameterSelect.innerHTML = '';
    for (const d of diameters) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.label} (${d.mm}mm)`;
      if (selected?.id === d.id) opt.selected = true;
      els.topDiameterSelect.appendChild(opt);
    }
  }

  els.diameterList.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'diameter-grid';

  for (const d of diameters) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `diameter-pill ${selected?.id === d.id ? 'selected' : ''}`;
    pill.innerHTML = `
      <span class="diameter-color-swatch" style="background: ${d.color}; color: ${d.color}"></span>
      <span>${d.label}</span>
    `;
    pill.addEventListener('click', () => {
      appState.diameterRegistry.setSelected(d.id);
      renderDiameterPicker();
      els.statusText.textContent = `Selected conduit diameter: ${d.label}`;
    });
    grid.appendChild(pill);
  }

  els.diameterList.appendChild(grid);
}

function renderRunsList(drawingTool) {
  const runs = Object.values(appState.network.runs);
  els.runsCountBadge.textContent = runs.length;

  if (runs.length === 0) {
    els.runList.innerHTML = '<p class="text-muted">No runs drawn yet. Click on the 3D model to begin tracing.</p>';
    els.btnSave.disabled = true;
    els.btnExportCsv.disabled = true;
    els.btnExportIfc.disabled = true;
    return;
  }

  els.btnSave.disabled = false;
  els.btnExportCsv.disabled = false;
  els.btnExportIfc.disabled = false;
  els.runList.innerHTML = '';

  for (const run of runs) {
    const takeoff = computeRunTakeoff(appState.network, run.id);
    const color = appState.diameterRegistry.getColor(run.size);
    const isSelected = appState.selectedRunId === run.id;

    const runNodes = (run.nodeIds || []).map((nid) => nodeById(appState.network, nid)).filter(Boolean);
    const bendAnalysis = analyzeRunBends(runNodes);

    const card = document.createElement('div');
    card.className = `run-item-card ${isSelected ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="run-item-header">
        <span class="run-item-title">
          <span class="diameter-color-swatch" style="background: ${color}; color: ${color}"></span>
          <span>${run.name || `Run ${run.id}`} (${run.size})</span>
        </span>
        <button class="run-item-del-btn" title="Delete run">🗑</button>
      </div>
      <div class="run-item-stats">
        <span>${takeoff ? takeoff.length.toFixed(2) : '0'} m (${takeoff ? (takeoff.length / 0.3048).toFixed(1) : '0'} ft)</span>
        <span>${takeoff ? takeoff.sticks : 0} sticks</span>
        <span class="nec-bend-badge ${bendAnalysis.exceedsNec360 ? 'nec-warning' : 'nec-ok'}" title="${bendAnalysis.warning || 'Compliant with NEC 360° bend limit'}">
          ${bendAnalysis.totalDegrees}° bends
        </span>
      </div>
    `;

    // Click to select
    card.addEventListener('click', (e) => {
      if (e.target.closest('.run-item-del-btn')) return;
      appState.selectedRunId = isSelected ? null : run.id;
      drawingTool.selectedRunId = appState.selectedRunId;
      drawingTool.renderRuns(appState.network);
      renderRunsList(drawingTool);
    });

    // Delete run
    const delBtn = card.querySelector('.run-item-del-btn');
    delBtn.addEventListener('click', () => {
      const prevNet = appState.network;
      const nextNet = deleteRun(prevNet, run.id);

      const deleteCmd = {
        description: `Delete ${run.name || run.id}`,
        execute() {
          appState.network = nextNet;
          if (appState.selectedRunId === run.id) appState.selectedRunId = null;
          drawingTool.renderRuns(appState.network);
          renderRunsList(drawingTool);
          renderSummary();
        },
        undo() {
          appState.network = prevNet;
          drawingTool.renderRuns(appState.network);
          renderRunsList(drawingTool);
          renderSummary();
        },
      };

      appState.commandStack.execute(deleteCmd);
    });

    els.runList.appendChild(card);
  }
}

function renderSummary() {
  const takeoff = computeTakeoff(appState.network);
  const bySize = takeoff.bySize || [];
  const totals = takeoff.totals || { runs: 0, length: 0, sticks: 0 };

  const wastePct = appState.settings.wasteFactor;
  const unit = appState.settings.unit;

  if (bySize.length === 0) {
    els.summaryTableContainer.innerHTML = '<p class="text-muted">Draw runs to see the summary.</p>';
    return;
  }

  let totalBaseLen = 0;
  let totalOrderLen = 0;

  let rowsHtml = '';
  for (const item of bySize) {
    const baseLen = convertLength(item.length, 'METRE', unit);
    const orderLen = baseLen * (1 + wastePct);
    totalBaseLen += baseLen;
    totalOrderLen += orderLen;

    const color = appState.diameterRegistry.getColor(item.size);

    rowsHtml += `
      <tr>
        <td>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span class="diameter-color-swatch" style="background:${color}; color:${color}"></span>
            <strong>${item.size}</strong>
          </span>
        </td>
        <td style="text-align:right;">${item.runs}</td>
        <td style="text-align:right;">${baseLen.toFixed(2)}</td>
        <td style="text-align:right;">${orderLen.toFixed(2)}</td>
        <td style="text-align:right; font-weight:700; color:var(--accent);">${item.sticks}</td>
      </tr>
    `;
  }

  els.summaryTableContainer.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Size</th>
          <th style="text-align:right;">Runs</th>
          <th style="text-align:right;">Base (${unit === 'FOOT' ? 'ft' : 'm'})</th>
          <th style="text-align:right;">Order</th>
          <th style="text-align:right;">Sticks</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      <tfoot>
        <tr>
          <td>TOTAL</td>
          <td style="text-align:right;">${totals.runs}</td>
          <td style="text-align:right;">${totalBaseLen.toFixed(2)}</td>
          <td style="text-align:right;">${totalOrderLen.toFixed(2)}</td>
          <td style="text-align:right; font-size:1rem;">${totals.sticks}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

async function init() {
  console.log('[Conduit Takeoff] Initializing engine...');
  const engine = await createCovillafEngine(els.viewerContainer, { enableHighlighting: false });
  if (engine.highlighter) {
    engine.highlighter.enabled = false;
  }

  // Navisworks / BIM Standard Navigation Controls:
  const controls = engine.world?.camera?.controls;
  if (controls) {
    controls.dollyToCursor = true; // Zoom to cursor position
    controls.mouseButtons.left = controls.constructor.ACTION.ROTATE; // Left-drag orbits without dropping points
    controls.mouseButtons.middle = controls.constructor.ACTION.TRUCK; // Middle-drag pans (Truck)
    controls.mouseButtons.right = controls.constructor.ACTION.ROTATE; // Right-drag orbits (Navisworks / BIM standard)
  }

  let mepHud = null;
  const drawingTool = createDrawingTool({
    engine,
    commandStack: appState.commandStack,
    diameterRegistry: appState.diameterRegistry,
    onStateChange: (state) => {
      if (state.elevationPicked !== undefined) {
        if (els.topElevationInput) {
          els.topElevationInput.value = state.elevationPicked.toFixed(2);
        }
        if (els.btnPickElevation) {
          els.btnPickElevation.classList.remove('active');
        }
        els.statusText.textContent = `Sampled elevation from model: ${state.elevationPicked.toFixed(2)} m`;
      }

      if (state.cursor) {
        els.cursorCoords.textContent = `X: ${state.cursor.x.toFixed(2)}  Y: ${state.cursor.y.toFixed(2)}  Z: ${state.cursor.z.toFixed(2)}${state.snapped ? ' (SNAP)' : ''}`;
      }

      if (state.activePoints && state.activePoints.length > 0) {
        // Automatically switch to draw tab if still on model tab
        const activeTab = document.querySelector('.tab-nav-btn.active');
        if (activeTab && activeTab.dataset.tabTarget === 'model') {
          document.querySelector('[data-tab-target="draw"]')?.click();
        }

        els.activeRunInfo.hidden = false;
        els.activeRunActions.hidden = false;
        els.verticalStepControls.hidden = false;
        if (els.topActiveRunSummary) els.topActiveRunSummary.hidden = false;

        // Compute running distance
        let runningDist = 0;
        for (let i = 1; i < state.activePoints.length; i++) {
          const p1 = state.activePoints[i - 1];
          const p2 = state.activePoints[i];
          runningDist += Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
        }
        runningDist += state.liveSegment || 0;

        const sticks = Math.ceil(runningDist / appState.settings.stickLengthM) || 0;
        els.runLength.textContent = `${runningDist.toFixed(2)} m`;
        els.runSticks.textContent = `${sticks}`;
        els.runSegments.textContent = `${Math.max(1, state.activePoints.length)}`;

        if (els.topRunLength) els.topRunLength.textContent = `${runningDist.toFixed(2)} m`;
        if (els.topRunSticks) els.topRunSticks.textContent = `${sticks}`;

        if (state.isVertical) {
          els.statusText.textContent = `⊥ Perpendicular to XY (Vertical riser): Height Δ = ${(state.liveSegment || 0).toFixed(2)} m`;
        }

        // Live floating Revit MEP HUD
        if (mepHud && state.screenPos) {
          const lastPt = state.activePoints[state.activePoints.length - 1];
          const targetPt = state.cursor;
          let angleDeg = 0;
          if (targetPt && lastPt) {
            const dx = targetPt.x - lastPt.x;
            const dz = targetPt.z - lastPt.z;
            angleDeg = ((Math.atan2(dz, dx) * 180 / Math.PI) + 360) % 360;
          }
          mepHud.update({
            screenX: state.screenPos.x,
            screenY: state.screenPos.y,
            lengthM: state.liveSegment || 0,
            angleDeg,
            isAngleSnapped: !!state.isVertical || (angleDeg % 45 < 2 || angleDeg % 45 > 43),
            elevationM: drawingTool.activeElevation,
            visible: true,
          });
        }
      } else {
        mepHud?.hide();
        els.activeRunInfo.hidden = true;
        els.activeRunActions.hidden = true;
        els.verticalStepControls.hidden = true;
        if (els.topActiveRunSummary) els.topActiveRunSummary.hidden = true;
      }

      updateUndoRedoButtons(drawingTool);

      if (state.networkUpdated) {
        renderRunsList(drawingTool);
        renderSummary();
      }
    },
  });

  mepHud = createMepHud({
    container: els.viewerContainer,
    onCommitDistance: (distM) => {
      drawingTool.commitDistance(distM);
    },
  });

  window.__drawingTool = drawingTool;
  drawingTool.attach(els.viewerContainer);

  // Update undo/redo state listeners
  appState.commandStack.subscribe(() => {
    updateUndoRedoButtons();
    renderRunsList(drawingTool);
    renderSummary();
  });

  // Sidebar Tabs Navigation
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tabTarget;
      els.tabs.forEach((t) => {
        const isSelected = t === tab;
        t.classList.toggle('active', isSelected);
        t.setAttribute('aria-selected', isSelected);
      });
      els.panels.forEach((p) => {
        p.classList.toggle('active', p.dataset.sidebarPanel === target);
      });
    });
  });

  // Sidebar Toggle
  els.sidebarToggle.addEventListener('click', () => {
    els.sidebar.classList.toggle('collapsed');
  });

  function detectIfcSchema(buf) {
    try {
      const headerChunk = new TextDecoder().decode(new Uint8Array(buf.slice(0, 4096)));
      const match = headerChunk.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
      if (match && match[1]) return match[1].toUpperCase();
    } catch {}
    return 'IFC4';
  }

  function fitCameraToModel(model) {
    if (!model || !engine.world?.camera?.controls) return;
    const modelObject = model.object || model;
    const storedBox = model.box;
    const box = storedBox && !storedBox.isEmpty()
      ? storedBox
      : new THREE.Box3().setFromObject(modelObject);

    if (box && !box.isEmpty()) {
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) sphere.radius = 1;
      engine.world.camera.controls.fitToSphere(sphere, true);
    } else {
      engine.world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
    }
  }

  let activeLoadedModel = null;

  // IFC File Loading
  els.btnOpenIfc.addEventListener('click', () => els.fileInput.click());

  els.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      showLoading('Reading IFC file…', 10, file.name);
      const buffer = await file.arrayBuffer();

      showLoading('Calculating SHA-256 integrity hash…', 30);
      const sha256 = await computeSha256(buffer);
      const schema = detectIfcSchema(buffer);

      showLoading('Parsing IFC geometry in Web Worker…', 50);
      const model = await engine.loadIfc(new Uint8Array(buffer), file.name, (progress) => {
        showLoading('Loading fragments…', 50 + progress * 0.45);
      });

      if (!model) {
        throw new Error('Parsed IFC model is empty or invalid.');
      }

      activeLoadedModel = model;
      const modelObject = model.object || model;
      if (modelObject && !engine.world.scene.three.children.includes(modelObject)) {
        engine.world.scene.three.add(modelObject);
      }

      // Safely fit camera to model
      fitCameraToModel(model);

      // Update state
      appState.sourceModel.name = file.name;
      appState.sourceModel.size = file.size;
      appState.sourceModel.sha256 = sha256;
      appState.sourceModel.schema = schema;
      appState.sourceModel.buffer = buffer;

      // Populate UI
      els.modelInfo.hidden = false;
      els.modelName.textContent = file.name;
      els.modelSize.textContent = formatFileSize(file.size);
      els.modelUnit.textContent = appState.sourceModel.unit;
      els.modelSchema.textContent = appState.sourceModel.schema;

      els.statusText.textContent = `Loaded ${file.name} successfully. Ready for tracing.`;
      hideLoading();

      // Automatically switch to Draw tab
      document.querySelector('[data-tab-target="draw"]')?.click();
    } catch (err) {
      console.error('[Conduit Takeoff] Error loading IFC:', err);
      hideLoading();
      alert(`Failed to load IFC file: ${err.message}`);
    }
  });

  // Camera Controls
  els.btnFitView.addEventListener('click', () => {
    if (activeLoadedModel) {
      fitCameraToModel(activeLoadedModel);
    } else {
      engine.world?.camera?.controls?.setLookAt(12, 12, 12, 0, 2, 0, true);
    }
  });

  els.btnViewTop.addEventListener('click', () => {
    engine.world?.camera?.controls?.setLookAt(0, 30, 0, 0, 0, 0, true);
  });

  els.btnViewFront.addEventListener('click', () => {
    engine.world?.camera?.controls?.setLookAt(0, 2, 30, 0, 2, 0, true);
  });

  els.btnViewRight.addEventListener('click', () => {
    engine.world?.camera?.controls?.setLookAt(30, 2, 0, 0, 2, 0, true);
  });

  // Drawing Toolbar Actions
  els.btnDrawMode.addEventListener('click', () => {
    drawingTool.isDrawingMode = !drawingTool.isDrawingMode;
    els.btnDrawMode.classList.toggle('active', drawingTool.isDrawingMode);
    els.statusText.textContent = drawingTool.isDrawingMode
      ? 'Drawing mode active: click model to trace runs'
      : 'Drawing paused: navigate camera';
  });

  els.btnOrtho.addEventListener('click', () => {
    drawingTool.isOrthoActive = !drawingTool.isOrthoActive;
    els.btnOrtho.classList.toggle('active', drawingTool.isOrthoActive);
  });

  els.btnPerp.addEventListener('click', () => {
    drawingTool.isPerpendicularActive = !drawingTool.isPerpendicularActive;
    els.btnPerp.classList.toggle('active', drawingTool.isPerpendicularActive);
    els.statusText.textContent = drawingTool.isPerpendicularActive
      ? '⊥ Perpendicular to XY lock active: moving cursor draws vertical riser'
      : 'Perpendicular lock released';
  });

  els.btnAddVertUp.addEventListener('click', () => {
    const step = Math.abs(Number(els.inputVerticalLen.value) || 2.0);
    const added = drawingTool.addVerticalStep(step);
    if (added) {
      if (els.topElevationInput) els.topElevationInput.value = drawingTool.activeElevation.toFixed(2);
      els.statusText.textContent = `Added vertical riser +${step} m straight UP (Elevation: ${drawingTool.activeElevation.toFixed(2)} m)`;
    }
  });

  els.btnAddVertDown.addEventListener('click', () => {
    const step = Math.abs(Number(els.inputVerticalLen.value) || 2.0);
    const added = drawingTool.addVerticalStep(-step);
    if (added) {
      if (els.topElevationInput) els.topElevationInput.value = drawingTool.activeElevation.toFixed(2);
      els.statusText.textContent = `Added vertical riser -${step} m straight DOWN (Elevation: ${drawingTool.activeElevation.toFixed(2)} m)`;
    }
  });

  // Revit-Style Top Options Bar Controls
  if (els.topDiameterSelect) {
    els.topDiameterSelect.addEventListener('change', (e) => {
      appState.diameterRegistry.setSelected(e.target.value);
      renderDiameterPicker();
      const sel = appState.diameterRegistry.getSelected();
      els.statusText.textContent = `Selected conduit diameter: ${sel?.label || e.target.value}`;
    });
  }

  if (els.topElevationInput) {
    els.topElevationInput.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      if (!Number.isNaN(val)) {
        drawingTool.activeElevation = val;
        els.statusText.textContent = `Active Middle Elevation set to: ${val.toFixed(2)} m`;
      }
    });
  }

  if (els.btnPickElevation) {
    els.btnPickElevation.addEventListener('click', () => {
      drawingTool.isPickElevationActive = !drawingTool.isPickElevationActive;
      els.btnPickElevation.classList.toggle('active', drawingTool.isPickElevationActive);
      els.statusText.textContent = drawingTool.isPickElevationActive
        ? 'Sampling elevation: click any element in the 3D model to set offset'
        : 'Elevation eyedropper cancelled';
    });
  }

  if (els.btnToggleWorkplane) {
    els.btnToggleWorkplane.addEventListener('click', () => {
      drawingTool.workPlaneVisible = !drawingTool.workPlaneVisible;
      els.btnToggleWorkplane.classList.toggle('active', drawingTool.workPlaneVisible);
      els.statusText.textContent = drawingTool.workPlaneVisible
        ? 'Grid workplane helper visible'
        : 'Grid workplane hidden';
    });
  }

  if (els.btnToggleAutoriser) {
    els.btnToggleAutoriser.addEventListener('click', () => {
      drawingTool.autoRiserEnabled = !drawingTool.autoRiserEnabled;
      els.btnToggleAutoriser.classList.toggle('active', drawingTool.autoRiserEnabled);
      els.btnToggleAutoriser.textContent = drawingTool.autoRiserEnabled ? '⚡ Auto-Riser: ON' : '⚡ Auto-Riser: OFF';
      els.statusText.textContent = drawingTool.autoRiserEnabled
        ? 'Revit Auto-Riser enabled: changing elevation mid-run will generate vertical risers'
        : 'Auto-Riser disabled';
    });
  }

  if (els.topBtnFinish) {
    els.topBtnFinish.addEventListener('click', () => {
      const system = els.topSystemSelect?.value || 'Power';
      drawingTool.finishCurrentRun(() => appState.network, (n) => { appState.network = n; }, system);
    });
  }

  if (els.topBtnCancel) {
    els.topBtnCancel.addEventListener('click', () => {
      drawingTool.cancelCurrentRun();
    });
  }

  els.btnUndo.addEventListener('click', () => {
    if (drawingTool.activePoints.length > 0) {
      drawingTool.undoLastPoint();
      updateUndoRedoButtons(drawingTool);
    } else if (appState.commandStack.canUndo()) {
      appState.commandStack.undo();
    }
  });

  els.btnRedo.addEventListener('click', () => {
    if (appState.commandStack.canRedo()) {
      appState.commandStack.redo();
    }
  });

  els.btnFinishRun.addEventListener('click', () => {
    const system = els.topSystemSelect?.value || 'Power';
    drawingTool.finishCurrentRun(() => appState.network, (n) => { appState.network = n; }, system);
  });

  els.btnCancelRun.addEventListener('click', () => {
    drawingTool.cancelCurrentRun();
  });

  // Waste factor input change
  els.wasteFactorInput.addEventListener('input', (e) => {
    const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    appState.settings.wasteFactor = val / 100;
    renderSummary();
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    if (e.key === 'Shift') {
      drawingTool.isOrthoActive = true;
      els.btnOrtho.classList.add('active');
      if (controls) {
        controls.mouseButtons.middle = controls.constructor.ACTION.ROTATE;
      }
    } else if ((e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'z') && !e.ctrlKey) {
      drawingTool.isPerpendicularActive = !drawingTool.isPerpendicularActive;
      els.btnPerp.classList.toggle('active', drawingTool.isPerpendicularActive);
      els.statusText.textContent = drawingTool.isPerpendicularActive
        ? '⊥ Perpendicular to XY lock active (Vertical riser)'
        : 'Perpendicular lock released';
    } else if (e.key === 'Backspace' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
      if (drawingTool.activePoints.length > 0) {
        drawingTool.undoLastPoint();
        updateUndoRedoButtons(drawingTool);
      }
    } else if (e.key === 'Enter') {
      const system = els.topSystemSelect?.value || 'Power';
      drawingTool.finishCurrentRun(() => appState.network, (n) => { appState.network = n; }, system);
    } else if (e.key === 'Escape') {
      drawingTool.cancelCurrentRun();
      updateUndoRedoButtons(drawingTool);
    } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        if (appState.commandStack.canRedo()) appState.commandStack.redo();
      } else {
        if (drawingTool.activePoints.length > 0) {
          drawingTool.undoLastPoint();
          updateUndoRedoButtons(drawingTool);
        } else if (appState.commandStack.canUndo()) {
          appState.commandStack.undo();
        }
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (appState.commandStack.canRedo()) appState.commandStack.redo();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      drawingTool.isOrthoActive = false;
      els.btnOrtho.classList.remove('active');
      if (controls) {
        controls.mouseButtons.middle = controls.constructor.ACTION.TRUCK;
      }
    }
  });

  // Persistence: Save Project (.conduit.json)
  els.btnSave.addEventListener('click', () => {
    const json = serializeProject({
      network: appState.network,
      markers: appState.markerStore.getAll(),
      diameters: appState.diameterRegistry.getAll(),
      sourceModel: appState.sourceModel,
      settings: appState.settings,
    });
    const filename = `${appState.sourceModel.name || 'project'}.conduit.json`;
    downloadFile(json, filename, 'application/json');
    els.statusText.textContent = `Saved project to ${filename}`;
  });

  // Persistence: Load Project (.conduit.json)
  els.btnLoadProject.addEventListener('click', () => els.projectFileInput.click());

  els.projectFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const proj = deserializeProject(text);

      // Verify SHA-256 hash against current loaded model if one is open
      if (appState.sourceModel.buffer && proj.sourceModel?.sha256) {
        const matches = await verifySourceHash(appState.sourceModel.buffer, proj.sourceModel.sha256);
        if (!matches) {
          alert('⚠️ Warning: The source IFC file hash does not match the file this project was created with!');
        }
      }

      // Restore project network and settings
      appState.network = createNetwork();
      if (Array.isArray(proj.network?.nodes)) {
        appState.network.nodes = [...proj.network.nodes];
      } else if (proj.network?.nodes && typeof proj.network.nodes === 'object') {
        appState.network.nodes = Object.values(proj.network.nodes);
      }

      if (Array.isArray(proj.network?.runs)) {
        appState.network.runs = [...proj.network.runs];
      } else if (proj.network?.runs && typeof proj.network.runs === 'object') {
        appState.network.runs = Object.values(proj.network.runs);
      }

      appState.settings = { ...appState.settings, ...proj.settings };
      els.wasteFactorInput.value = Math.round(appState.settings.wasteFactor * 100);

      drawingTool.renderRuns(appState.network);
      renderRunsList(drawingTool);
      renderSummary();

      els.statusText.textContent = `Opened project ${file.name} successfully.`;
    } catch (err) {
      console.error('[Conduit Takeoff] Error reading project file:', err);
      alert(`Could not load project: ${err.message}`);
    }
  });

  // Export CSV
  els.btnExportCsv.addEventListener('click', () => {
    const takeoff = computeTakeoff(appState.network);

    const csvContent = exportCompleteCsv({
      runs: takeoff.runs,
      summary: takeoff.bySize,
      markers: appState.markerStore.getAll(),
      unit: appState.settings.unit,
      wasteFactor: appState.settings.wasteFactor,
    });

    const filename = `${appState.sourceModel.name || 'conduit'}_takeoff.csv`;
    downloadFile(csvContent, filename, 'text/csv');
    els.statusText.textContent = `Exported takeoff CSV to ${filename}`;
  });

  // Export Overlay IFC
  els.btnExportIfc.addEventListener('click', () => {
    const ifcContent = exportOverlayIfc({
      runs: appState.network.runs,
      nodes: appState.network.nodes,
      schema: appState.sourceModel.schema || 'IFC4',
      projectName: `${appState.sourceModel.name || 'Project'} Conduit Overlay`,
    });

    const filename = `${appState.sourceModel.name || 'conduit'}_overlay.ifc`;
    downloadFile(ifcContent, filename, 'application/x-step');
    els.statusText.textContent = `Exported overlay IFC to ${filename}`;
  });

  // Initial renders
  renderDiameterPicker();
  renderRunsList(drawingTool);
  renderSummary();
  updateUndoRedoButtons();
  console.log('[Conduit Takeoff] App initialized and ready.');
}

window.addEventListener('DOMContentLoaded', init);
