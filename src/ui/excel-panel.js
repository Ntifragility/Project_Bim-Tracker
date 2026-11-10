// Excel linkage panel for the tray viewer.
//
// Owns the workbook import, column mapping, tag-table render (with column
// resize), row→model navigation, and the dimension lookup used by the
// mapping export. Extracted verbatim from `src/main.js` (behaviour unchanged
// per R1); assignment lookups arrive through the shared `api` object.

import { readWorkbook } from 'excel-io';
import { formatBytes } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initExcelPanel(ctx, dom, api) {
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
    const modelEntry = ctx.loadedModels.find((entry) =>
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
        if (value !== undefined && value !== null && value !== '') return api.formatPropValue(value);
      }
      return '';
    };
    return {
      Width: pick('width', 'overallwidth', 'traywidth', 'nominalwidth'),
      Height: pick('height', 'overallheight', 'trayheight', 'nominalheight'),
      Length: pick('length', 'overalllength', 'traylength', 'segmentlength'),
    };
  }

  function updateExcelNavigationUi() {
    const hasExcelRows = ctx.excelData.length > 0;
    dom.excelOnlyFields.forEach((field) => {
      field.hidden = !hasExcelRows;
      field.style.display = hasExcelRows ? '' : 'none';
    });
  }

  function getExcelColumnKey(columnName) {
    return String(columnName || '');
  }

  function getDefaultExcelColumnWidth(columnName) {
    if (columnName === ctx.excelColumnKey) return 135;
    if (api.isComponentIdColumn(columnName)) return 240;
    const labelWidth = String(columnName || '').length * 9 + 48;
    return Math.max(ctx.defaultExcelColumnWidth, Math.min(labelWidth, 220));
  }

  function getExcelColumnWidth(columnName) {
    const key = getExcelColumnKey(columnName);
    return ctx.excelColumnWidths.get(key) || getDefaultExcelColumnWidth(columnName);
  }

  function setExcelColumnWidth(columnName, width) {
    const key = getExcelColumnKey(columnName);
    ctx.excelColumnWidths.set(key, Math.max(ctx.minExcelColumnWidth, Math.round(width)));
  }

  function applyExcelColumnWidths(columns) {
    if (!dom.excelTableColgroup) return;
    const totalWidth = columns.reduce((sum, columnName) => sum + getExcelColumnWidth(columnName), 0);
    const visibleWidth = dom.excelDataTable.parentElement?.clientWidth || 0;
    dom.excelDataTable.style.minWidth = `${Math.max(totalWidth, visibleWidth)}px`;

    Array.from(dom.excelTableColgroup.children).forEach((colElement, index) => {
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
    if (dom.excelTableColgroup) dom.excelTableColgroup.innerHTML = '';
    dom.excelTableHeader.innerHTML = '';
    dom.excelTableBody.innerHTML = '';

    if (ctx.excelData.length === 0) {
      dom.excelDataTable.style.display = 'none';
      dom.excelDataTable.style.minWidth = '';
      dom.excelPanel.querySelector('.excel-placeholder').style.display = 'block';
      return;
    }

    dom.excelPanel.querySelector('.excel-placeholder').style.display = 'none';
    dom.excelDataTable.style.display = 'table';

    const tableColumns = [...ctx.excelColumns, ctx.excelColumnKey];
    if (dom.excelTableColgroup) {
      tableColumns.forEach((columnName) => {
        const col = document.createElement('col');
        col.style.width = `${getExcelColumnWidth(columnName)}px`;
        dom.excelTableColgroup.appendChild(col);
      });
      applyExcelColumnWidths(tableColumns);
    }

    // Create header row
    ctx.excelColumns.forEach((col) => {
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
      dom.excelTableHeader.appendChild(th);
    });
    const assignmentHeader = document.createElement('th');
    assignmentHeader.dataset.column = ctx.excelColumnKey;
    const assignmentLabel = document.createElement('span');
    assignmentLabel.className = 'excel-column-label';
    assignmentLabel.innerText = 'Assignment';
    const assignmentResizeHandle = document.createElement('span');
    assignmentResizeHandle.className = 'excel-column-resizer';
    assignmentResizeHandle.setAttribute('aria-hidden', 'true');
    assignmentResizeHandle.addEventListener('pointerdown', (event) => startExcelColumnResize(event, ctx.excelColumnKey, tableColumns));
    assignmentHeader.append(assignmentLabel, assignmentResizeHandle);
    dom.excelTableHeader.appendChild(assignmentHeader);

    // Create table body rows
    const searchTerm = dom.excelSearch.value.toLowerCase().trim();

    ctx.excelData.forEach((row, index) => {
      if (searchTerm) {
        const rowMatch = Object.values(row).some((val) =>
          String(val).toLowerCase().includes(searchTerm)
        );
        if (!rowMatch) return;
      }

      const tr = document.createElement('tr');
      tr.dataset.index = index;
      if (ctx.selectedExcelRowIndex === index) tr.classList.add('active');

      const rowTag = ctx.selectedExcelIdColumn ? String(row[ctx.selectedExcelIdColumn] ?? '').trim() : '';
      const componentMatch = api.isComponentIdColumn() ? api.findComponentById(rowTag) : null;
      const rowMembers = componentMatch ? [componentMatch] : api.isSystemTagColumn() ? api.findSystemMembers(rowTag) : [];
      const rowAssignment = rowMembers[0] || null;
      if (rowMembers.length) tr.classList.add('assigned');

      ctx.excelColumns.forEach((col) => {
        const td = document.createElement('td');
        td.innerText = row[col] !== undefined ? row[col] : '';
        td.title = td.innerText;
        tr.appendChild(td);
      });

      const statusCell = document.createElement('td');
      statusCell.className = 'assignment-cell';
      statusCell.textContent = rowMembers.length
        ? `Assigned ${rowMembers.length} element${rowMembers.length === 1 ? '' : 's'}`
        : 'Unassigned';
      statusCell.title = rowMembers.length
        ? api.isComponentIdColumn()
          ? `Component ${rowAssignment.componentId} matches IFC element #${rowAssignment.localId}.`
          : `${rowMembers.length} IFC element${rowMembers.length === 1 ? '' : 's'} belong to this tray system.`
        : 'This Excel identifier has not been matched.';
      tr.appendChild(statusCell);

      tr.addEventListener('click', async () => {
        dom.excelTableBody.querySelectorAll('tr').forEach((r) => r.classList.remove('active'));
        tr.classList.add('active');
        ctx.selectedExcelRowIndex = index;
        if (rowAssignment?.systemTag) dom.systemTagInput.value = rowAssignment.systemTag;
        else if (rowTag && api.isSystemTagColumn()) dom.systemTagInput.value = rowTag;
        api.updateTagAssignmentUi();

        if (rowMembers.length) {
          const modelEntry = ctx.loadedModels.find((entry) =>
            entry.model?.modelId === rowAssignment.modelId || entry.model?.uuid === rowAssignment.modelId
          );
          if (!modelEntry) {
            api.updateTagAssignmentUi(`Warning: the model for system “${rowTag}” is not loaded.`, 'warning');
            return;
          }

          if (!modelEntry.visible) {
            modelEntry.visible = true;
            const modelObject = modelEntry.model.object || modelEntry.model;
            if (modelObject) modelObject.visible = true;
            api.refreshLoadedModelsList();
          }

          ctx.highlighter.isProgrammaticSelect = true;
          try {
            const fragmentMap = {};
            for (const member of rowMembers) {
              if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
              fragmentMap[member.modelId].add(Number(member.localId));
            }
            await ctx.highlighter.highlightByID('select', fragmentMap, true, true);
            ctx.currentSelectionMap = api.cloneModelIdMap(fragmentMap);
            ctx.activeModel = modelEntry.model;
            await api.displayElementProperties(modelEntry.model, rowAssignment.localId, modelEntry.name);
            ctx.selectedIfcElement = await api.readElementIdentity(modelEntry.model, rowAssignment.localId, modelEntry.name);
            ctx.routingController.setSelectedElement(modelEntry.model, rowAssignment.localId);
            api.updateTagAssignmentUi(
              api.isComponentIdColumn()
                ? `Highlighted component “${rowAssignment.componentId}” (element #${rowAssignment.localId}).`
                : `Highlighted ${rowMembers.length} elements for tray system “${rowTag}”.`,
            );
          } catch (error) {
            console.warn('[Excel Linkage] Assigned element highlight failed:', error);
            api.updateTagAssignmentUi(`Warning: element #${rowAssignment.localId} could not be highlighted.`, 'warning');
          } finally {
            ctx.highlighter.isProgrammaticSelect = false;
          }
        }
      });

      dom.excelTableBody.appendChild(tr);
    });
  }

  function wireExcelControls() {
    // Excel Upload Interactions
    dom.btnUploadExcel.addEventListener('click', () => {
      dom.excelFileInput.click();
    });

    dom.excelFileInput.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      dom.excelFileName.innerText = file.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = readWorkbook(data);
          const jsonData = workbook.readSheet();

          if (jsonData.length > 0) {
            ctx.excelColumns = Object.keys(jsonData[0]);
            ctx.excelData = jsonData;
            ctx.selectedExcelRowIndex = null;

            dom.excelIdColumn.innerHTML = '<option value="">(Select tag column)</option>';
            let systemTagColumn = '';
            let componentIdColumn = '';
            ctx.excelColumns.forEach((col) => {
              const option = document.createElement('option');
              option.value = col;
              option.innerText = col;
              dom.excelIdColumn.appendChild(option);

              if (api.isComponentIdColumn(col)) componentIdColumn = col;
              else if (api.isSystemTagColumn(col)) systemTagColumn = col;
            });
            const preselectedCol = componentIdColumn || systemTagColumn;
            if (preselectedCol) {
              dom.excelIdColumn.value = preselectedCol;
              ctx.selectedExcelIdColumn = preselectedCol;
            } else {
              ctx.selectedExcelIdColumn = '';
            }

            renderExcelTable();
            api.refreshValidationReportIfOpen();
            api.updateTagAssignmentUi('Excel tag list loaded. Select a row and an IFC element.');

            // Show the excel panel
            dom.excelPanel.classList.remove('collapsed');
            const toggleSpan = dom.btnExcelPanelClose.querySelector('span');
            if (toggleSpan) {
              toggleSpan.innerText = '▶';
            }

            if (ctx.world.renderer && ctx.world.renderer.resize) {
              ctx.world.renderer.resize();
            }
          } else {
            alert('The Excel file is empty.');
          }
        } catch (err) {
          console.error('Error parsing Excel file:', err);
          alert(`Failed to parse Excel file: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    });

    dom.excelIdColumn.addEventListener('change', () => {
      ctx.selectedExcelIdColumn = dom.excelIdColumn.value;
      renderExcelTable();
      api.refreshValidationReportIfOpen();
      api.updateTagAssignmentUi();
    });

    dom.excelSearch.addEventListener('input', () => {
      renderExcelTable();
    });

    // Toggle Excel Drawer Collapse
    if (dom.btnExcelPanelClose && dom.excelPanel) {
      dom.btnExcelPanelClose.addEventListener('click', () => {
        dom.excelPanel.classList.toggle('collapsed');

        const isCollapsed = dom.excelPanel.classList.contains('collapsed');
        const toggleSpan = dom.btnExcelPanelClose.querySelector('span');
        if (toggleSpan) {
          toggleSpan.innerText = isCollapsed ? '◀' : '▶';
        }

        if (ctx.world.renderer && ctx.world.renderer.resize) {
          ctx.world.renderer.resize();
        }
      });
    }
  }

  api.renderExcelTable = renderExcelTable;
  api.updateExcelNavigationUi = updateExcelNavigationUi;
  api.readElementDimensions = readElementDimensions;

  return {
    renderExcelTable,
    updateExcelNavigationUi,
    readElementDimensions,
    wireExcelControls,
  };
}
