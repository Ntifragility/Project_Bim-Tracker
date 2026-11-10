// Autodesk Revit Lateral Dock integration for Cable Tray Viewer.
//
// Mounts and manages:
// 1. Revit Properties Palette (upper pane)
// 2. Revit Project Browser (lower pane)
// 3. Views switching ({3D View}, Top View, Front View, Right View)
// 4. Schedules / Quantities (Tag Mapping Register, Continuity Diagnostics)
// 5. Revit / IFC Links with visibility eye toggles
// 6. Dock tabs ([Split], [Properties], [Project Browser]) & Resizer

import { createPropertiesPalette, createProjectBrowser } from 'ribbon-chrome';

/**
 * Builds the hierarchical Project Browser tree based on app context.
 *
 * @param {object} ctx
 * @returns {Array} Tree nodes
 */
export function buildProjectBrowserTree(ctx) {
  const modelLinks = (ctx.loadedModels || []).map((entry, idx) => ({
    id: `link-${entry.uuid || idx}`,
    modelUuid: entry.uuid,
    label: entry.name,
    type: 'link',
    hasVisibility: true,
    visible: entry.visible !== false,
  }));

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
            { id: 'view-3d', label: '{3D View}', type: 'view' },
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
        { id: 'sch-tag-mapping', label: 'Tag Mapping Register', type: 'schedule' },
        { id: 'sch-continuity', label: 'Continuity Diagnostics', type: 'schedule' },
      ],
    },
    {
      id: 'links',
      label: 'Revit / IFC Links',
      type: 'category',
      expanded: true,
      children: modelLinks.length > 0 ? modelLinks : [
        { id: 'link-empty', label: 'No models loaded', type: 'info', disabled: true },
      ],
    },
  ];
}

/**
 * Handles camera view changes for {3D View}, Top View, Front View, Right View.
 */
function handleViewSelection(viewId, ctx) {
  const controls = ctx.world?.camera?.controls;
  if (!controls) return;

  let center = { x: 0, y: 2, z: 0 };
  let dist = 20;

  if (ctx.loadedModels && ctx.loadedModels.length > 0) {
    const visibleEntries = ctx.loadedModels.filter((m) => m.visible);
    if (visibleEntries.length > 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let hasValid = false;
      for (const entry of visibleEntries) {
        const box = entry.model?.box;
        if (box && !box.isEmpty()) {
          minX = Math.min(minX, box.min.x);
          minY = Math.min(minY, box.min.y);
          minZ = Math.min(minZ, box.min.z);
          maxX = Math.max(maxX, box.max.x);
          maxY = Math.max(maxY, box.max.y);
          maxZ = Math.max(maxZ, box.max.z);
          hasValid = true;
        }
      }
      if (hasValid) {
        center = {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          z: (minZ + maxZ) / 2,
        };
        const spanX = maxX - minX;
        const spanY = maxY - minY;
        const spanZ = maxZ - minZ;
        dist = Math.max(spanX, spanY, spanZ, 10) * 1.5;
      }
    }
  }

  switch (viewId) {
    case 'view-3d':
      controls.setLookAt(center.x + dist * 0.8, center.y + dist * 0.8, center.z + dist * 0.8, center.x, center.y, center.z, true);
      break;
    case 'view-top':
      controls.setLookAt(center.x, center.y + dist * 1.6, center.z, center.x, center.y, center.z, true);
      break;
    case 'view-front':
      controls.setLookAt(center.x, center.y, center.z + dist * 1.6, center.x, center.y, center.z, true);
      break;
    case 'view-right':
      controls.setLookAt(center.x + dist * 1.6, center.y, center.z, center.x, center.y, center.z, true);
      break;
  }
}

/**
 * Handles Schedule opening from the Project Browser.
 */
function openSchedulePanel(scheduleId, api, dom) {
  if (scheduleId === 'sch-tag-mapping') {
    if (dom.excelPanel) {
      dom.excelPanel.hidden = false;
      dom.excelPanel.classList.remove('collapsed');
      if (typeof api.renderExcelTable === 'function') {
        api.renderExcelTable();
      }
    }
  } else if (scheduleId === 'sch-continuity') {
    if (typeof api.checkTraySystemContinuity === 'function') {
      api.checkTraySystemContinuity();
    } else if (dom.btnManagerCheckContinuity) {
      dom.btnManagerCheckContinuity.click();
    }
    if (dom.traySystemContinuityPanel) {
      dom.traySystemContinuityPanel.hidden = false;
    }
  }
}

/**
 * Handles visibility eye toggle for loaded IFC models in Project Browser.
 */
function handleVisibilityToggle(node, visible, ctx, api) {
  if (!node.modelUuid) return;
  const entry = (ctx.loadedModels || []).find((m) => m.uuid === node.modelUuid);
  if (!entry) return;

  entry.visible = visible;
  const modelObject = entry.model?.object || entry.model;
  if (modelObject) {
    modelObject.visible = visible;
  }
  if (typeof api.refreshLoadedModelsList === 'function') {
    api.refreshLoadedModelsList();
  }
}

/**
 * Sets up vertical resizer between Properties Palette and Project Browser.
 */
function setupDockResizer(resizerEl, propsPane) {
  if (!resizerEl || !propsPane) return;

  let isDragging = false;
  let startY = 0;
  let startPropsHeight = 0;

  resizerEl.addEventListener('mousedown', (e) => {
    isDragging = true;
    startY = e.clientY;
    startPropsHeight = propsPane.getBoundingClientRect().height;
    document.body.style.cursor = 'row-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaY = e.clientY - startY;
    const newPropsHeight = Math.max(120, startPropsHeight + deltaY);
    propsPane.style.flex = `0 0 ${newPropsHeight}px`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
    }
  });
}

/**
 * Sets up bottom dock navigation tabs: [Split], [Properties], [Project Browser].
 */
function setupDockTabs(sidebarEl, propsPane) {
  const btnBoth = document.getElementById('btn-dock-tab-both');
  const btnProps = document.getElementById('btn-dock-tab-properties');
  const btnBrowser = document.getElementById('btn-dock-tab-browser');

  const tabs = [btnBoth, btnProps, btnBrowser].filter(Boolean);

  function setMode(mode) {
    if (!sidebarEl) return;
    sidebarEl.dataset.dockMode = mode;
    tabs.forEach((tab) => {
      const isActive = tab.id.endsWith(mode);
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
    if (propsPane) propsPane.style.flex = '';
  }

  btnBoth?.addEventListener('click', () => setMode('both'));
  btnProps?.addEventListener('click', () => setMode('properties'));
  btnBrowser?.addEventListener('click', () => setMode('browser'));
}

/**
 * Initializes Revit Lateral Dock: Properties Palette and Project Browser.
 *
 * @param {object} ctx
 * @param {object} dom
 * @param {object} api
 * @returns {object} { propertiesPalette, projectBrowser }
 */
export function initLateralDock(ctx, dom, api) {
  const propsPane = document.getElementById('dock-properties-pane');
  const browserPane = document.getElementById('dock-browser-pane');
  const resizer = document.getElementById('dock-resizer');
  const sidebar = document.getElementById('sidebar');

  if (!propsPane || !browserPane) {
    console.warn('[Lateral Dock] Dock panes not found in DOM.');
    return null;
  }

  // 1. Properties Palette
  const propertiesPalette = createPropertiesPalette(propsPane, {
    title: 'Properties',
    categories: ['Constraints', 'Dimensions', 'Electrical', 'Identity Data'],
    onTypeChange(newType, element) {
      console.log('[Properties] Type changed to:', newType, element);
    },
    onEditType(element) {
      console.log('[Properties] Edit Type for:', element);
    },
    onApply(pendingChanges, element) {
      console.log('[Properties] Applying changes:', pendingChanges, element);
      if (typeof api.stagePropertyChange === 'function' && element?.id) {
        for (const [key, val] of Object.entries(pendingChanges)) {
          api.stagePropertyChange('BIM_TRACKER_EDIT', key, val);
        }
      }
    },
    onCancel(element) {
      console.log('[Properties] Cancelled changes for:', element);
    },
  });

  // 2. Project Browser
  const activeModelName = ctx.activeModel?.name || ctx.loadedModels?.[0]?.name || 'Active Model';
  const projectBrowser = createProjectBrowser(browserPane, {
    activeModel: activeModelName,
    treeData: buildProjectBrowserTree(ctx),
    onNodeSelect(node) {
      if (node.id.startsWith('view-')) {
        handleViewSelection(node.id, ctx);
      } else if (node.id.startsWith('sch-')) {
        openSchedulePanel(node.id, api, dom);
      } else if (node.type === 'link' && node.modelUuid) {
        const entry = (ctx.loadedModels || []).find((m) => m.uuid === node.modelUuid);
        if (entry) {
          ctx.activeModel = entry.model;
          if (typeof api.fitModelToView === 'function') {
            api.fitModelToView(entry.model);
          }
        }
      }
    },
    onVisibilityToggle(node, visible) {
      handleVisibilityToggle(node, visible, ctx, api);
    },
  });

  // 3. Resizer and Tabs
  setupDockResizer(resizer, propsPane);
  setupDockTabs(sidebar, propsPane);

  // 4. Register on api
  api.propertiesPalette = propertiesPalette;
  api.projectBrowser = projectBrowser;
  api.updateProjectBrowser = () => {
    const currentActive = ctx.activeModel?.name || ctx.loadedModels?.[0]?.name || 'Active Model';
    projectBrowser.setActiveModel(currentActive);
    projectBrowser.setTreeData(buildProjectBrowserTree(ctx));
  };
  api.openSchedulePanel = (id) => openSchedulePanel(id, api, dom);

  return { propertiesPalette, projectBrowser };
}
