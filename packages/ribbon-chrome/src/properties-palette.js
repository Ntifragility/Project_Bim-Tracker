/**
 * Autodesk Revit-style Lateral Properties Palette
 * Reusable component for displaying and editing element parameters.
 */

export const DEFAULT_CATEGORIES = [
  'Constraints',
  'Dimensions',
  'Electrical / MEP',
  'Identity Data',
  'Phasing'
];

/**
 * Normalizes input element parameters into a Category -> Array of params Map.
 * Supports:
 *   1. parameters: { 'Dimensions': [{ name: 'Width', value: '300 mm' }] }
 *   2. parameters: [{ name: 'Width', value: '300 mm', category: 'Dimensions' }]
 *   3. parameters: { 'Width': '300 mm' }
 */
function normalizeParameters(rawParams, categoryList = DEFAULT_CATEGORIES) {
  const result = new Map();
  for (const cat of categoryList) {
    result.set(cat, []);
  }

  if (!rawParams) {
    return result;
  }

  if (Array.isArray(rawParams)) {
    for (const item of rawParams) {
      const cat = item.category || 'Identity Data';
      if (!result.has(cat)) {
        result.set(cat, []);
      }
      result.get(cat).push({
        name: item.name,
        value: item.value ?? '',
        readonly: Boolean(item.readonly),
        options: Array.isArray(item.options) ? item.options : null,
        type: item.type || 'text'
      });
    }
  } else if (typeof rawParams === 'object') {
    for (const [key, val] of Object.entries(rawParams)) {
      if (Array.isArray(val)) {
        // key is category, val is array of param items
        if (!result.has(key)) {
          result.set(key, []);
        }
        for (const item of val) {
          result.get(key).push({
            name: item.name,
            value: item.value ?? '',
            readonly: Boolean(item.readonly),
            options: Array.isArray(item.options) ? item.options : null,
            type: item.type || 'text'
          });
        }
      } else if (val && typeof val === 'object' && val.name) {
        const cat = val.category || 'Identity Data';
        if (!result.has(cat)) {
          result.set(cat, []);
        }
        result.get(cat).push({
          name: val.name,
          value: val.value ?? '',
          readonly: Boolean(val.readonly),
          options: Array.isArray(val.options) ? val.options : null,
          type: val.type || 'text'
        });
      } else {
        // key is param name, val is value
        const cat = 'Identity Data';
        result.get(cat).push({
          name: key,
          value: val ?? '',
          readonly: false,
          options: null,
          type: 'text'
        });
      }
    }
  }

  return result;
}

/**
 * Creates and mounts a Revit-style Properties Palette in the given container.
 *
 * @param {HTMLElement} container
 * @param {Object} [options]
 * @returns {Object} PropertiesPaletteApi
 */
export function createPropertiesPalette(container, options = {}) {
  if (!container) {
    throw new Error('container element is required');
  }

  const doc = container.ownerDocument || globalThis.document;
  if (!doc) {
    throw new Error('Document context not found');
  }

  container.setAttribute('data-rc-host', '');

  let currentElement = options.initialData || null;
  let pendingChanges = {};
  const categoriesList = options.categories || DEFAULT_CATEGORIES;

  // Root element
  const root = doc.createElement('div');
  root.className = 'rc-properties-palette';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Properties');

  // 1. Title bar: "Properties" with close/dock icon
  const titlebar = doc.createElement('div');
  titlebar.className = 'rc-prop-titlebar';

  const titleText = doc.createElement('div');
  titleText.className = 'rc-prop-title';
  titleText.textContent = options.title || 'Properties';
  titlebar.appendChild(titleText);

  const titleTools = doc.createElement('div');
  titleTools.className = 'rc-prop-tools';

  const dockBtn = doc.createElement('button');
  dockBtn.type = 'button';
  dockBtn.className = 'rc-prop-dock-btn';
  dockBtn.title = 'Dock / Undock';
  dockBtn.setAttribute('aria-label', 'Dock / Undock');
  dockBtn.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="2" width="12" height="12" rx="1"/><line x1="2" y1="5" x2="14" y2="5"/></svg>`;
  titleTools.appendChild(dockBtn);

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'rc-prop-close-btn';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 16 16" stroke="currentColor"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
  closeBtn.addEventListener('click', () => {
    if (typeof options.onClose === 'function') {
      options.onClose();
    }
  });
  titleTools.appendChild(closeBtn);

  titlebar.appendChild(titleTools);
  root.appendChild(titlebar);

  // 2. Type Selector & Filter Row
  const headerSection = doc.createElement('div');
  headerSection.className = 'rc-prop-header';

  // Type Selector container (Family icon + Type select)
  const typeSelectorContainer = doc.createElement('div');
  typeSelectorContainer.className = 'rc-type-selector';

  const typeIcon = doc.createElement('span');
  typeIcon.className = 'rc-type-icon';
  typeIcon.setAttribute('aria-hidden', 'true');
  typeIcon.innerHTML = `<svg class="rc-icon rc-icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
  typeSelectorContainer.appendChild(typeIcon);

  const typeSelect = doc.createElement('select');
  typeSelect.className = 'rc-type-select';
  typeSelect.setAttribute('aria-label', 'Type Selector');
  typeSelect.addEventListener('change', () => {
    const selectedVal = typeSelect.value;
    if (currentElement) {
      currentElement.type = selectedVal;
    }
    if (typeof options.onTypeChange === 'function') {
      options.onTypeChange(selectedVal, currentElement);
    }
  });
  typeSelectorContainer.appendChild(typeSelect);
  headerSection.appendChild(typeSelectorContainer);

  // Filter dropdown ("Element (1)" / "No selection") and "Edit Type" button
  const filterRow = doc.createElement('div');
  filterRow.className = 'rc-prop-filter-row';

  const filterSelect = doc.createElement('select');
  filterSelect.className = 'rc-prop-filter';
  filterSelect.setAttribute('aria-label', 'Filter Elements');
  filterRow.appendChild(filterSelect);

  const editTypeBtn = doc.createElement('button');
  editTypeBtn.type = 'button';
  editTypeBtn.className = 'rc-edit-type-btn';
  editTypeBtn.textContent = 'Edit Type';
  editTypeBtn.disabled = true;
  editTypeBtn.addEventListener('click', () => {
    if (!editTypeBtn.disabled && typeof options.onEditType === 'function') {
      options.onEditType(currentElement);
    }
  });
  filterRow.appendChild(editTypeBtn);

  headerSection.appendChild(filterRow);
  root.appendChild(headerSection);

  // 3. Two-column Parameter Grid
  const gridContainer = doc.createElement('div');
  gridContainer.className = 'rc-param-grid';
  gridContainer.setAttribute('role', 'grid');
  gridContainer.setAttribute('aria-label', 'Parameter Grid');
  root.appendChild(gridContainer);

  // 4. Bottom bar with "[ Apply ]" and "[ Cancel ]" buttons
  const bottomBar = doc.createElement('div');
  bottomBar.className = 'rc-prop-bottom-bar';

  const cancelBtn = doc.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'rc-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.disabled = true;
  bottomBar.appendChild(cancelBtn);

  const applyBtn = doc.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'rc-btn-apply';
  applyBtn.textContent = 'Apply';
  applyBtn.disabled = true;
  bottomBar.appendChild(applyBtn);

  root.appendChild(bottomBar);

  container.appendChild(root);

  // Helper to sync Apply/Cancel enabled state
  function updateButtonsState() {
    const hasChanges = Object.keys(pendingChanges).length > 0;
    applyBtn.disabled = !hasChanges;
    cancelBtn.disabled = !hasChanges;
  }

  // Handle parameter value change from inputs
  function onInputChange(name, newVal, originalVal) {
    if (String(newVal) !== String(originalVal)) {
      pendingChanges[name] = newVal;
    } else {
      delete pendingChanges[name];
    }
    updateButtonsState();
    if (typeof options.onParameterChange === 'function') {
      options.onParameterChange(name, newVal, currentElement);
    }
  }

  applyBtn.addEventListener('click', () => {
    if (applyBtn.disabled) return;
    const committedChanges = { ...pendingChanges };

    // Apply pending changes to currentElement
    if (currentElement && currentElement.parameters) {
      if (Array.isArray(currentElement.parameters)) {
        for (const item of currentElement.parameters) {
          if (committedChanges[item.name] !== undefined) {
            item.value = committedChanges[item.name];
          }
        }
      } else if (typeof currentElement.parameters === 'object') {
        for (const [key, val] of Object.entries(currentElement.parameters)) {
          if (Array.isArray(val)) {
            for (const item of val) {
              if (committedChanges[item.name] !== undefined) {
                item.value = committedChanges[item.name];
              }
            }
          } else if (committedChanges[key] !== undefined) {
            currentElement.parameters[key] = committedChanges[key];
          }
        }
      }
    }

    pendingChanges = {};
    updateButtonsState();

    if (typeof options.onApply === 'function') {
      options.onApply(committedChanges, currentElement);
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (cancelBtn.disabled) return;
    pendingChanges = {};
    updateButtonsState();

    // Re-render parameter grid to revert input values
    renderGrid();

    if (typeof options.onCancel === 'function') {
      options.onCancel(currentElement);
    }
  });

  // Render parameter grid based on currentElement
  function renderGrid() {
    // Clear grid
    gridContainer.replaceChildren();

    const paramMap = normalizeParameters(currentElement ? currentElement.parameters : null, categoriesList);

    for (const [catName, params] of paramMap.entries()) {
      const groupEl = doc.createElement('div');
      groupEl.className = 'rc-param-group';
      groupEl.setAttribute('data-category', catName);

      // Category Header button
      const headerBtn = doc.createElement('button');
      headerBtn.type = 'button';
      headerBtn.className = 'rc-param-group-header';
      headerBtn.setAttribute('aria-expanded', 'true');

      const expander = doc.createElement('span');
      expander.className = 'rc-group-expander';
      expander.textContent = '▼';
      headerBtn.appendChild(expander);

      const titleSpan = doc.createElement('span');
      titleSpan.className = 'rc-group-title';
      titleSpan.textContent = ` ${catName}`;
      headerBtn.appendChild(titleSpan);

      const bodyEl = doc.createElement('div');
      bodyEl.className = 'rc-param-group-body';

      // Toggle collapse on click
      headerBtn.addEventListener('click', () => {
        const isCollapsed = groupEl.classList.contains('rc-collapsed');
        if (isCollapsed) {
          groupEl.classList.remove('rc-collapsed');
          headerBtn.setAttribute('aria-expanded', 'true');
          expander.textContent = '▼';
          bodyEl.style.display = '';
        } else {
          groupEl.classList.add('rc-collapsed');
          headerBtn.setAttribute('aria-expanded', 'false');
          expander.textContent = '▶';
          bodyEl.style.display = 'none';
        }
      });

      groupEl.appendChild(headerBtn);

      // Parameter rows
      if (params.length === 0) {
        // Optional placeholder or empty row
      } else {
        for (const param of params) {
          const rowEl = doc.createElement('div');
          rowEl.className = 'rc-param-row';
          rowEl.setAttribute('data-param-name', param.name);

          // Name column
          const labelCol = doc.createElement('div');
          labelCol.className = 'rc-param-label';
          labelCol.title = param.name;
          labelCol.textContent = param.name;
          rowEl.appendChild(labelCol);

          // Value column
          const valueCol = doc.createElement('div');
          valueCol.className = 'rc-param-value';

          const initialVal = pendingChanges[param.name] !== undefined ? pendingChanges[param.name] : param.value;

          if (param.readonly) {
            const readonlySpan = doc.createElement('span');
            readonlySpan.className = 'rc-param-readonly';
            readonlySpan.title = String(initialVal);
            readonlySpan.textContent = String(initialVal);
            valueCol.appendChild(readonlySpan);
          } else if (param.options && Array.isArray(param.options)) {
            const selectEl = doc.createElement('select');
            selectEl.className = 'rc-param-select';
            selectEl.setAttribute('aria-label', param.name);
            selectEl.setAttribute('data-param-name', param.name);

            for (const opt of param.options) {
              const optVal = typeof opt === 'object' ? opt.value : opt;
              const optText = typeof opt === 'object' ? opt.label : opt;
              const optEl = doc.createElement('option');
              optEl.value = optVal;
              optEl.textContent = optText;
              if (String(optVal) === String(initialVal)) {
                optEl.setAttribute('selected', '');
              }
              selectEl.appendChild(optEl);
            }
            selectEl.value = initialVal;

            selectEl.addEventListener('change', () => {
              onInputChange(param.name, selectEl.value, param.value);
            });
            valueCol.appendChild(selectEl);
          } else {
            const inputEl = doc.createElement('input');
            inputEl.type = param.type === 'number' ? 'number' : 'text';
            inputEl.className = 'rc-param-input';
            inputEl.setAttribute('aria-label', param.name);
            inputEl.setAttribute('data-param-name', param.name);
            inputEl.value = initialVal;

            inputEl.addEventListener('input', () => {
              onInputChange(param.name, inputEl.value, param.value);
            });
            inputEl.addEventListener('change', () => {
              onInputChange(param.name, inputEl.value, param.value);
            });

            valueCol.appendChild(inputEl);
          }

          rowEl.appendChild(valueCol);
          bodyEl.appendChild(rowEl);
        }
      }

      groupEl.appendChild(bodyEl);
      gridContainer.appendChild(groupEl);
    }
  }

  // Update Type selector and Filter dropdown based on currentElement
  function syncHeader() {
    typeSelect.replaceChildren();
    filterSelect.replaceChildren();

    if (!currentElement) {
      editTypeBtn.disabled = true;

      const emptyTypeOpt = doc.createElement('option');
      emptyTypeOpt.value = '';
      emptyTypeOpt.textContent = 'None';
      typeSelect.appendChild(emptyTypeOpt);
      typeSelect.disabled = true;

      const noSelOpt = doc.createElement('option');
      noSelOpt.value = '';
      noSelOpt.textContent = 'No selection';
      filterSelect.appendChild(noSelOpt);
      filterSelect.disabled = true;
      return;
    }

    editTypeBtn.disabled = false;
    typeSelect.disabled = false;
    filterSelect.disabled = false;

    // Populate types
    const types = currentElement.types || (currentElement.type ? [currentElement.type] : []);
    if (types.length === 0 && currentElement.name) {
      types.push(currentElement.name);
    }

    for (const t of types) {
      const typeVal = typeof t === 'object' ? t.id || t.name : t;
      const typeLabel = typeof t === 'object' ? t.name || t.id : t;
      const opt = doc.createElement('option');
      opt.value = typeVal;
      opt.textContent = typeLabel;
      if (currentElement.type && String(typeVal) === String(typeof currentElement.type === 'object' ? currentElement.type.id || currentElement.type.name : currentElement.type)) {
        opt.setAttribute('selected', '');
      }
      typeSelect.appendChild(opt);
    }
    if (currentElement.type) {
      typeSelect.value = typeof currentElement.type === 'object' ? currentElement.type.id || currentElement.type.name : currentElement.type;
    }

    // Populate filter dropdown
    const count = currentElement.count || 1;
    const filterText = currentElement.filterLabel || `${currentElement.family || currentElement.name || 'Element'} (${count})`;
    const filterOpt = doc.createElement('option');
    filterOpt.value = currentElement.id || 'current';
    filterOpt.textContent = filterText;
    filterSelect.appendChild(filterOpt);
  }

  // Initial render
  if (currentElement) {
    syncHeader();
    renderGrid();
  } else {
    syncHeader();
    renderGrid();
  }

  // Public API
  const api = {
    /**
     * Sets element data and rebuilds the palette.
     * @param {Object|null} data
     */
    setElement(data) {
      currentElement = data || null;
      pendingChanges = {};
      updateButtonsState();
      syncHeader();
      renderGrid();
    },

    /**
     * Programmatically updates a parameter value.
     * @param {string} name
     * @param {*} val
     */
    updateParameter(name, val) {
      if (!currentElement) return;

      // Update currentElement parameter
      let found = false;
      if (Array.isArray(currentElement.parameters)) {
        for (const item of currentElement.parameters) {
          if (item.name === name) {
            item.value = val;
            found = true;
            break;
          }
        }
      } else if (typeof currentElement.parameters === 'object') {
        for (const [key, pVal] of Object.entries(currentElement.parameters)) {
          if (Array.isArray(pVal)) {
            for (const item of pVal) {
              if (item.name === name) {
                item.value = val;
                found = true;
                break;
              }
            }
          } else if (key === name) {
            currentElement.parameters[key] = val;
            found = true;
            break;
          }
        }
      }

      delete pendingChanges[name];
      updateButtonsState();

      // Update DOM field directly
      const inputEl = gridContainer.querySelector(`[data-param-name="${name}"] input, [data-param-name="${name}"] select, [data-param-name="${name}"] .rc-param-readonly`);
      if (inputEl) {
        if (inputEl.tagName === 'INPUT' || inputEl.tagName === 'SELECT') {
          inputEl.value = val;
        } else {
          inputEl.textContent = String(val);
          inputEl.title = String(val);
        }
      }
    },

    /**
     * Clears selection and resets to empty state.
     */
    clear() {
      api.setElement(null);
    },

    /**
     * Returns current element data.
     */
    getElement() {
      return currentElement;
    },

    /**
     * Returns current pending modifications.
     */
    getPendingChanges() {
      return { ...pendingChanges };
    },

    /**
     * Root element of the palette.
     */
    root,

    /**
     * Cleans up DOM.
     */
    destroy() {
      root.remove();
    }
  };

  return api;
}
