// conduit-takeoff/src/ui/lateral-dock.js — Revit Lateral Dock coordinator.
//
// Mounts Autodesk Revit-style Properties Palette and Project Browser
// inside the left lateral dock (#sidebar), providing type selection,
// collapsible parameter inspection/editing (Constraints, Dimensions,
// Takeoff/BOM, Identity Data), view navigation, schedule views, and IFC links.

import { createPropertiesPalette, createProjectBrowser } from 'ribbon-chrome';
import { getNecBendRadiusM, analyzeRunBends, NEC_CONDUIT_ARTICLES, STANDARD_BEND_ANGLES } from '@conduit-core';

/**
 * Creates and mounts the Revit lateral dock components.
 *
 * @param {object} param0
 * @param {object} param0.state Conduit application state
 * @param {object} param0.els DOM elements map
 * @param {object} param0.api Cross-module coordination API
 * @returns {object} Lateral dock API
 */
export function createLateralDock({ state, els, api }) {
  const backend = state.backend;

  // Containers
  const propertiesContainer = document.getElementById('dock-properties-container');
  const browserContainer = document.getElementById('dock-browser-container');
  const schedulesContainer = document.getElementById('dock-schedules-container');

  // Bottom dock tabs
  const tabProperties = document.getElementById('tab-dock-properties');
  const tabBrowser = document.getElementById('tab-dock-browser');
  const tabSchedules = document.getElementById('tab-dock-schedules');

  // Schedule sub-tabs
  const btnSchedRuns = document.getElementById('btn-sched-runs');
  const btnSchedBom = document.getElementById('btn-sched-bom');
  const schedRunsView = document.getElementById('rc-sched-runs-view');
  const schedBomView = document.getElementById('rc-sched-bom-view');

  let activeDockTab = 'properties';

  function switchDockTab(tabId) {
    activeDockTab = tabId;

    if (tabProperties) {
      const isProps = tabId === 'properties';
      tabProperties.classList.toggle('active', isProps);
      tabProperties.setAttribute('aria-selected', String(isProps));
    }
    if (tabBrowser) {
      const isBrowser = tabId === 'browser';
      tabBrowser.classList.toggle('active', isBrowser);
      tabBrowser.setAttribute('aria-selected', String(isBrowser));
    }
    if (tabSchedules) {
      const isSched = tabId === 'schedules';
      tabSchedules.classList.toggle('active', isSched);
      tabSchedules.setAttribute('aria-selected', String(isSched));
    }

    if (propertiesContainer) {
      propertiesContainer.style.display = tabId === 'properties' ? 'flex' : 'none';
    }
    if (browserContainer) {
      browserContainer.style.display = tabId === 'browser' ? 'flex' : 'none';
    }
    if (schedulesContainer) {
      schedulesContainer.style.display = tabId === 'schedules' ? 'flex' : 'none';
    }
  }

  tabProperties?.addEventListener('click', () => switchDockTab('properties'));
  tabBrowser?.addEventListener('click', () => switchDockTab('browser'));
  tabSchedules?.addEventListener('click', () => switchDockTab('schedules'));

  btnSchedRuns?.addEventListener('click', () => {
    btnSchedRuns.classList.add('active');
    btnSchedBom?.classList.remove('active');
    if (schedRunsView) schedRunsView.style.display = 'block';
    if (schedBomView) schedBomView.style.display = 'none';
  });

  btnSchedBom?.addEventListener('click', () => {
    btnSchedBom.classList.add('active');
    btnSchedRuns?.classList.remove('active');
    if (schedRunsView) schedRunsView.style.display = 'none';
    if (schedBomView) schedBomView.style.display = 'block';
  });

  // NEC Code Inspector Dialog wiring
  const necDialog = document.getElementById('nec-inspector-dialog');
  const btnNecClose = document.getElementById('nec-dialog-close');
  const btnNecOk = document.getElementById('nec-dialog-ok');
  btnNecClose?.addEventListener('click', () => { if (necDialog) necDialog.hidden = true; });
  btnNecOk?.addEventListener('click', () => { if (necDialog) necDialog.hidden = true; });
  api.openNecDialog = () => { if (necDialog) necDialog.hidden = false; };

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Properties Palette
  // ─────────────────────────────────────────────────────────────────────────────
  let palette = null;

  function getTypeOptions() {
    const diameters = state.diameterRegistry.getAll();
    return diameters.map((d) => ({
      id: d.label,
      name: `EMT - ${d.label} (${d.mm} mm)`,
    }));
  }

  function getDrawingTool() {
    return api.drawingTool || (typeof window !== 'undefined' ? window.__drawingTool : null);
  }

  if (propertiesContainer) {
    palette = createPropertiesPalette(propertiesContainer, {
      title: 'Properties',
      categories: ['Constraints', 'Dimensions', 'Takeoff / BOM', 'Identity Data'],
      onTypeChange(selectedTypeVal, currentElement) {
        // Selected trade size e.g. "3/4\"" or type id
        const cleanSize = selectedTypeVal.replace(/^EMT\s*-\s*/, '').split(' ')[0];
        const match = state.diameterRegistry.getAll().find(
          (d) => d.label === cleanSize || d.label === selectedTypeVal || `EMT - ${d.label}` === selectedTypeVal,
        );

        if (match) {
          state.diameterRegistry.setSelected(match.id);
          if (els.topDiameterSelect) els.topDiameterSelect.value = match.id;
          api.renderDiameterPicker?.();
        }

        // If a completed run is selected, update its size
        if (currentElement && currentElement.id && state.network.runs[currentElement.id]) {
          const run = state.network.runs[currentElement.id];
          run.size = match ? match.label : selectedTypeVal;
          const tool = getDrawingTool();
          tool?.renderRuns(state.network);
          api.renderRunsList?.(tool);
          api.renderSummary?.();
        }

        api.refreshRibbon?.();
        updatePropertiesPalette();
      },
      onApply(committedChanges, currentElement) {
        const tool = getDrawingTool();
        const runId = currentElement?.id;
        const run = runId && state.network.runs[runId] ? state.network.runs[runId] : null;

        // 1. Constraints: Reference Elevation
        if (committedChanges['Reference Elevation'] !== undefined) {
          const raw = String(committedChanges['Reference Elevation']).replace(/[^\d.-]/g, '');
          const val = parseFloat(raw);
          if (!Number.isNaN(val) && tool) {
            tool.activeElevation = val;
            if (els.topElevationInput) {
              els.topElevationInput.value = val.toFixed(2);
            }
          }
        }

        // 2. Takeoff / BOM: Waste Factor %
        if (committedChanges['Waste Factor %'] !== undefined) {
          const pct = Math.max(0, Math.min(100, parseFloat(committedChanges['Waste Factor %']) || 0));
          state.settings.wasteFactor = pct / 100;
          if (els.wasteFactorInput) {
            els.wasteFactorInput.value = pct;
          }
          api.renderSummary?.();
        }

        // 3. Identity Data: System Type
        if (committedChanges['System Type'] !== undefined) {
          const sys = committedChanges['System Type'];
          if (run) {
            run.system = sys;
          }
          if (els.topSystemSelect) {
            els.topSystemSelect.value = sys;
          }
        }

        // 4. Identity Data: Comments
        if (committedChanges['Comments'] !== undefined && run) {
          run.comments = committedChanges['Comments'];
        }

        // 5. Dimensions: Trade Size
        if (committedChanges['Trade Size'] !== undefined && run) {
          const sizeVal = committedChanges['Trade Size'];
          run.size = sizeVal;
          const match = state.diameterRegistry.getByLabel(sizeVal);
          if (match) {
            state.diameterRegistry.setSelected(match.id);
            if (els.topDiameterSelect) els.topDiameterSelect.value = match.id;
          }
        }

        if (tool) {
          tool.renderRuns(state.network);
          api.renderRunsList?.(tool);
          api.renderSummary?.();
        }

        api.refreshRibbon?.();
        updatePropertiesPalette();
      },
      onCancel() {
        updatePropertiesPalette();
      },
      onClose() {
        els.sidebar?.classList.add('collapsed');
        document.body.classList.add('sidebar-is-collapsed');
      },
    });
  }

  function updatePropertiesPalette(targetRunId = state.selectedRunId, liveData = null) {
    if (!palette) return;

    const tool = getDrawingTool();
    const allDiameters = state.diameterRegistry.getAll();
    const selectedDiam = state.diameterRegistry.getSelected() || allDiameters[0] || { label: '3/4"', mm: 21 };
    const typeOptions = getTypeOptions();

    if (targetRunId && state.network.runs[targetRunId]) {
      // ── A. Completed Run selected ──
      const run = state.network.runs[targetRunId];
      const takeoff = backend.computeRunTakeoff(state.network, run.id);
      const diam = state.diameterRegistry.getByLabel(run.size) || { label: run.size, mm: 21 };
      const runNodes = (run.nodeIds || []).map((nid) => backend.nodeById(state.network, nid)).filter(Boolean);
      const bendAnalysis = analyzeRunBends(runNodes, run.size);
      const pullBoxes = Math.floor(bendAnalysis.totalDegrees / 360);
      const refElev = runNodes[0]?.z ?? tool?.activeElevation ?? 2.80;
      const lengthM = takeoff ? takeoff.length : 0;
      const sticks = takeoff ? takeoff.sticks : 0;
      const minRadiusM = getNecBendRadiusM(run.size);
      const minRadiusMm = Math.round(minRadiusM * 1000);
      const minRadiusIn = (minRadiusM / 0.0254).toFixed(1);

      const constraintParams = [
        { name: 'Reference Elevation', value: `${refElev.toFixed(2)} m`, type: 'text' },
        { name: 'Workplane state', value: tool?.workPlaneVisible ? 'Active (Grid Visible)' : 'Active (Grid Hidden)', readonly: true },
        { name: 'NEC 358.26 (Bends Limit)', value: `${bendAnalysis.totalDegrees}° / 360° (${bendAnalysis.exceedsNec360 ? 'NON-COMPLIANT' : 'COMPLIANT'})`, readonly: true },
        { name: 'NEC 358.24 (Min Radius)', value: `${minRadiusMm} mm (${minRadiusIn}") [Ch.9 Table 2]`, readonly: true },
        { name: 'NEC 358.30 (Support Spacing)', value: 'Every 10 ft (3.05 m) max', readonly: true },
      ];

      // Add individual field bends to parameter grid for inspection & editing
      (bendAnalysis.bends || []).forEach((b, idx) => {
        constraintParams.push({
          name: `Bend #${idx + 1} Angle`,
          value: `${b.angleDeg}°`,
          options: ['15°', '22.5°', '30°', '45°', '60°', '90°'],
        });
      });

      palette.setElement({
        id: run.id,
        name: run.name || `Run ${run.id}`,
        family: 'Conduit Run',
        count: 1,
        filterLabel: `${run.name || `Run ${run.id}`} (1)`,
        type: run.size,
        types: typeOptions,
        parameters: {
          'Constraints': constraintParams,
          'Dimensions': [
            { name: 'Trade Size', value: run.size, options: allDiameters.map((d) => d.label) },
            { name: 'Outer Diameter', value: `${diam.mm} mm`, readonly: true },
            { name: 'Run Length', value: `${lengthM.toFixed(2)} m (${(lengthM / 0.3048).toFixed(1)} ft)`, readonly: true },
            { name: 'Stick Count', value: `${sticks} (10 ft stocks)`, readonly: true },
            { name: 'Total Field Bends', value: `${bendAnalysis.bends?.length || 0} (${bendAnalysis.totalDegrees}° total)`, readonly: true },
            { name: 'Fabrication Method', value: 'Field-Bent (No bought elbows)', readonly: true },
          ],
          'Takeoff / BOM': [
            { name: 'Waste Factor %', value: `${Math.round(state.settings.wasteFactor * 100)}`, type: 'number' },
            { name: 'Field Bends Count', value: `${bendAnalysis.bends?.length || 0} (${bendAnalysis.totalDegrees}° bends)`, readonly: true },
            { name: 'Pull Boxes Required', value: `${pullBoxes} (${bendAnalysis.exceedsNec360 ? 'Exceeds 360°' : 'Compliant'})`, readonly: true },
            { name: 'Couplings Required', value: `${Math.max(0, sticks - 1)} (to join 10 ft sticks)`, readonly: true },
            { name: 'NEC Standards', value: 'NEC 358.24, 358.26, 314.28, 358.30', readonly: true },
          ],
          'Identity Data': [
            { name: 'Run ID', value: run.id, readonly: true },
            { name: 'System Type', value: run.system || els.topSystemSelect?.value || 'Power', options: ['Power', 'Lighting', 'Controls', 'Fire Alarm', 'Low Voltage'] },
            { name: 'Comments', value: run.comments || '', type: 'text' },
          ],
        },
      });
    } else if (liveData && liveData.points && liveData.points.length > 0) {
      // ── B. In-progress Run being traced ──
      let runningDist = 0;
      for (let i = 1; i < liveData.points.length; i++) {
        const p1 = liveData.points[i - 1];
        const p2 = liveData.points[i];
        runningDist += Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
      }
      runningDist += liveData.liveSegment || 0;
      const sticks = Math.ceil(runningDist / state.settings.stickLengthM) || 0;
      const bendAnalysis = analyzeRunBends(liveData.points, selectedDiam.label);
      const pullBoxes = Math.floor(bendAnalysis.totalDegrees / 360);
      const activeElev = tool?.activeElevation ?? 2.80;
      const minRadiusM = getNecBendRadiusM(selectedDiam.label);
      const minRadiusMm = Math.round(minRadiusM * 1000);
      const minRadiusIn = (minRadiusM / 0.0254).toFixed(1);

      palette.setElement({
        id: 'active-run',
        name: 'Active Run',
        family: 'Conduit Run',
        count: 1,
        filterLabel: 'Active Conduit Run (Tracing)',
        type: selectedDiam.label,
        types: typeOptions,
        parameters: {
          'Constraints': [
            { name: 'Reference Elevation', value: `${activeElev.toFixed(2)} m`, type: 'text' },
            { name: 'Workplane state', value: tool?.workPlaneVisible ? 'Active (Grid Visible)' : 'Active (Grid Hidden)', readonly: true },
            { name: 'NEC 358.26 (Bends Limit)', value: `${bendAnalysis.totalDegrees}° / 360° (${bendAnalysis.exceedsNec360 ? 'NON-COMPLIANT' : 'COMPLIANT'})`, readonly: true },
            { name: 'NEC 358.24 (Min Radius)', value: `${minRadiusMm} mm (${minRadiusIn}") [Ch.9 Table 2]`, readonly: true },
          ],
          'Dimensions': [
            { name: 'Trade Size', value: selectedDiam.label, options: allDiameters.map((d) => d.label) },
            { name: 'Outer Diameter', value: `${selectedDiam.mm} mm`, readonly: true },
            { name: 'Run Length', value: `${runningDist.toFixed(2)} m`, readonly: true },
            { name: 'Stick Count', value: `${sticks} (10 ft stocks)`, readonly: true },
            { name: 'Fabrication', value: 'Field-Bent (Direct on Pipe)', readonly: true },
          ],
          'Takeoff / BOM': [
            { name: 'Waste Factor %', value: `${Math.round(state.settings.wasteFactor * 100)}`, type: 'number' },
            { name: 'Fittings count', value: `${bendAnalysis.bends?.length || 0} (${bendAnalysis.totalDegrees}° bends)`, readonly: true },
            { name: 'Pull Boxes', value: `${pullBoxes} (${bendAnalysis.exceedsNec360 ? 'Exceeds 360°' : 'Compliant'})`, readonly: true },
          ],
          'Identity Data': [
            { name: 'Run ID', value: 'Active Run', readonly: true },
            { name: 'System Type', value: els.topSystemSelect?.value || 'Power', options: ['Power', 'Lighting', 'Controls', 'Fire Alarm', 'Low Voltage'] },
            { name: 'Comments', value: 'In-progress trace', type: 'text' },
          ],
        },
      });
    } else {
      // ── C. Idle state (no selection) ──
      const activeElev = tool?.activeElevation ?? 2.80;
      const minRadiusM = getNecBendRadiusM(selectedDiam.label);
      const minRadiusMm = Math.round(minRadiusM * 1000);
      const minRadiusIn = (minRadiusM / 0.0254).toFixed(1);

      palette.setElement({
        id: 'conduit-system',
        name: 'Conduit System',
        family: 'Conduit System',
        count: 0,
        filterLabel: 'Conduit (No selection)',
        type: selectedDiam.label,
        types: typeOptions,
        parameters: {
          'Constraints': [
            { name: 'Reference Elevation', value: `${activeElev.toFixed(2)} m`, type: 'text' },
            { name: 'Workplane state', value: tool?.workPlaneVisible ? 'Active (Grid Visible)' : 'Active (Grid Hidden)', readonly: true },
            { name: 'NEC Standard Limit', value: '360° max cumulative bends (NEC 358.26)', readonly: true },
            { name: 'NEC Table 2 Radius', value: `${minRadiusMm} mm (${minRadiusIn}") for ${selectedDiam.label}`, readonly: true },
          ],
          'Dimensions': [
            { name: 'Trade Size', value: selectedDiam.label, options: allDiameters.map((d) => d.label) },
            { name: 'Outer Diameter', value: `${selectedDiam.mm} mm`, readonly: true },
            { name: 'Run Length', value: '0.00 m', readonly: true },
            { name: 'Stick Count', value: '0 (10 ft stocks)', readonly: true },
            { name: 'Fabrication', value: 'Field-Bent (No factory elbows)', readonly: true },
          ],
          'Takeoff / BOM': [
            { name: 'Waste Factor %', value: `${Math.round(state.settings.wasteFactor * 100)}`, type: 'number' },
            { name: 'Fittings count', value: '0', readonly: true },
            { name: 'Pull Boxes', value: '0', readonly: true },
          ],
          'Identity Data': [
            { name: 'Run ID', value: 'None', readonly: true },
            { name: 'System Type', value: els.topSystemSelect?.value || 'Power', options: ['Power', 'Lighting', 'Controls', 'Fire Alarm', 'Low Voltage'] },
            { name: 'Comments', value: '', type: 'text' },
          ],
        },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Project Browser
  // ─────────────────────────────────────────────────────────────────────────────
  let browser = null;

  function buildProjectBrowserTree() {
    const hasModel = Boolean(state.sourceModel?.name);
    return [
      {
        id: 'views',
        label: 'Views (all)',
        type: 'category',
        expanded: true,
        children: [
          {
            id: 'views-3d',
            label: '3D Views',
            type: 'folder',
            expanded: true,
            children: [
              { id: 'view-3d-default', label: '{3D}', type: 'view' },
              { id: 'view-top', label: 'Top View', type: 'view' },
              { id: 'view-front', label: 'Front View', type: 'view' },
              { id: 'view-right', label: 'Right View', type: 'view' },
            ],
          },
        ],
      },
      {
        id: 'schedules',
        label: 'Schedules / Quantities',
        type: 'category',
        expanded: true,
        children: [
          { id: 'sch-run-list', label: 'Conduit Run List', type: 'schedule' },
          { id: 'sch-contractor-bom', label: 'Contractor BOM Schedule', type: 'schedule' },
        ],
      },
      {
        id: 'links',
        label: 'Revit / IFC Links',
        type: 'category',
        expanded: true,
        children: hasModel
          ? [
              {
                id: 'link-ifc-model',
                label: state.sourceModel.name,
                type: 'link',
                hasVisibility: true,
                visible: true,
              },
            ]
          : [
              {
                id: 'link-placeholder',
                label: '(No IFC loaded)',
                type: 'link',
                hasVisibility: false,
                visible: false,
              },
            ],
      },
    ];
  }

  if (browserContainer) {
    browser = createProjectBrowser(browserContainer, {
      activeModel: state.sourceModel?.name || 'Active Project',
      tree: buildProjectBrowserTree(),
      onNodeSelect(node) {
        const engine = api.engine || (typeof window !== 'undefined' ? window.__engine : null);
        if (node.id === 'view-3d-default') {
          const model = api.getLoadedModel?.();
          if (model && api.fitCameraToModel) {
            api.fitCameraToModel(model);
          } else {
            engine?.world?.camera?.controls?.setLookAt(12, 12, 12, 0, 2, 0, true);
          }
        } else if (node.id === 'view-top') {
          engine?.world?.camera?.controls?.setLookAt(0, 30, 0, 0, 0, 0, true);
        } else if (node.id === 'view-front') {
          engine?.world?.camera?.controls?.setLookAt(0, 2, 30, 0, 2, 0, true);
        } else if (node.id === 'view-right') {
          engine?.world?.camera?.controls?.setLookAt(30, 2, 0, 0, 2, 0, true);
        } else if (node.id === 'sch-run-list') {
          switchDockTab('schedules');
          btnSchedRuns?.click();
        } else if (node.id === 'sch-contractor-bom') {
          switchDockTab('schedules');
          btnSchedBom?.click();
        }
      },
      onVisibilityToggle(node, isVisible) {
        if (node.id === 'link-ifc-model') {
          const model = api.getLoadedModel?.();
          const obj = model?.object || model;
          if (obj) {
            obj.visible = isVisible;
          }
        }
      },
      onClose() {
        els.sidebar?.classList.add('collapsed');
        document.body.classList.add('sidebar-is-collapsed');
      },
    });
  }

  function updateBrowserTree() {
    if (!browser) return;
    browser.setActiveModel(state.sourceModel?.name || 'Active Project');
    browser.setTreeData(buildProjectBrowserTree());
  }

  // Register on shared API
  api.updatePropertiesPalette = updatePropertiesPalette;
  api.updateProjectBrowserTree = updateBrowserTree;
  api.switchDockTab = switchDockTab;
  api.getActiveDockTab = () => activeDockTab;

  return {
    palette,
    browser,
    switchDockTab,
    updatePropertiesPalette,
    updateBrowserTree,
  };
}
