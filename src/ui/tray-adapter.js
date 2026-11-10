// Tray Viewer — Revit Ribbon Command Adapter
//
// Implements the tray ribbon definition per docs/specs/chrome/command-map-tray.md
// and docs/specs/chrome/revit-chrome-design.md.
//
// Declaratively maps each ribbon command to its underlying feature module handler.
// No DOM-move hacks. No synthetic click forwarding.

import * as THREE from 'three';
import * as dom from './dom.js';

/**
 * Builds and returns the RibbonDef for the Tray Viewer application.
 *
 * @param {object} ctx App context (src/ui/context.js)
 * @returns {object} RibbonDef compatible with createRibbon()
 */
export function createTrayRibbonDef(ctx) {
  const api = ctx?.api || (typeof window !== 'undefined' ? window.__TRAY_API__ : null) || {};

  return {
    appId: 'tray',
    qat: [
      'tray.export-mapping',
      'tray.batch-undo',
      'tray.batch-apply',
    ],
    tabs: [
      // ─────────────────────────────────────────────────────────
      // Tab: Model (M)
      // ─────────────────────────────────────────────────────────
      {
        id: 'model',
        label: 'Model',
        keytip: 'M',
        groups: [
          {
            id: 'model-source',
            label: 'Source',
            items: [
              [
                {
                  id: 'tray.open-sample',
                  label: 'Load\nSample',
                  icon: 'sample',
                  size: 'big',
                  keytip: 'MS',
                  tooltip: 'Load sample model BasicHouse.ifc',
                  run: async () => {
                    if (typeof api.loadSampleModel === 'function') {
                      await api.loadSampleModel();
                    } else if (dom.btnLoadSample) {
                      dom.btnLoadSample.click();
                    }
                  },
                },
                {
                  id: 'tray.open-ifc',
                  label: 'Open\nIFC',
                  icon: 'open',
                  size: 'big',
                  keytip: 'MO',
                  tooltip: 'Open IFC file',
                  run: () => {
                    if (dom.fileInput) dom.fileInput.click();
                  },
                },
              ],
              [
                {
                  id: 'tray.link-excel',
                  label: 'Link Excel',
                  icon: 'link',
                  size: 'small',
                  keytip: 'ML',
                  tooltip: 'Link Excel mapping spreadsheet',
                  run: () => {
                    if (dom.excelFileInput) dom.excelFileInput.click();
                  },
                },
              ],
            ],
          },
          {
            id: 'model-export',
            label: 'Export',
            items: [
              [
                {
                  id: 'tray.export-all',
                  label: 'Export\nAll IFC',
                  icon: 'export',
                  size: 'big',
                  keytip: 'ME',
                  tooltip: 'Export combined IFC with edits and tags',
                  enabled: () => (ctx.loadedModels?.length ?? 0) > 0,
                  run: () => {
                    if (typeof api.exportUnifiedIfcLocal === 'function') {
                      api.exportUnifiedIfcLocal();
                    } else if (dom.btnExportAllIfc) {
                      dom.btnExportAllIfc.click();
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'model-views',
            label: 'Views',
            items: [
              [
                {
                  id: 'tray.view-reset',
                  label: 'Reset Camera',
                  icon: 'reset-view',
                  size: 'small',
                  keytip: 'MVR',
                  tooltip: 'Reset camera view',
                  run: () => {
                    if (typeof api.fitModelsToView === 'function') {
                      api.fitModelsToView();
                    } else if (dom.btnResetCamera) {
                      dom.btnResetCamera.click();
                    }
                  },
                },
                {
                  id: 'tray.view-settings',
                  label: 'Settings',
                  icon: 'settings',
                  size: 'small',
                  keytip: 'MVS',
                  tooltip: 'Viewer settings',
                  run: () => {
                    if (dom.viewerSettingsPanel) {
                      const willOpen = dom.viewerSettingsPanel.hidden;
                      dom.viewerSettingsPanel.hidden = !willOpen;
                      dom.btnViewerSettings?.setAttribute('aria-expanded', String(willOpen));
                    }
                  },
                },
                {
                  id: 'tray.view-grid',
                  label: 'Grid',
                  icon: 'views',
                  size: 'small',
                  keytip: 'MVG',
                  tooltip: 'Toggle grid visibility',
                  run: () => {
                    const grid = api.resolveWorldGrid?.();
                    if (grid) {
                      const next = dom.toggleGrid ? !dom.toggleGrid.checked : !grid.visible;
                      if (dom.toggleGrid) dom.toggleGrid.checked = next;
                      if ('visible' in grid) grid.visible = next;
                      else if (grid.three) grid.three.visible = next;
                    } else if (dom.toggleGrid) {
                      dom.toggleGrid.checked = !dom.toggleGrid.checked;
                      dom.toggleGrid.dispatchEvent(new Event('change'));
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.view-wireframe',
                  label: 'Wireframe',
                  icon: 'views',
                  size: 'small',
                  keytip: 'MVW',
                  tooltip: 'Toggle wireframe mode',
                  run: () => {
                    const next = dom.toggleWireframe ? !dom.toggleWireframe.checked : true;
                    if (dom.toggleWireframe) dom.toggleWireframe.checked = next;
                    api.setWireframe?.(next);
                  },
                },
                {
                  id: 'tray.view-darkmode',
                  label: 'Dark Mode',
                  icon: 'theme',
                  size: 'small',
                  keytip: 'MVD',
                  tooltip: 'Toggle canvas background theme',
                  run: () => {
                    const next = dom.toggleDarkMode ? !dom.toggleDarkMode.checked : true;
                    if (dom.toggleDarkMode) dom.toggleDarkMode.checked = next;
                    const color = next ? new THREE.Color('#0a0b0e') : new THREE.Color('#f3f4f6');
                    if (ctx.world?.scene?.three) ctx.world.scene.three.background = color;
                  },
                },
                {
                  id: 'tray.view-highlight-tagged',
                  label: 'Highlight Tagged',
                  icon: 'highlight',
                  size: 'small',
                  keytip: 'MVH',
                  tooltip: 'Highlight tagged cable trays',
                  run: () => {
                    const next = dom.toggleHighlightTaggedSidebar ? !dom.toggleHighlightTaggedSidebar.checked : true;
                    if (dom.toggleHighlightTaggedSidebar) dom.toggleHighlightTaggedSidebar.checked = next;
                    ctx.isTaggedTrayHighlightActive = next;
                    api.refreshTaggedTrayHighlights?.();
                  },
                },
              ],
              [
                {
                  id: 'tray.view-floating-labels',
                  label: 'Floating Tags',
                  icon: 'tag',
                  size: 'small',
                  keytip: 'MVF',
                  tooltip: 'Toggle 3D floating tag labels',
                  run: () => {
                    const next = dom.toggleFloatingLabelsSidebar ? !dom.toggleFloatingLabelsSidebar.checked : true;
                    if (dom.toggleFloatingLabelsSidebar) dom.toggleFloatingLabelsSidebar.checked = next;
                    ctx.isFloatingLabelsActive = next;
                    api.setFloatingLabelsActive?.(next);
                  },
                },
              ],
            ],
          },
        ],
      },

      // ─────────────────────────────────────────────────────────
      // Tab: Tag (T)
      // ─────────────────────────────────────────────────────────
      {
        id: 'tag',
        label: 'Tag',
        keytip: 'T',
        groups: [
          {
            id: 'tag-batch',
            label: 'Batch',
            items: [
              [
                {
                  id: 'tray.batch-apply',
                  label: 'Apply\nBatch',
                  icon: 'tag-batch',
                  size: 'big',
                  keytip: 'TA',
                  tooltip: 'Apply batch tags to selected elements',
                  enabled: () => {
                    if (dom.btnApplyBatchTags) return !dom.btnApplyBatchTags.disabled;
                    return Boolean(ctx.batchPreviewAssignments?.length);
                  },
                  run: () => {
                    if (typeof api.applyBatchTags === 'function') {
                      api.applyBatchTags();
                    } else if (dom.btnApplyBatchTags) {
                      dom.btnApplyBatchTags.click();
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.batch-preview',
                  label: 'Preview Batch',
                  icon: 'tag',
                  size: 'small',
                  keytip: 'TP',
                  tooltip: 'Preview batch tag generation',
                  run: async () => {
                    if (typeof api.previewBatchTags === 'function') {
                      await api.previewBatchTags();
                    } else if (dom.btnPreviewBatchTags) {
                      dom.btnPreviewBatchTags.click();
                    }
                  },
                },
                {
                  id: 'tray.batch-undo',
                  label: 'Undo Batch',
                  icon: 'tag-undo',
                  size: 'small',
                  keytip: 'TU',
                  tooltip: 'Undo last applied tag batch',
                  enabled: () => {
                    if (dom.btnUndoBatchTags) return !dom.btnUndoBatchTags.disabled;
                    return Boolean(ctx.lastBatchSnapshot?.length);
                  },
                  run: () => {
                    if (typeof api.undoBatchTags === 'function') {
                      api.undoBatchTags();
                    } else if (dom.btnUndoBatchTags) {
                      dom.btnUndoBatchTags.click();
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'tag-assign',
            label: 'Assign',
            items: [
              [
                {
                  id: 'tray.assign-tag',
                  label: 'Assign\nTag',
                  icon: 'tag',
                  size: 'big',
                  keytip: 'TAS',
                  tooltip: 'Assign system tag to selected elements',
                  run: async () => {
                    if (typeof api.assignCurrentTag === 'function') {
                      await api.assignCurrentTag();
                    } else if (dom.btnAssignTag) {
                      dom.btnAssignTag.click();
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.selection-add',
                  label: 'Add Sel',
                  icon: 'system',
                  size: 'small',
                  keytip: 'TAA',
                  tooltip: 'Add current element to tray selection',
                  run: () => {
                    if (typeof api.addSelectionToTray === 'function') {
                      api.addSelectionToTray();
                    } else if (dom.btnAddTraySelection) {
                      dom.btnAddTraySelection.click();
                    }
                  },
                },
                {
                  id: 'tray.selection-unassign',
                  label: 'Unassign',
                  icon: 'tag-undo',
                  size: 'small',
                  keytip: 'TAU',
                  tooltip: 'Unassign tag from selected element',
                  run: () => {
                    if (typeof api.unassignSelectedElement === 'function') {
                      api.unassignSelectedElement();
                    } else if (dom.btnUnassignTag) {
                      dom.btnUnassignTag.click();
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'tag-validate',
            label: 'Validate',
            items: [
              [
                {
                  id: 'tray.validate',
                  label: 'Validate\nTags',
                  icon: 'validate',
                  size: 'big',
                  keytip: 'TV',
                  tooltip: 'Validate tag consistency and uniqueness',
                  run: () => {
                    if (typeof api.runTagValidation === 'function') {
                      api.runTagValidation();
                    } else if (dom.btnValidateTags) {
                      dom.btnValidateTags.click();
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.system-highlight',
                  label: 'Highlight System',
                  icon: 'highlight',
                  size: 'small',
                  keytip: 'TVH',
                  tooltip: 'Highlight elements in entered system',
                  run: async () => {
                    if (typeof api.highlightEnteredSystem === 'function') {
                      await api.highlightEnteredSystem();
                    } else if (dom.btnHighlightSystem) {
                      dom.btnHighlightSystem.click();
                    }
                  },
                },
              ],
            ],
          },
        ],
      },

      // ─────────────────────────────────────────────────────────
      // Tab: Systems (S)
      // ─────────────────────────────────────────────────────────
      {
        id: 'systems',
        label: 'Systems',
        keytip: 'S',
        groups: [
          {
            id: 'systems-manager',
            label: 'Manager',
            items: [
              [
                {
                  id: 'tray.systems-continuity',
                  label: 'Check\nContinuity',
                  icon: 'continuity',
                  size: 'big',
                  keytip: 'SC',
                  tooltip: 'Check continuity of selected tray system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.checkSelectedTraySystemContinuity === 'function') {
                      await api.checkSelectedTraySystemContinuity();
                    } else if (dom.btnManagerCheckContinuity) {
                      dom.btnManagerCheckContinuity.click();
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.systems-refresh',
                  label: 'Refresh',
                  icon: 'reset-view',
                  size: 'small',
                  keytip: 'SR',
                  tooltip: 'Refresh tray systems manager',
                  run: () => {
                    if (typeof api.renderTraySystemManager === 'function') {
                      api.renderTraySystemManager();
                    } else if (dom.btnRefreshTraySystems) {
                      dom.btnRefreshTraySystems.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-highlight',
                  label: 'Highlight',
                  icon: 'highlight',
                  size: 'small',
                  keytip: 'SH',
                  tooltip: 'Highlight selected tray system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.highlightSelectedTraySystem === 'function') {
                      await api.highlightSelectedTraySystem();
                    } else if (dom.btnManagerHighlight) {
                      dom.btnManagerHighlight.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-isolate',
                  label: 'Isolate',
                  icon: 'isolate',
                  size: 'small',
                  keytip: 'SI',
                  tooltip: 'Isolate selected tray system in 3D view',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.isolateSelectedTraySystem === 'function') {
                      await api.isolateSelectedTraySystem();
                    } else if (dom.btnManagerIsolate) {
                      dom.btnManagerIsolate.click();
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.systems-add',
                  label: 'Add Sel',
                  icon: 'system',
                  size: 'small',
                  keytip: 'SA',
                  tooltip: 'Add selected elements to system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.addSelectionToSelectedTraySystem === 'function') {
                      await api.addSelectionToSelectedTraySystem();
                    } else if (dom.btnManagerAddSelection) {
                      dom.btnManagerAddSelection.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-remove',
                  label: 'Remove Sel',
                  icon: 'tag-undo',
                  size: 'small',
                  keytip: 'SRM',
                  tooltip: 'Remove selected elements from system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.removeSelectionFromSelectedTraySystem === 'function') {
                      await api.removeSelectionFromSelectedTraySystem();
                    } else if (dom.btnManagerRemoveSelection) {
                      dom.btnManagerRemoveSelection.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-regen',
                  label: 'Regen Seq',
                  icon: 'regen',
                  size: 'small',
                  keytip: 'SRG',
                  tooltip: 'Regenerate sequence numbers for system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.regenerateSelectedSystemSequence === 'function') {
                      await api.regenerateSelectedSystemSequence();
                    } else if (dom.btnManagerRegenerateSequence) {
                      dom.btnManagerRegenerateSequence.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-rename',
                  label: 'Rename',
                  icon: 'metadata',
                  size: 'small',
                  keytip: 'SRN',
                  tooltip: 'Rename selected system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.renameSelectedTraySystem === 'function') {
                      await api.renameSelectedTraySystem();
                    } else if (dom.btnManagerRename) {
                      dom.btnManagerRename.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-restore',
                  label: 'Restore',
                  icon: 'restore',
                  size: 'small',
                  keytip: 'SRS',
                  tooltip: 'Restore all pending deletions',
                  run: () => {
                    if (typeof api.restoreAllPendingTrayDeletions === 'function') {
                      api.restoreAllPendingTrayDeletions();
                    } else if (dom.btnRestoreAllDeletions) {
                      dom.btnRestoreAllDeletions.click();
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'systems-export',
            label: 'Export',
            items: [
              [
                {
                  id: 'tray.export-mapping',
                  label: 'Export Tags',
                  icon: 'export',
                  size: 'small',
                  keytip: 'SEM',
                  tooltip: 'Export tag mapping to Excel workbook',
                  run: async () => {
                    if (typeof api.exportTagMappingTable === 'function') {
                      await api.exportTagMappingTable();
                    } else if (dom.btnExportTags) {
                      dom.btnExportTags.click();
                    }
                  },
                },
                {
                  id: 'tray.export-tagged-ifc',
                  label: 'Export Tagged IFC',
                  icon: 'export',
                  size: 'small',
                  keytip: 'SET',
                  tooltip: 'Export IFC with applied tag assignments',
                  enabled: () => (ctx.tagAssignments?.size ?? 0) > 0,
                  run: () => {
                    if (typeof api.exportUnifiedIfcLocal === 'function') {
                      api.exportUnifiedIfcLocal();
                    } else if (dom.btnExportTaggedIfc) {
                      dom.btnExportTaggedIfc.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-continuity-clear',
                  label: 'Clear Colors',
                  icon: 'color',
                  size: 'small',
                  keytip: 'SCC',
                  tooltip: 'Clear continuity check highlight colors',
                  run: async () => {
                    if (typeof api.clearContinuityGroupHighlights === 'function') {
                      await api.clearContinuityGroupHighlights();
                    } else if (dom.btnClearContinuityColors) {
                      dom.btnClearContinuityColors.click();
                    }
                  },
                },
              ],
            ],
          },
        ],
      },

      // ─────────────────────────────────────────────────────────
      // Tab: Edit (E)
      // ─────────────────────────────────────────────────────────
      {
        id: 'edit',
        label: 'Edit',
        keytip: 'E',
        groups: [
          {
            id: 'edit-metadata',
            label: 'Metadata',
            items: [
              [
                {
                  id: 'tray.meta-stage',
                  label: 'Stage\nMetadata',
                  icon: 'metadata',
                  size: 'big',
                  keytip: 'EMS',
                  tooltip: 'Stage metadata property changes',
                  run: () => {
                    if (typeof api.stageMetadata === 'function') {
                      api.stageMetadata();
                    } else if (dom.btnStageMetadata) {
                      dom.btnStageMetadata.click();
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.meta-add-row',
                  label: 'Add Row',
                  icon: 'metadata',
                  size: 'small',
                  keytip: 'EMA',
                  tooltip: 'Add new metadata property row',
                  run: () => {
                    if (typeof api.addMetadataRow === 'function') {
                      api.addMetadataRow();
                    } else if (dom.btnAddMetadataRow) {
                      dom.btnAddMetadataRow.click();
                    }
                  },
                },
                {
                  id: 'tray.meta-copy-prev',
                  label: 'Copy Prev',
                  icon: 'metadata',
                  size: 'small',
                  keytip: 'EMC',
                  tooltip: 'Copy previous metadata template',
                  run: () => {
                    if (typeof api.copyPreviousMetadata === 'function') {
                      api.copyPreviousMetadata();
                    } else if (dom.btnCopyPreviousMetadata) {
                      dom.btnCopyPreviousMetadata.click();
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'edit-stage',
            label: 'Edit',
            items: [
              [
                {
                  id: 'tray.edit-stage-prop',
                  label: 'Stage Property',
                  icon: 'metadata',
                  size: 'small',
                  keytip: 'EEP',
                  tooltip: 'Stage single property edit',
                  run: () => {
                    if (typeof api.stagePropertyEdit === 'function') {
                      api.stagePropertyEdit();
                    } else if (dom.btnStagePropertyEdit) {
                      dom.btnStagePropertyEdit.click();
                    }
                  },
                },
                {
                  id: 'tray.edit-stage-color',
                  label: 'Stage Color',
                  icon: 'color',
                  size: 'small',
                  keytip: 'EEC',
                  tooltip: 'Stage appearance color edit',
                  run: async () => {
                    if (typeof api.stageColorEdit === 'function') {
                      await api.stageColorEdit();
                    } else if (dom.btnStageColorEdit) {
                      dom.btnStageColorEdit.click();
                    }
                  },
                },
                {
                  id: 'tray.edit-clear',
                  label: 'Clear Edits',
                  icon: 'tag-undo',
                  size: 'small',
                  keytip: 'EEX',
                  tooltip: 'Clear all staged IFC edits',
                  run: () => {
                    if (typeof api.clearIfcEdits === 'function') {
                      api.clearIfcEdits();
                    } else if (dom.btnClearIfcEdits) {
                      dom.btnClearIfcEdits.click();
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'edit-export',
            label: 'Export',
            items: [
              [
                {
                  id: 'tray.edit-export-ifc',
                  label: 'Export\nEdited IFC',
                  icon: 'export',
                  size: 'big',
                  keytip: 'EEE',
                  tooltip: 'Export edited IFC file',
                  enabled: () => (ctx.pendingIfcPropertyEdits?.size ?? 0) > 0 || (ctx.pendingIfcColorEdits?.size ?? 0) > 0 || (ctx.tagAssignments?.size ?? 0) > 0,
                  run: () => {
                    if (typeof api.exportUnifiedIfcLocal === 'function') {
                      api.exportUnifiedIfcLocal();
                    } else if (dom.btnExportEditedIfc) {
                      dom.btnExportEditedIfc.click();
                    }
                  },
                },
              ],
            ],
          },
          {
            id: 'edit-route',
            label: 'Route',
            items: [
              [
                {
                  id: 'tray.route-build',
                  label: 'Build\nGraph',
                  icon: 'routing',
                  size: 'big',
                  keytip: 'ERB',
                  tooltip: 'Build routing graph from geometry',
                  run: async () => {
                    if (typeof api.buildRoutingGraph === 'function') {
                      await api.buildRoutingGraph();
                    } else if (dom.btnBuildRoutingGraph) {
                      dom.btnBuildRoutingGraph.click();
                    }
                  },
                },
              ],
              [
                {
                  id: 'tray.route-clear',
                  label: 'Clear Graph',
                  icon: 'tag-undo',
                  size: 'small',
                  keytip: 'ERC',
                  tooltip: 'Clear routing graph and overlays',
                  run: () => {
                    if (typeof api.clearRoutingGraph === 'function') {
                      api.clearRoutingGraph();
                    } else if (dom.btnClearRoutingGraph) {
                      dom.btnClearRoutingGraph.click();
                    }
                  },
                },
                {
                  id: 'tray.route-start',
                  label: 'Start Node',
                  icon: 'route-start',
                  size: 'small',
                  keytip: 'ERS',
                  tooltip: 'Set selected element as route start node',
                  run: () => {
                    if (typeof api.setRouteStart === 'function') {
                      api.setRouteStart();
                    } else if (dom.btnRouteStart) {
                      dom.btnRouteStart.click();
                    }
                  },
                },
                {
                  id: 'tray.route-end',
                  label: 'End Node',
                  icon: 'route-end',
                  size: 'small',
                  keytip: 'ERE',
                  tooltip: 'Set selected element as route end node',
                  run: () => {
                    if (typeof api.setRouteEnd === 'function') {
                      api.setRouteEnd();
                    } else if (dom.btnRouteEnd) {
                      dom.btnRouteEnd.click();
                    }
                  },
                },
                {
                  id: 'tray.route-calc',
                  label: 'Calculate',
                  icon: 'routing',
                  size: 'small',
                  keytip: 'ERR',
                  tooltip: 'Calculate shortest route between nodes',
                  run: async () => {
                    if (typeof api.calculateRoute === 'function') {
                      await api.calculateRoute();
                    } else if (dom.btnCalculateRoute) {
                      dom.btnCalculateRoute.click();
                    }
                  },
                },
              ],
            ],
          },
        ],
      },
    ],

    // ─────────────────────────────────────────────────────────
    // Contextual Tab: Modify | Tray System (CT)
    // ─────────────────────────────────────────────────────────
    contextual: [
      {
        id: 'modify-tray-system',
        label: 'MODIFY | TRAY SYSTEM',
        keytip: 'CT',
        groups: [
          {
            id: 'tray-system-actions',
            label: 'Tray System Actions',
            items: [
              [
                {
                  id: 'tray.systems-highlight',
                  label: 'Highlight\nSystem',
                  icon: 'highlight',
                  size: 'big',
                  keytip: 'CTH',
                  tooltip: 'Highlight selected tray system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.highlightSelectedTraySystem === 'function') {
                      await api.highlightSelectedTraySystem();
                    } else if (dom.btnManagerHighlight) {
                      dom.btnManagerHighlight.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-isolate',
                  label: 'Isolate\nSystem',
                  icon: 'isolate',
                  size: 'big',
                  keytip: 'CTI',
                  tooltip: 'Isolate selected tray system in 3D view',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.isolateSelectedTraySystem === 'function') {
                      await api.isolateSelectedTraySystem();
                    } else if (dom.btnManagerIsolate) {
                      dom.btnManagerIsolate.click();
                    }
                  },
                },
                {
                  id: 'tray.systems-continuity',
                  label: 'Check\nContinuity',
                  icon: 'continuity',
                  size: 'big',
                  keytip: 'CTC',
                  tooltip: 'Check continuity of selected tray system',
                  enabled: () => Boolean(ctx.selectedTraySystemTag),
                  run: async () => {
                    if (typeof api.checkSelectedTraySystemContinuity === 'function') {
                      await api.checkSelectedTraySystemContinuity();
                    } else if (dom.btnManagerCheckContinuity) {
                      dom.btnManagerCheckContinuity.click();
                    }
                  },
                },
              ],
            ],
          },
        ],
      },
    ],

    // ─────────────────────────────────────────────────────────
    // Status Bar Segments
    // ─────────────────────────────────────────────────────────
    statusSegments: [
      {
        id: 'selection-count',
        value: (c) => {
          const map = api.getSelectedModelIdMap?.();
          const count = map && api.countModelIdMapItems ? api.countModelIdMapItems(map) : (c.selectedIfcElement ? 1 : 0);
          return `Selection: ${count} element${count === 1 ? '' : 's'}`;
        },
      },
      {
        id: 'backend-mode',
        value: (c) => {
          const wasm = c?.trayBackends?.flags?.tagging || c?.trayBackends?.flags?.routing;
          return wasm ? 'WASM mode' : 'JS mode';
        },
      },
    ],
  };
}
