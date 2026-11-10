// conduit-takeoff/src/ui/draw-toolbar.js — draw-mode toolbar + diameter picker.
//
// Owns (conduit-ui-split module 4): draw-mode/ortho/perp toggles, undo/redo
// wiring, diameter picker render, vertical step controls, active-run info,
// top-bar diameter/elevation/system/workplane/autoriser controls. Registers
// `api.renderDiameterPicker` + `api.updateUndoRedoButtons` on the coordinator.

export function createDrawToolbar({ state, els, api }) {
  function updateUndoRedoButtons(drawingToolRef) {
    const tool = drawingToolRef || window.__drawingTool;
    const canUndo = Boolean((tool?.activePoints?.length > 0) || state.commandStack.canUndo());
    if (els.btnUndo) els.btnUndo.disabled = !canUndo;
    if (els.btnRedo) els.btnRedo.disabled = !state.commandStack.canRedo();
    api.refreshRibbon?.();
  }

  function diameterSwatch(color) {
    const swatch = document.createElement('span');
    swatch.className = 'diameter-color-swatch';
    swatch.style.background = color;
    swatch.style.color = color;
    return swatch;
  }

  function diameterLabel(text) {
    const label = document.createElement('span');
    label.textContent = text;
    return label;
  }

  function renderDiameterPicker() {
    const diameters = state.diameterRegistry.getAll();
    const selected = state.diameterRegistry.getSelected();

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
    const menu = document.createElement('details');
    menu.className = 'diameter-menu';

    const summary = document.createElement('summary');
    summary.append(
      diameterSwatch(selected?.color || '#f59e0b'),
      diameterLabel(selected ? `${selected.label} (${selected.mm} mm)` : 'Select diameter'),
    );
    const caret = document.createElement('span');
    caret.className = 'diameter-menu-caret';
    caret.textContent = '▸';
    summary.append(caret);
    menu.append(summary);

    const list = document.createElement('div');
    list.className = 'diameter-menu-list';
    for (const d of diameters) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `diameter-option ${selected?.id === d.id ? 'selected' : ''}`;
      option.append(diameterSwatch(d.color), diameterLabel(`${d.label} (${d.mm} mm)`));
      option.addEventListener('click', () => {
        state.diameterRegistry.setSelected(d.id);
        renderDiameterPicker();
        els.statusText.textContent = `Selected conduit diameter: ${d.label}`;
      });
      list.append(option);
    }
    menu.append(list);
    els.diameterList.append(menu);
  }

  function wireDrawControls(drawingTool) {
    // Drawing Toolbar Actions
    els.btnDrawMode?.addEventListener('click', () => {
      drawingTool.isDrawingMode = !drawingTool.isDrawingMode;
      els.btnDrawMode.classList.toggle('active', drawingTool.isDrawingMode);
      if (drawingTool.isDrawingMode) {
        api.showContextual?.('modify-run');
      } else if (!state.selectedRunId && (!drawingTool.activePoints || drawingTool.activePoints.length === 0)) {
        api.hideContextual?.();
      }
      if (els.statusText) {
        els.statusText.textContent = drawingTool.isDrawingMode
          ? 'Trace on: click a surface to place pipe'
          : 'Trace off: look around. Click Trace to place pipe';
      }
      api.refreshRibbon?.();
    });

    els.btnOrtho?.addEventListener('click', () => {
      drawingTool.isOrthoActive = !drawingTool.isOrthoActive;
      els.btnOrtho.classList.toggle('active', drawingTool.isOrthoActive);
      api.refreshRibbon?.();
    });

    els.btnPerp?.addEventListener('click', () => {
      drawingTool.isPerpendicularActive = !drawingTool.isPerpendicularActive;
      els.btnPerp.classList.toggle('active', drawingTool.isPerpendicularActive);
      if (els.statusText) {
        els.statusText.textContent = drawingTool.isPerpendicularActive
          ? '⊥ Perpendicular to XY lock active: moving cursor draws vertical riser'
          : 'Perpendicular lock released';
      }
      api.refreshRibbon?.();
    });

    els.btnAddVertUp?.addEventListener('click', () => {
      const step = Math.abs(Number(els.inputVerticalLen?.value) || 2.0);
      const added = drawingTool.addVerticalStep(step);
      if (added) {
        if (els.topElevationInput) els.topElevationInput.value = drawingTool.activeElevation.toFixed(2);
        if (els.statusText) {
          els.statusText.textContent = `Added vertical riser +${step} m straight UP (Elevation: ${drawingTool.activeElevation.toFixed(2)} m)`;
        }
      }
      api.refreshRibbon?.();
    });

    els.btnAddVertDown?.addEventListener('click', () => {
      const step = Math.abs(Number(els.inputVerticalLen?.value) || 2.0);
      const added = drawingTool.addVerticalStep(-step);
      if (added) {
        if (els.topElevationInput) els.topElevationInput.value = drawingTool.activeElevation.toFixed(2);
        if (els.statusText) {
          els.statusText.textContent = `Added vertical riser -${step} m straight DOWN (Elevation: ${drawingTool.activeElevation.toFixed(2)} m)`;
        }
      }
      api.refreshRibbon?.();
    });

    // Revit-Style Top Options Bar Controls
    if (els.topDiameterSelect) {
      els.topDiameterSelect.addEventListener('change', (e) => {
        state.diameterRegistry.setSelected(e.target.value);
        renderDiameterPicker();
        const sel = state.diameterRegistry.getSelected();
        if (els.statusText) {
          els.statusText.textContent = `Selected conduit diameter: ${sel?.label || e.target.value}`;
        }
        api.refreshRibbon?.();
      });
    }

    if (els.topElevationInput) {
      els.topElevationInput.addEventListener('change', (e) => {
        const val = Number(e.target.value);
        if (!Number.isNaN(val)) {
          drawingTool.activeElevation = val;
          if (els.statusText) {
            els.statusText.textContent = `Active Middle Elevation set to: ${val.toFixed(2)} m`;
          }
          api.refreshRibbon?.();
        }
      });
    }

    if (els.btnPickElevation) {
      els.btnPickElevation.addEventListener('click', () => {
        drawingTool.isPickElevationActive = !drawingTool.isPickElevationActive;
        els.btnPickElevation.classList.toggle('active', drawingTool.isPickElevationActive);
        if (els.statusText) {
          els.statusText.textContent = drawingTool.isPickElevationActive
            ? 'Sampling elevation: click any element in the 3D model to set offset'
            : 'Elevation eyedropper cancelled';
        }
        api.refreshRibbon?.();
      });
    }

    if (els.btnToggleWorkplane) {
      els.btnToggleWorkplane.addEventListener('click', () => {
        drawingTool.workPlaneVisible = !drawingTool.workPlaneVisible;
        els.btnToggleWorkplane.classList.toggle('active', drawingTool.workPlaneVisible);
        if (els.statusText) {
          els.statusText.textContent = drawingTool.workPlaneVisible
            ? 'Grid workplane helper visible'
            : 'Grid workplane hidden';
        }
        api.refreshRibbon?.();
      });
    }

    if (els.btnToggleAutoriser) {
      els.btnToggleAutoriser.addEventListener('click', () => {
        drawingTool.autoRiserEnabled = !drawingTool.autoRiserEnabled;
        els.btnToggleAutoriser.classList.toggle('active', drawingTool.autoRiserEnabled);
        els.btnToggleAutoriser.textContent = drawingTool.autoRiserEnabled ? '⚡ Auto-Riser: ON' : '⚡ Auto-Riser: OFF';
        if (els.statusText) {
          els.statusText.textContent = drawingTool.autoRiserEnabled
            ? 'Revit Auto-Riser enabled: changing elevation mid-run will generate vertical risers'
            : 'Auto-Riser disabled';
        }
        api.refreshRibbon?.();
      });
    }

    if (els.topBtnFinish) {
      els.topBtnFinish.addEventListener('click', () => {
        const system = els.topSystemSelect?.value || 'Power';
        drawingTool.finishCurrentRun(() => state.network, (n) => { state.network = n; }, system);
        api.hideContextual?.();
        api.refreshRibbon?.();
      });
    }

    if (els.topBtnCancel) {
      els.topBtnCancel.addEventListener('click', () => {
        drawingTool.cancelCurrentRun();
        api.hideContextual?.();
        api.refreshRibbon?.();
      });
    }

    els.btnUndo?.addEventListener('click', () => {
      if (drawingTool.activePoints.length > 0) {
        drawingTool.undoLastPoint();
        updateUndoRedoButtons(drawingTool);
      } else if (state.commandStack.canUndo()) {
        state.commandStack.undo();
      }
      api.refreshRibbon?.();
    });

    els.btnRedo?.addEventListener('click', () => {
      if (state.commandStack.canRedo()) {
        state.commandStack.redo();
      }
      api.refreshRibbon?.();
    });

    els.btnFinishRun?.addEventListener('click', () => {
      const system = els.topSystemSelect?.value || 'Power';
      drawingTool.finishCurrentRun(() => state.network, (n) => { state.network = n; }, system);
      api.hideContextual?.();
      api.refreshRibbon?.();
    });

    els.btnCancelRun?.addEventListener('click', () => {
      drawingTool.cancelCurrentRun();
      api.hideContextual?.();
      api.refreshRibbon?.();
    });
  }

  api.renderDiameterPicker = renderDiameterPicker;
  api.updateUndoRedoButtons = updateUndoRedoButtons;

  return { renderDiameterPicker, updateUndoRedoButtons, wireDrawControls };
}
