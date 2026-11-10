// Global Escape handler for the tray viewer.
//
// One document-level keydown listener (capture phase) implementing the
// Revit-ribbon ESC chain. Runs BEFORE the legacy per-dialog listeners in
// context-menu.js and helpers.js (both bubble-phase, neither calls
// stopPropagation), so each ESC press dismisses exactly one layer in order
// and the legacy listeners then see an already-hidden target and no-op.
//
// Chain (first match wins, one layer per keypress):
//  (1) Typing guard — focus is inside an <input>/<textarea>/<select> or a
//      contenteditable element: blur it only, dismiss nothing. This protects
//      every sidebar/tagging toggle-adjacent text field and prevents ESC
//      from clearing checkbox state (grid/wireframe/dark/labels never change).
//      Exception: the tag-replace dialog is modal — its Cancel path still
//      closes it even when a button inside it has focus.
//  (2) Dialogs, front-to-back: tagReplaceDialog (via its Cancel button, so
//      the pending promise resolves) → viewerContextMenu (via
//      api.closeViewerContextMenu) → viewerSettingsPanel (hidden = true) →
//      batchPreviewPanel / tagValidationReport (batch keeps staged tags;
//      preview hide only). The loading overlay is NEVER dismissible.
//  (3) Tray has no draw/polygon tool, so nothing to cancel here.
//  (4) Non-empty selection or active isolation → highlighter.clear('select'),
//      which fans out through selection.js onClear (nulls activeModel /
//      selectedIfcElement / currentSelectionMap, clears traySelection and
//      batch preview, resets element properties).
//  (5) A selected tray-system highlight (ctx.selectedTraySystemTag set
//      without a viewer selection) → clear the tag highlight state only.
//  (6) Otherwise: never touch sidebar tabs, tagging tabs, or checkboxes.
//
// Wiring: exported for the bootstrap. The integrator adds ONE line in
// src/main.js after `menu.wireContextMenu()` (context menu must exist so
// api.closeViewerContextMenu is registered before ESC can call it):
//   import { initEscapeHandler } from './ui/escape-handler.js';
//   initEscapeHandler(ctx, dom, api);
// main.js is owned by another task, so this module ships unwired and the
// callsite is documented here + in the PR (state this clearly in the PR).

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 * @returns {{ destroy: () => void }} handle to detach the listener (tests)
 */
export function initEscapeHandler(ctx, dom, api) {
  function isTypingTarget(target) {
    if (!target || target === document.body) return false;
    if (typeof target.isContentEditable === 'boolean' && target.isContentEditable) return true;
    const tag = String(target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function isLoadingVisible() {
    if (!dom.loadingOverlay) return false;
    // index.html default: style="display: none"; showLoader sets 'flex'.
    if (dom.loadingOverlay.style.display && dom.loadingOverlay.style.display !== 'none') return true;
    return !dom.loadingOverlay.hidden && getComputedStyle(dom.loadingOverlay).display !== 'none';
  }

  function hasViewerSelection() {
    try {
      if (typeof api.getSelectedModelIdMap === 'function' && typeof api.countModelIdMapItems === 'function') {
        return api.countModelIdMapItems(api.getSelectedModelIdMap()) > 0;
      }
    } catch {
      return false;
    }
    return Boolean(ctx.selectedIfcElement)
      || (ctx.traySelection instanceof Map && ctx.traySelection.size > 0);
  }

  function areKeytipsVisible() {
    if (typeof document !== 'undefined') {
      if (document.body?.hasAttribute('data-keytips')) return true;
      if (document.getElementById('ribbon')?.hasAttribute('data-keytips')) return true;
    }
    return Boolean(api.ribbon?.keytipsVisible || api.keytipsVisible);
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (event.defaultPrevented) return;

    // (0) R5: If ribbon keytips are visible, ribbon dismisses them first.
    if (areKeytipsVisible()) {
      event.preventDefault();
      if (typeof api.setKeytipsVisible === 'function') {
        api.setKeytipsVisible(false);
      } else if (typeof document !== 'undefined') {
        document.body?.removeAttribute('data-keytips');
        document.getElementById('ribbon')?.removeAttribute('data-keytips');
      }
      return;
    }

    const replaceOpen = dom.tagReplaceDialog && !dom.tagReplaceDialog.hidden;

    // (1) Typing guard: blur only. Modal replace-dialog Cancel still works
    // because the click target is a button, not a typing target.
    if (!replaceOpen && isTypingTarget(event.target)) {
      if (typeof event.target.blur === 'function') event.target.blur();
      return;
    }

    // (2a) Replace dialog: click Cancel so the pending promise resolves
    // (helpers.js requestTagReplacement finish(false)).
    if (replaceOpen) {
      event.preventDefault();
      if (typeof dom.tagReplaceCancel?.click === 'function') dom.tagReplaceCancel.click();
      else dom.tagReplaceDialog.hidden = true;
      return;
    }

    // (2b) Context menu.
    if (dom.viewerContextMenu && !dom.viewerContextMenu.hidden) {
      event.preventDefault();
      if (typeof api.closeViewerContextMenu === 'function') api.closeViewerContextMenu();
      else dom.viewerContextMenu.hidden = true;
      return;
    }

    // (2c) Viewer settings popover.
    if (dom.viewerSettingsPanel && !dom.viewerSettingsPanel.hidden) {
      event.preventDefault();
      dom.viewerSettingsPanel.hidden = true;
      if (dom.btnViewerSettings) dom.btnViewerSettings.setAttribute('aria-expanded', 'false');
      return;
    }

    // (2d) Batch preview / tag validation report (hide only; staged tags
    // and batch assignments are kept).
    if (dom.batchPreviewPanel && !dom.batchPreviewPanel.hidden) {
      event.preventDefault();
      if (typeof api.clearBatchPreview === 'function') api.clearBatchPreview();
      else dom.batchPreviewPanel.hidden = true;
      return;
    }
    if (dom.tagValidationReport && !dom.tagValidationReport.hidden) {
      event.preventDefault();
      dom.tagValidationReport.hidden = true;
      return;
    }

    // Loading overlay: never dismissible — ESC during load does nothing.
    if (isLoadingVisible()) return;

    // (3) No draw tool on tray — nothing to cancel.

    // (4) Non-empty selection or active isolation → clear via highlighter
    // (selection.js onClear fan-out handles the rest).
    if (hasViewerSelection() || ctx.isolationActive) {
      event.preventDefault();
      try {
        const cleared = ctx.highlighter?.clear?.('select');
        if (cleared && typeof cleared.catch === 'function') {
          cleared.catch(() => {});
        }
      } catch {
        // Highlighter unavailable (e.g. unit tests) — ignore.
      }
      return;
    }

    // (5) Tray-system highlight with no viewer selection → clear the tag
    // highlight state only.
    if (ctx.selectedTraySystemTag) {
      event.preventDefault();
      ctx.selectedTraySystemTag = '';
      if (typeof api.hideContextual === 'function') {
        api.hideContextual();
      }
      if (typeof api.renderTraySystemManager === 'function') {
        api.renderTraySystemManager();
      }
      if (typeof api.updateTagAssignmentUi === 'function') {
        try {
          api.updateTagAssignmentUi();
        } catch {
          // UI refresh is best-effort during teardown.
        }
      }
      return;
    }

    // (6) Otherwise: do nothing — sidebar tabs, tagging tabs and checkboxes
    // are never touched by ESC.
  }

  document.addEventListener('keydown', onKeyDown, true);

  return {
    destroy() {
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };
}
