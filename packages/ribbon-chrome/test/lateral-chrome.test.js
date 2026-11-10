import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMockDom } from './dom-mock.js';
import {
  createPropertiesPalette,
  DEFAULT_CATEGORIES,
  createProjectBrowser,
  getDefaultProjectBrowserTree
} from '../src/index.js';

test('Properties Palette: mounting and initial empty state', () => {
  const { doc } = setupMockDom();
  const container = doc.createElement('div');

  // Throws if container missing
  assert.throws(() => createPropertiesPalette(null), /container element is required/);

  const palette = createPropertiesPalette(container);
  assert.ok(palette);
  assert.equal(container.getAttribute('data-rc-host'), '');

  const root = container.querySelector('.rc-properties-palette');
  assert.ok(root);

  // Title bar
  const title = root.querySelector('.rc-prop-title');
  assert.equal(title.textContent, 'Properties');
  assert.ok(root.querySelector('.rc-prop-dock-btn'));
  assert.ok(root.querySelector('.rc-prop-close-btn'));

  // Type selector
  const typeSelect = root.querySelector('.rc-type-select');
  assert.ok(typeSelect);
  assert.equal(typeSelect.disabled, true);

  // Filter dropdown
  const filterSelect = root.querySelector('.rc-prop-filter');
  assert.ok(filterSelect);
  assert.equal(filterSelect.textContent, 'No selection');

  // Edit Type button
  const editTypeBtn = root.querySelector('.rc-edit-type-btn');
  assert.ok(editTypeBtn);
  assert.equal(editTypeBtn.disabled, true);

  // Parameter grid has default categories
  const groups = root.querySelectorAll('.rc-param-group');
  assert.equal(groups.length, DEFAULT_CATEGORIES.length);

  // Apply and Cancel buttons disabled
  const applyBtn = root.querySelector('.rc-btn-apply');
  const cancelBtn = root.querySelector('.rc-btn-cancel');
  assert.ok(applyBtn);
  assert.ok(cancelBtn);
  assert.equal(applyBtn.disabled, true);
  assert.equal(cancelBtn.disabled, true);

  palette.destroy();
});

test('Properties Palette: setElement, category collapse, and type selector change', () => {
  const { doc } = setupMockDom();
  const container = doc.createElement('div');

  let typeChangedTo = null;
  let editTypeCalled = false;

  const palette = createPropertiesPalette(container, {
    onTypeChange(newType) {
      typeChangedTo = newType;
    },
    onEditType() {
      editTypeCalled = true;
    }
  });

  const sampleElement = {
    id: 'ct-101',
    name: 'Ladder Cable Tray 300x100',
    family: 'Cable Tray',
    type: 'Ladder 300x100',
    types: ['Ladder 300x100', 'Ladder 450x100', 'Channel 150x50'],
    parameters: {
      'Constraints': [
        { name: 'Reference Level', value: 'Level 1', readonly: true },
        { name: 'Offset', value: '3000 mm' }
      ],
      'Dimensions': [
        { name: 'Width', value: '300 mm' },
        { name: 'Height', value: '100 mm' }
      ],
      'Electrical / MEP': [
        { name: 'Service Type', value: 'Power', options: ['Power', 'Data', 'Control'] }
      ],
      'Identity Data': [
        { name: 'Comments', value: '' }
      ],
      'Phasing': [
        { name: 'Phase Created', value: 'New Construction' }
      ]
    }
  };

  palette.setElement(sampleElement);

  const root = container.querySelector('.rc-properties-palette');

  // Type selector has options and selected value
  const typeSelect = root.querySelector('.rc-type-select');
  assert.equal(typeSelect.disabled, false);
  assert.equal(typeSelect.value, 'Ladder 300x100');

  // Trigger type selector change
  typeSelect.value = 'Ladder 450x100';
  typeSelect.dispatchEvent({ type: 'change' });
  assert.equal(typeChangedTo, 'Ladder 450x100');

  // Edit Type button is enabled and triggers callback
  const editTypeBtn = root.querySelector('.rc-edit-type-btn');
  assert.equal(editTypeBtn.disabled, false);
  editTypeBtn.click();
  assert.equal(editTypeCalled, true);

  // Category collapse test: Dimensions
  const dimGroup = root.querySelector('[data-category="Dimensions"]');
  assert.ok(dimGroup);
  const dimHeader = dimGroup.querySelector('.rc-param-group-header');
  const dimExpander = dimGroup.querySelector('.rc-group-expander');
  const dimBody = dimGroup.querySelector('.rc-param-group-body');

  assert.equal(dimGroup.classList.contains('rc-collapsed'), false);
  assert.equal(dimExpander.textContent, '▼');

  // Click header to collapse
  dimHeader.click();
  assert.equal(dimGroup.classList.contains('rc-collapsed'), true);
  assert.equal(dimExpander.textContent, '▶');
  assert.equal(dimBody.style.display, 'none');

  // Click header to expand
  dimHeader.click();
  assert.equal(dimGroup.classList.contains('rc-collapsed'), false);
  assert.equal(dimExpander.textContent, '▼');
  assert.equal(dimBody.style.display, '');

  palette.destroy();
});

test('Properties Palette: parameter modification, cancel, and apply flows', () => {
  const { doc } = setupMockDom();
  const container = doc.createElement('div');

  let appliedChanges = null;
  let cancelCalled = false;
  let paramChanged = null;

  const palette = createPropertiesPalette(container, {
    onApply(changes) {
      appliedChanges = changes;
    },
    onCancel() {
      cancelCalled = true;
    },
    onParameterChange(name, val) {
      paramChanged = { name, val };
    }
  });

  const sampleElement = {
    id: 'ct-102',
    name: 'Cable Tray',
    parameters: {
      'Dimensions': [
        { name: 'Width', value: '300 mm' },
        { name: 'Length', value: '2500 mm', readonly: true }
      ]
    }
  };

  palette.setElement(sampleElement);

  const root = container.querySelector('.rc-properties-palette');
  const applyBtn = root.querySelector('.rc-btn-apply');
  const cancelBtn = root.querySelector('.rc-btn-cancel');

  assert.equal(applyBtn.disabled, true);
  assert.equal(cancelBtn.disabled, true);

  // Readonly parameter check
  const readonlyEl = root.querySelector('[data-param-name="Length"] .rc-param-readonly');
  assert.ok(readonlyEl);
  assert.equal(readonlyEl.textContent, '2500 mm');

  // Editable parameter modification
  const widthInput = root.querySelector('[data-param-name="Width"] input');
  assert.ok(widthInput);
  assert.equal(widthInput.value, '300 mm');

  // User types new value
  widthInput.value = '450 mm';
  widthInput.dispatchEvent({ type: 'input' });

  assert.deepEqual(paramChanged, { name: 'Width', val: '450 mm' });
  assert.equal(applyBtn.disabled, false);
  assert.equal(cancelBtn.disabled, false);
  assert.deepEqual(palette.getPendingChanges(), { 'Width': '450 mm' });

  // Click Cancel: resets input back to 300 mm
  cancelBtn.click();
  assert.equal(cancelCalled, true);
  assert.equal(applyBtn.disabled, true);
  assert.equal(cancelBtn.disabled, true);
  assert.deepEqual(palette.getPendingChanges(), {});

  const restoredWidthInput = root.querySelector('[data-param-name="Width"] input');
  assert.equal(restoredWidthInput.value, '300 mm');

  // User modifies again and clicks Apply
  restoredWidthInput.value = '600 mm';
  restoredWidthInput.dispatchEvent({ type: 'input' });
  assert.equal(applyBtn.disabled, false);

  applyBtn.click();
  assert.deepEqual(appliedChanges, { 'Width': '600 mm' });
  assert.equal(applyBtn.disabled, true);
  assert.equal(cancelBtn.disabled, true);

  // Programmatic updateParameter
  palette.updateParameter('Width', '750 mm');
  const updatedWidthInput = root.querySelector('[data-param-name="Width"] input');
  assert.equal(updatedWidthInput.value, '750 mm');

  // Clear palette
  palette.clear();
  assert.equal(palette.getElement(), null);
  const filterSelect = root.querySelector('.rc-prop-filter');
  assert.equal(filterSelect.textContent, 'No selection');

  palette.destroy();
});

test('Project Browser: mounting and titlebar', () => {
  const { doc } = setupMockDom();
  const container = doc.createElement('div');

  assert.throws(() => createProjectBrowser(null), /container element is required/);

  const browser = createProjectBrowser(container, {
    activeModel: 'BIM_Project_01.rvt'
  });
  assert.ok(browser);
  assert.equal(container.getAttribute('data-rc-host'), '');

  const root = container.querySelector('.rc-project-browser');
  assert.ok(root);

  // Title bar
  const title = root.querySelector('.rc-browser-title');
  assert.equal(title.textContent, 'Project Browser - [BIM_Project_01.rvt]');

  browser.setActiveModel('NewModel.ifc');
  assert.equal(title.textContent, 'Project Browser - [NewModel.ifc]');

  // Search input
  const searchInput = root.querySelector('.rc-browser-search-input');
  assert.ok(searchInput);
  assert.equal(searchInput.placeholder, 'Search...');

  browser.destroy();
});

test('Project Browser: default tree categories and expanders', () => {
  const { doc } = setupMockDom();
  const container = doc.createElement('div');

  let toggledNode = null;
  let toggledState = null;

  const browser = createProjectBrowser(container, {
    onNodeToggle(node, expanded) {
      toggledNode = node;
      toggledState = expanded;
    }
  });

  const root = container.querySelector('.rc-project-browser');

  // Check the 4 default categories exist
  const viewsNode = root.querySelector('[data-node-id="views"]');
  const schedulesNode = root.querySelector('[data-node-id="schedules"]');
  const familiesNode = root.querySelector('[data-node-id="families"]');
  const linksNode = root.querySelector('[data-node-id="links"]');

  assert.ok(viewsNode);
  assert.ok(schedulesNode);
  assert.ok(familiesNode);
  assert.ok(linksNode);

  // Views has 3D Views, Plans, Sections
  assert.ok(root.querySelector('[data-node-id="views-3d"]'));
  assert.ok(root.querySelector('[data-node-id="views-plans"]'));
  assert.ok(root.querySelector('[data-node-id="views-sections"]'));

  // Schedules has Takeoffs, Tag mappings
  assert.ok(root.querySelector('[data-node-id="sch-takeoffs"]'));
  assert.ok(root.querySelector('[data-node-id="sch-tag-mappings"]'));

  // Families has Cable Trays, Conduits
  assert.ok(root.querySelector('[data-node-id="fam-cable-trays"]'));
  assert.ok(root.querySelector('[data-node-id="fam-conduits"]'));

  // Links has loaded models with visibility eye toggles
  const archLinkNode = root.querySelector('[data-node-id="link-arch"]');
  assert.ok(archLinkNode);
  const visBtn = archLinkNode.querySelector('.rc-tree-visibility-btn');
  assert.ok(visBtn);

  // Expander toggling on Views
  const viewsExpander = viewsNode.querySelector('.rc-tree-expander');
  assert.equal(viewsExpander.textContent, '▼');

  // Click to collapse
  viewsExpander.click();
  assert.equal(viewsExpander.textContent, '▶');
  assert.equal(toggledNode.id, 'views');
  assert.equal(toggledState, false);

  // Click to expand again
  viewsExpander.click();
  assert.equal(viewsExpander.textContent, '▼');
  assert.equal(toggledState, true);

  browser.destroy();
});

test('Project Browser: node selection, visibility toggle, and search filtering', () => {
  const { doc } = setupMockDom();
  const container = doc.createElement('div');

  let selectedNode = null;
  let visToggled = null;

  const browser = createProjectBrowser(container, {
    onNodeSelect(node) {
      selectedNode = node;
    },
    onVisibilityToggle(node, visible) {
      visToggled = { id: node.id, visible };
    }
  });

  const root = container.querySelector('.rc-project-browser');

  // 1. Programmatic selectNode
  const planNode = browser.selectNode('view-plan-l1');
  assert.ok(planNode);
  assert.equal(selectedNode.id, 'view-plan-l1');

  const selectedEl = root.querySelector('.rc-tree-node.rc-selected');
  assert.ok(selectedEl);
  assert.equal(selectedEl.getAttribute('data-node-id'), 'view-plan-l1');

  // 2. Click node row to select
  const takeoffRow = root.querySelector('[data-node-id="sch-takeoffs"]');
  assert.ok(takeoffRow);
  takeoffRow.click();
  assert.equal(selectedNode.id, 'sch-takeoffs');

  // 3. Link visibility toggle
  const linkRow = root.querySelector('[data-node-id="link-arch"]');
  const visBtn = linkRow.querySelector('.rc-tree-visibility-btn');
  assert.ok(visBtn);
  visBtn.click();
  assert.deepEqual(visToggled, { id: 'link-arch', visible: false });

  // 4. Search filtering
  browser.filter('Takeoffs');
  // Matching item is rendered
  assert.ok(root.querySelector('[data-node-id="sch-takeoffs"]'));
  // Non-matching categories or items excluded
  assert.equal(root.querySelector('[data-node-id="views"]'), null);

  // Clear search restores all
  browser.filter('');
  assert.ok(root.querySelector('[data-node-id="views"]'));

  browser.destroy();
});
