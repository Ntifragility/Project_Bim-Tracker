// conduit-takeoff/src/ui/conduit-adapter.js — Revit ribbon command adapter for conduit takeoff.
//
// Implements the conduit ribbon definition per docs/specs/chrome/command-map-conduit.md
// and docs/specs/chrome/revit-chrome-design.md.
//
// Maps each command id to its existing handler directly (no DOM proxies, no synthetic forwarding).

/**
 * Builds the RibbonDef for Conduit Takeoff.
 *
 * @param {object} ctx Application context bag
 * @returns {object} RibbonDef
 */
export function createConduitRibbonDef(ctx) {
  const getTool = () => ctx.getTool?.() || ctx.api?.drawingTool || (typeof window !== 'undefined' ? window.__drawingTool : null);
  const getDoc = () => (typeof document !== 'undefined' ? document : null);

  return {
    appId: 'conduit',
    qat: [
      'conduit.proj-save',
      'conduit.trace-undo',
      'conduit.trace-redo',
    ],
    tabs: [
      // ─────────────────────────────────────────────────────────────
      // Tab: Model (keytip: M)
      // ─────────────────────────────────────────────────────────────
      {
        id: 'model',
        label: 'Model',
        keytip: 'M',
        groups: [
          {
            id: 'source',
            label: 'Source',
            items: [
              [
                {
                  id: 'conduit.open-ifc',
                  label: 'Open IFC',
                  icon: 'open',
                  size: 'big',
                  keytip: 'MO',
                  tooltip: 'Open IFC File',
                  run(c) {
                    const fileInput = c.els?.fileInput || getDoc()?.getElementById('file-input');
                    fileInput?.click();
                  },
                },
              ],
            ],
          },
          {
            id: 'views',
            label: 'Views',
            items: [
              [
                {
                  id: 'conduit.view-fit',
                  label: 'Fit View',
                  icon: 'reset-view',
                  size: 'small',
                  keytip: 'MVF',
                  tooltip: 'Fit to View',
                  run(c) {
                    const model = c.api?.getLoadedModel?.();
                    if (model && c.api?.fitCameraToModel) {
                      c.api.fitCameraToModel(model);
                    } else if (c.engine?.world?.camera?.controls) {
                      c.engine.world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
                    } else if (c.api?.engine?.world?.camera?.controls) {
                      c.api.engine.world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
                    }
                  },
                },
                {
                  id: 'conduit.view-top',
                  label: 'Top View',
                  icon: 'camera-top',
                  size: 'small',
                  keytip: 'MVT',
                  tooltip: 'Top View',
                  run(c) {
                    const engine = c.engine || c.api?.engine;
                    engine?.world?.camera?.controls?.setLookAt(0, 30, 0, 0, 0, 0, true);
                  },
                },
              ],
              [
                {
                  id: 'conduit.view-front',
                  label: 'Front View',
                  icon: 'camera-front',
                  size: 'small',
                  keytip: 'MVR',
                  tooltip: 'Front View',
                  run(c) {
                    const engine = c.engine || c.api?.engine;
                    engine?.world?.camera?.controls?.setLookAt(0, 2, 30, 0, 2, 0, true);
                  },
                },
                {
                  id: 'conduit.view-right',
                  label: 'Right View',
                  icon: 'camera-right',
                  size: 'small',
                  keytip: 'MVG',
                  tooltip: 'Right View',
                  run(c) {
                    const engine = c.engine || c.api?.engine;
                    engine?.world?.camera?.controls?.setLookAt(30, 2, 0, 0, 2, 0, true);
                  },
                },
              ],
            ],
          },
        ],
      },

      // ─────────────────────────────────────────────────────────────
      // Tab: Trace (keytip: T)
      // ─────────────────────────────────────────────────────────────
      {
        id: 'trace',
        label: 'Trace',
        keytip: 'T',
        groups: [
          {
            id: 'tools',
            label: 'Tools',
            items: [
              [
                {
                  id: 'conduit.trace-draw',
                  label: 'Trace',
                  icon: 'trace',
                  size: 'big',
                  keytip: 'TD',
                  tooltip: 'Trace Conduit (Click on model to place points, Enter to finish, Esc to cancel)',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    tool.isDrawingMode = !tool.isDrawingMode;
                    const btn = c.els?.btnDrawMode || getDoc()?.getElementById('btn-draw-mode');
                    if (btn) btn.classList.toggle('active', tool.isDrawingMode);
                    if (tool.isDrawingMode) {
                      c.ribbonApi?.showContextual('modify-run');
                      c.api?.showContextual?.('modify-run');
                    } else if (!c.state?.selectedRunId && (!tool.activePoints || tool.activePoints.length === 0)) {
                      c.ribbonApi?.hideContextual();
                      c.api?.hideContextual?.();
                    }
                    const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                    if (statusText) {
                      statusText.textContent = tool.isDrawingMode
                        ? 'Trace on: click a surface to place pipe'
                        : 'Trace off: look around. Click Trace to place pipe';
                    }
                    c.ribbonApi?.refresh();
                  },
                },
                {
                  id: 'conduit.trace-ortho',
                  label: 'Ortho',
                  icon: 'ortho',
                  size: 'small',
                  keytip: 'TO',
                  tooltip: 'Ortho lock: keep the next segment on one axis',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    tool.isOrthoActive = !tool.isOrthoActive;
                    const btn = c.els?.btnOrtho || getDoc()?.getElementById('btn-ortho');
                    if (btn) btn.classList.toggle('active', tool.isOrthoActive);
                    c.ribbonApi?.refresh();
                  },
                },
                {
                  id: 'conduit.trace-perp',
                  label: 'Perpendicular',
                  icon: 'perp',
                  size: 'small',
                  keytip: 'TP',
                  tooltip: 'Perpendicular to XY plane (Vertical Riser / Press \'V\' or \'Z\')',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    tool.isPerpendicularActive = !tool.isPerpendicularActive;
                    const btn = c.els?.btnPerp || getDoc()?.getElementById('btn-perp');
                    if (btn) btn.classList.toggle('active', tool.isPerpendicularActive);
                    const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                    if (statusText) {
                      statusText.textContent = tool.isPerpendicularActive
                        ? '⊥ Perpendicular to XY lock active: moving cursor draws vertical riser'
                        : 'Perpendicular lock released';
                    }
                    c.ribbonApi?.refresh();
                  },
                },
              ],
              [
                {
                  id: 'conduit.trace-undo',
                  label: 'Undo',
                  icon: 'undo',
                  size: 'small',
                  keytip: 'TU',
                  tooltip: 'Undo (Ctrl+Z)',
                  enabled(c) {
                    const tool = getTool();
                    return Boolean((tool?.activePoints?.length > 0) || c.state?.commandStack?.canUndo?.());
                  },
                  run(c) {
                    const tool = getTool();
                    if (tool && tool.activePoints?.length > 0) {
                      tool.undoLastPoint();
                      c.api?.updateUndoRedoButtons?.(tool);
                    } else if (c.state?.commandStack?.canUndo?.()) {
                      c.state.commandStack.undo();
                    }
                    c.ribbonApi?.refresh();
                  },
                },
                {
                  id: 'conduit.trace-redo',
                  label: 'Redo',
                  icon: 'redo',
                  size: 'small',
                  keytip: 'TR',
                  tooltip: 'Redo (Ctrl+Y)',
                  enabled(c) {
                    return Boolean(c.state?.commandStack?.canRedo?.());
                  },
                  run(c) {
                    if (c.state?.commandStack?.canRedo?.()) {
                      c.state.commandStack.redo();
                    }
                    c.ribbonApi?.refresh();
                  },
                },
              ],
            ],
          },
          {
            id: 'run',
            label: 'Run',
            items: [
              [
                {
                  id: 'conduit.run-finish',
                  label: 'Finish Run',
                  icon: 'finish',
                  size: 'big',
                  keytip: 'TRF',
                  tooltip: 'Finish Run (Enter)',
                  splitWith: 'conduit.run-cancel',
                  enabled(c) {
                    const tool = getTool();
                    return Boolean(tool && tool.activePoints && tool.activePoints.length > 0);
                  },
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    const topSys = c.els?.topSystemSelect || getDoc()?.getElementById('top-system-select');
                    const system = c.selectedSystem || topSys?.value || 'Power';
                    tool.finishCurrentRun(() => c.state.network, (n) => { c.state.network = n; }, system);
                    c.ribbonApi?.hideContextual();
                    c.api?.hideContextual?.();
                    c.ribbonApi?.refresh();
                  },
                },
                {
                  id: 'conduit.run-cancel',
                  label: 'Cancel Run',
                  icon: 'cancel',
                  size: 'small',
                  keytip: 'TRC',
                  tooltip: 'Cancel (Esc)',
                  enabled(c) {
                    const tool = getTool();
                    return Boolean(tool && tool.activePoints && tool.activePoints.length > 0);
                  },
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    tool.cancelCurrentRun();
                    c.ribbonApi?.hideContextual();
                    c.api?.hideContextual?.();
                    c.ribbonApi?.refresh();
                  },
                },
                {
                  id: 'conduit.run-vert-up',
                  label: '+Up',
                  icon: 'vert-up',
                  size: 'small',
                  keytip: 'TVU',
                  tooltip: 'Add vertical segment straight UP',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    const inputLen = c.els?.inputVerticalLen || getDoc()?.getElementById('input-vertical-len');
                    const step = Math.abs(Number(inputLen?.value) || 2.0);
                    const added = tool.addVerticalStep(step);
                    if (added) {
                      const elevInput = c.els?.topElevationInput || getDoc()?.getElementById('top-elevation-input');
                      if (elevInput) elevInput.value = tool.activeElevation.toFixed(2);
                      const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                      if (statusText) {
                        statusText.textContent = `Added vertical riser +${step} m straight UP (Elevation: ${tool.activeElevation.toFixed(2)} m)`;
                      }
                    }
                    c.ribbonApi?.refresh();
                  },
                },
                {
                  id: 'conduit.run-vert-down',
                  label: '-Down',
                  icon: 'vert-down',
                  size: 'small',
                  keytip: 'TVD',
                  tooltip: 'Add vertical segment straight DOWN',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    const inputLen = c.els?.inputVerticalLen || getDoc()?.getElementById('input-vertical-len');
                    const step = Math.abs(Number(inputLen?.value) || 2.0);
                    const added = tool.addVerticalStep(-step);
                    if (added) {
                      const elevInput = c.els?.topElevationInput || getDoc()?.getElementById('top-elevation-input');
                      if (elevInput) elevInput.value = tool.activeElevation.toFixed(2);
                      const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                      if (statusText) {
                        statusText.textContent = `Added vertical riser -${step} m straight DOWN (Elevation: ${tool.activeElevation.toFixed(2)} m)`;
                      }
                    }
                    c.ribbonApi?.refresh();
                  },
                },
              ],
            ],
          },
        ],
      },

      // ─────────────────────────────────────────────────────────────
      // Tab: Quantities (keytip: Q)
      // ─────────────────────────────────────────────────────────────
      {
        id: 'quantities',
        label: 'Quantities',
        keytip: 'Q',
        groups: [
          {
            id: 'takeoff',
            label: 'Takeoff',
            items: [],
          },
        ],
      },

      // ─────────────────────────────────────────────────────────────
      // Tab: Project (keytip: P)
      // ─────────────────────────────────────────────────────────────
      {
        id: 'project',
        label: 'Project',
        keytip: 'P',
        groups: [
          {
            id: 'project',
            label: 'Project',
            items: [
              [
                {
                  id: 'conduit.proj-load',
                  label: 'Open',
                  icon: 'open',
                  size: 'big',
                  keytip: 'PO',
                  tooltip: 'Open .conduit.json project',
                  run(c) {
                    const fileInput = c.els?.projectFileInput || getDoc()?.getElementById('project-file-input');
                    fileInput?.click();
                  },
                },
                {
                  id: 'conduit.proj-save',
                  label: 'Save',
                  icon: 'save',
                  size: 'big',
                  keytip: 'PS',
                  tooltip: 'Save Project',
                  enabled(c) {
                    const runsCount = c.state?.network?.runs?.length || 0;
                    const hasModel = Boolean(c.state?.sourceModel?.buffer);
                    const btnSave = c.els?.btnSave || getDoc()?.getElementById('btn-save');
                    return runsCount > 0 || hasModel || Boolean(btnSave && !btnSave.disabled);
                  },
                  run(c) {
                    const btn = c.els?.btnSave || getDoc()?.getElementById('btn-save');
                    btn?.click();
                  },
                },
              ],
            ],
          },
          {
            id: 'export',
            label: 'Export',
            items: [
              [
                {
                  id: 'conduit.proj-csv',
                  label: 'CSV',
                  icon: 'csv',
                  size: 'small',
                  keytip: 'PEC',
                  tooltip: 'Export CSV',
                  enabled(c) {
                    const runsCount = c.state?.network?.runs?.length || 0;
                    const btn = c.els?.btnExportCsv || getDoc()?.getElementById('btn-export-csv');
                    return runsCount > 0 || Boolean(btn && !btn.disabled);
                  },
                  run(c) {
                    const btn = c.els?.btnExportCsv || getDoc()?.getElementById('btn-export-csv');
                    btn?.click();
                  },
                },
              ],
              [
                {
                  id: 'conduit.proj-ifc',
                  label: 'IFC',
                  icon: 'export',
                  size: 'small',
                  keytip: 'PEI',
                  tooltip: 'Export Overlay IFC for Revizto',
                  enabled(c) {
                    const runsCount = c.state?.network?.runs?.length || 0;
                    const btn = c.els?.btnExportIfc || getDoc()?.getElementById('btn-export-ifc');
                    return runsCount > 0 || Boolean(btn && !btn.disabled);
                  },
                  run(c) {
                    const btn = c.els?.btnExportIfc || getDoc()?.getElementById('btn-export-ifc');
                    btn?.click();
                  },
                },
              ],
            ],
          },
          {
            id: 'standards',
            label: 'Standards',
            items: [
              [
                {
                  id: 'conduit.nec-standards',
                  label: 'NEC Code\nStandards',
                  icon: 'report',
                  size: 'big',
                  keytip: 'PNC',
                  tooltip: 'View National Electrical Code (NFPA 70) conduit bending, radii & support rules',
                  run(c) {
                    c.api?.openNecDialog?.();
                    const dialog = getDoc()?.getElementById('nec-inspector-dialog');
                    if (dialog) dialog.hidden = false;
                  },
                },
              ],
            ],
          },
        ],
      },
    ],

    // ───────────────────────────────────────────────────────────────
    // Contextual Tab: Modify | Run (keytip: CR)
    // ───────────────────────────────────────────────────────────────
    contextual: [
      {
        id: 'modify-run',
        label: 'MODIFY | RUN',
        keytip: 'CR',
        groups: [
          {
            id: 'size',
            label: 'Size',
            items: [
              [
                {
                  kind: 'input',
                  id: 'top-diameter-select',
                  label: 'Size:',
                  inputType: 'select',
                  keytip: 'CRS',
                  tooltip: 'Conduit Trade Size',
                  get options() {
                    const reg = ctx.state?.diameterRegistry;
                    return reg ? reg.getAll().map(d => ({ value: d.id, label: `${d.label} (${d.mm}mm)` })) : [];
                  },
                  value(c) {
                    return c.state?.diameterRegistry?.getSelected()?.id || '';
                  },
                  onChange(val, c) {
                    c.state?.diameterRegistry?.setSelected(val);
                    c.api?.renderDiameterPicker?.();
                    const sel = c.state?.diameterRegistry?.getSelected();
                    const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                    if (statusText) {
                      statusText.textContent = `Selected conduit diameter: ${sel?.label || val}`;
                    }
                    c.ribbonApi?.refresh();
                  },
                },
              ],
            ],
          },
          {
            id: 'elevation',
            label: 'Elevation',
            items: [
              [
                {
                  kind: 'input',
                  id: 'top-elevation-input',
                  label: 'Middle Elevation:',
                  inputType: 'number',
                  keytip: 'CRE',
                  tooltip: 'Middle Elevation Offset',
                  value(c) {
                    const tool = getTool();
                    return tool?.activeElevation !== undefined ? Number(tool.activeElevation.toFixed(2)) : 2.8;
                  },
                  onChange(val, c) {
                    const num = Number(val);
                    if (!Number.isNaN(num)) {
                      const tool = getTool();
                      if (tool) tool.activeElevation = num;
                      const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                      if (statusText) {
                        statusText.textContent = `Active Middle Elevation set to: ${num.toFixed(2)} m`;
                      }
                      const topInput = c.els?.topElevationInput || getDoc()?.getElementById('top-elevation-input');
                      if (topInput) topInput.value = num.toFixed(2);
                    }
                  },
                },
                {
                  id: 'btn-pick-elevation',
                  label: 'Pick Elevation',
                  icon: 'pick',
                  size: 'small',
                  keytip: 'CRP',
                  tooltip: 'Pick Elevation: Click any slab, beam, or element in the model to sample its elevation',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    tool.isPickElevationActive = !tool.isPickElevationActive;
                    const btn = c.els?.btnPickElevation || getDoc()?.getElementById('btn-pick-elevation');
                    if (btn) btn.classList.toggle('active', tool.isPickElevationActive);
                    const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                    if (statusText) {
                      statusText.textContent = tool.isPickElevationActive
                        ? 'Sampling elevation: click any element in the 3D model to set offset'
                        : 'Elevation eyedropper cancelled';
                    }
                    c.ribbonApi?.refresh();
                  },
                },
              ],
            ],
          },
          {
            id: 'system',
            label: 'System',
            items: [
              [
                {
                  kind: 'input',
                  id: 'top-system-select',
                  label: 'System:',
                  inputType: 'select',
                  keytip: 'CRSY',
                  options: [
                    { value: 'Power', label: 'Power' },
                    { value: 'Lighting', label: 'Lighting' },
                    { value: 'Controls', label: 'Controls' },
                    { value: 'Fire Alarm', label: 'Fire Alarm' },
                    { value: 'Low Voltage', label: 'Low Voltage' },
                  ],
                  value(c) {
                    const topSys = c.els?.topSystemSelect || getDoc()?.getElementById('top-system-select');
                    return c.selectedSystem || topSys?.value || 'Power';
                  },
                  onChange(val, c) {
                    c.selectedSystem = val;
                    const topSys = c.els?.topSystemSelect || getDoc()?.getElementById('top-system-select');
                    if (topSys) topSys.value = val;
                    const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                    if (statusText) {
                      statusText.textContent = `Active system: ${val}`;
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'grid',
            label: 'Grid',
            items: [
              [
                {
                  id: 'btn-toggle-workplane',
                  label: 'Grid Plane',
                  icon: 'workplane',
                  size: 'small',
                  keytip: 'CRW',
                  tooltip: 'Toggle Work Plane Grid visibility at current elevation',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    tool.workPlaneVisible = !tool.workPlaneVisible;
                    const btn = c.els?.btnToggleWorkplane || getDoc()?.getElementById('btn-toggle-workplane');
                    if (btn) btn.classList.toggle('active', tool.workPlaneVisible);
                    const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                    if (statusText) {
                      statusText.textContent = tool.workPlaneVisible
                        ? 'Grid workplane helper visible'
                        : 'Grid workplane hidden';
                    }
                    c.ribbonApi?.refresh();
                  },
                },
                {
                  id: 'btn-toggle-autoriser',
                  label: 'Auto-Riser',
                  icon: 'autoriser',
                  size: 'small',
                  keytip: 'CRA',
                  tooltip: 'Auto-Riser: Automatically insert vertical transition when elevation changes',
                  run(c) {
                    const tool = getTool();
                    if (!tool) return;
                    tool.autoRiserEnabled = !tool.autoRiserEnabled;
                    const btn = c.els?.btnToggleAutoriser || getDoc()?.getElementById('btn-toggle-autoriser');
                    if (btn) {
                      btn.classList.toggle('active', tool.autoRiserEnabled);
                      btn.textContent = tool.autoRiserEnabled ? '⚡ Auto-Riser: ON' : '⚡ Auto-Riser: OFF';
                    }
                    const statusText = c.els?.statusText || getDoc()?.getElementById('status-text');
                    if (statusText) {
                      statusText.textContent = tool.autoRiserEnabled
                        ? 'Revit Auto-Riser enabled: changing elevation mid-run will generate vertical risers'
                        : 'Auto-Riser disabled';
                    }
                    c.ribbonApi?.refresh();
                  },
                },
              ],
            ],
          },
        ],
      },
    ],

    // ───────────────────────────────────────────────────────────────
    // Status segments
    // ───────────────────────────────────────────────────────────────
    statusSegments: [
      {
        id: 'status-text',
        value(c) {
          const el = c.els?.statusText || getDoc()?.getElementById('status-text');
          return el?.textContent || 'Trace off: look around. Click Trace to place pipe';
        },
      },
      {
        id: 'cursor-coords',
        value(c) {
          const el = c.els?.cursorCoords || getDoc()?.getElementById('cursor-coords');
          return el?.textContent || '';
        },
      },
    ],
  };
}

export const getConduitRibbonDef = createConduitRibbonDef;
