// src/ui/session-autosave.js
// Tier 1 Browser Session Auto-Save & Auto-Restore for Cable Tray Tag Edits.
//
// - Debounced IndexedDB persistence on every tag mutation (commitProjection).
// - Flushes on pagehide / visibilitychange so no edits are lost on close/reload.
// - Warns before accidental F5 / tab close when unsaved tag edits exist.
// - Automatically restores cached tags when the same IFC / .frag model is re-opened,
//   showing a clean, non-blocking recovery banner with a 1-click "Clear Cache" action.

import {
  computeSessionKey,
  normalizeModelBaseName,
  serializeTagSession,
  reconcileRestoredTags,
  createTagSessionStore,
} from '../tagging/session-cache.js';
import { getAssignmentKey } from './helpers.js';

function formatRelativeAge(timestampMs) {
  const diffSec = Math.max(0, Math.round((Date.now() - Number(timestampMs || 0)) / 1000));
  if (diffSec < 60) return 'just now';
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function initSessionAutosave(ctx, dom, api) {
  const store = createTagSessionStore();
  let saveTimer = null;
  let bannerTimer = null;
  let bannerEl = null;

  function dismissBanner() {
    if (bannerTimer) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
  }

  function showRecoveryBanner({ modelName, count, updatedAt, onClear }) {
    if (typeof document === 'undefined') return;
    dismissBanner();

    const ribbon = document.getElementById('ribbon');
    const topPx = ribbon ? Math.ceil(ribbon.getBoundingClientRect().bottom) + 12 : 160;

    const el = document.createElement('div');
    el.id = 'tray-session-restore-banner';
    el.style.cssText =
      `position:fixed;top:${topPx}px;right:18px;z-index:130;display:flex;align-items:center;gap:10px;` +
      'background:rgba(15,23,42,0.96);color:#e2e8f0;border:1px solid #38bdf8;border-radius:7px;' +
      'padding:8px 12px;font:12px/1.3 system-ui,-apple-system,sans-serif;' +
      'box-shadow:0 10px 26px rgba(0,0,0,0.45);backdrop-filter:blur(8px);max-width:460px;';

    for (const ev of ['pointerdown', 'pointerup', 'click']) {
      el.addEventListener(ev, (e) => e.stopPropagation());
    }

    const msg = document.createElement('span');
    msg.textContent = `Restored ${count} cached tag${count === 1 ? '' : 's'} for ${modelName} (saved ${formatRelativeAge(updatedAt)}).`;

    const btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.textContent = 'Clear Cache';
    btnClear.style.cssText =
      'background:#1e293b;color:#fca5a5;border:1px solid #7f1d1d;border-radius:4px;' +
      'padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';
    btnClear.addEventListener('click', async () => {
      dismissBanner();
      await onClear?.();
    });

    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.textContent = '✕';
    btnClose.title = 'Dismiss';
    btnClose.style.cssText =
      'background:transparent;color:#94a3b8;border:none;font-size:13px;cursor:pointer;padding:0 2px;';
    btnClose.addEventListener('click', dismissBanner);

    el.append(msg, btnClear, btnClose);
    (document.getElementById('app') || document.body).appendChild(el);
    bannerEl = el;

    bannerTimer = setTimeout(dismissBanner, 9000);
  }

  function getModelMetaForId(modelId) {
    const entry = api.findLoadedModelEntry?.(modelId);
    if (!entry) return null;
    const byteLength = Number(entry.byteLength || entry.sourceIfcBytes?.byteLength || 0);
    const name = entry.name || modelId;
    return {
      modelId: entry.model?.modelId || entry.model?.uuid || entry.uuid || modelId,
      modelName: name,
      byteLength,
      sessionKey: computeSessionKey(name, byteLength),
      baseName: normalizeModelBaseName(name),
    };
  }

  async function flushSaveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    const pattern = api.taggingAuxBar?.getPattern?.() || null;
    const hideTaggedActive = Boolean(api.taggingAuxBar?.isHideTaggedActive?.());

    // Group current assignments by modelId so multi-model sessions stay clean
    const modelIds = new Set();
    for (const entry of ctx.loadedModels || []) {
      const id = entry.model?.modelId || entry.model?.uuid || entry.uuid;
      if (id) modelIds.add(id);
    }
    for (const assignment of ctx.tagAssignments.values()) {
      if (assignment?.modelId) modelIds.add(assignment.modelId);
    }

    for (const modelId of modelIds) {
      const meta = getModelMetaForId(modelId);
      if (!meta) continue;
      const record = serializeTagSession({
        sessionKey: meta.sessionKey,
        modelName: meta.modelName,
        byteLength: meta.byteLength,
        modelId,
        tagAssignments: ctx.tagAssignments,
        pattern,
        hideTaggedActive,
      });

      if (record.tags.length === 0) {
        await store.remove(meta.sessionKey, meta.baseName);
      } else {
        await store.save(record);
      }
    }
  }

  function scheduleSave(delayMs = 400) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flushSaveNow();
    }, delayMs);
  }

  async function clearCachedSessionForModel(modelEntry) {
    if (!modelEntry) return;
    const modelId = modelEntry.model?.modelId || modelEntry.model?.uuid || modelEntry.uuid;
    const byteLength = Number(modelEntry.byteLength || modelEntry.sourceIfcBytes?.byteLength || 0);
    const sessionKey = computeSessionKey(modelEntry.name, byteLength);
    const baseName = normalizeModelBaseName(modelEntry.name);

    await store.remove(sessionKey, baseName);

    // Clear in-memory pending tags for this model
    for (const [key, assignment] of Array.from(ctx.tagAssignments.entries())) {
      if (assignment?.modelId === modelId) {
        ctx.tagAssignments.delete(key);
      }
    }

    api.renderExcelTable?.();
    api.updateTagAssignmentUi?.(`Cleared cached tags for ${modelEntry.name}.`, 'success');
    api.refreshTaggedTrayHighlights?.();
    api.refreshFloatingLabels?.();
    api.refreshSelectedPropertiesTag?.();
    api.taggingAuxBar?.syncHideTaggedFilterLayer?.();
    api.taggingAuxBar?.syncUi?.();
    api.reviztoToolbar?.update?.();
    api.refreshRibbon?.();
  }

  async function restoreForModelEntry(modelEntry) {
    if (!modelEntry?.model) return 0;
    const modelId = modelEntry.model.modelId || modelEntry.model.uuid || modelEntry.uuid;
    const byteLength = Number(modelEntry.byteLength || modelEntry.sourceIfcBytes?.byteLength || 0);
    const sessionKey = computeSessionKey(modelEntry.name, byteLength);
    const baseName = normalizeModelBaseName(modelEntry.name);

    // Match strictly by exact sessionKey (name::byteLength) when byteLength > 0 so an older
    // cached session from a previous file never overwrites a newly exported *_edited.ifc file.
    const saved = byteLength > 0
      ? await store.load(sessionKey, '')
      : await store.load(sessionKey, baseName);
    if (!saved || !Array.isArray(saved.tags) || saved.tags.length === 0) {
      return 0;
    }

    const restored = reconcileRestoredTags(saved.tags, {
      modelId,
      modelName: modelEntry.name,
    });
    if (restored.length === 0) return 0;

    for (const assignment of restored) {
      const key = getAssignmentKey(assignment.modelId, assignment.localId);
      ctx.tagAssignments.set(key, assignment);
    }

    if (saved.pattern) {
      api.taggingAuxBar?.applyPattern?.(saved.pattern);
    }

    api.renderExcelTable?.();
    api.updateTagAssignmentUi?.(
      `Restored ${restored.length} cached tag${restored.length === 1 ? '' : 's'} for ${modelEntry.name}.`,
      'success',
    );
    await api.refreshTaggedTrayHighlights?.();
    await api.refreshFloatingLabels?.();
    api.taggingAuxBar?.syncUi?.();
    api.reviztoToolbar?.update?.();
    api.refreshRibbon?.();

    showRecoveryBanner({
      modelName: modelEntry.name,
      count: restored.length,
      updatedAt: saved.updatedAt,
      onClear: () => clearCachedSessionForModel(modelEntry),
    });

    return restored.length;
  }

  // Lifecycle listeners: flush on hide/close + warn before accidental reload with unsaved tags
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      void flushSaveNow();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushSaveNow();
      }
    });
    window.addEventListener('beforeunload', (event) => {
      const hasEdits =
        (ctx.tagAssignments?.size || 0) > 0 ||
        (ctx.pendingIfcPropertyEdits?.size || 0) > 0 ||
        (ctx.pendingIfcColorEdits?.size || 0) > 0;
      if (hasEdits) {
        void flushSaveNow();
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  const autosaveApi = {
    scheduleSave,
    flushSaveNow,
    restoreForModelEntry,
    clearCachedSessionForModel,
  };

  api.sessionAutosave = autosaveApi;
  return autosaveApi;
}
