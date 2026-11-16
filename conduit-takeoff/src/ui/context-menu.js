// Drag-guarded right-click Revizto viewport context menu for Conduit Takeoff.
// Distinguishes right-drag orbit (> 4px move) from right-click menu cleanly.

export function initConduitContextMenu({ state, els, engine, drawingTool }) {
  const menu = els.viewerContextMenu;
  if (!menu || !els.viewerContainer) {
    return { close() {} };
  }

  let rightDownPos = null;

  function close() {
    menu.hidden = true;
  }

  function hasAnySelection() {
    const ifcSel = engine.highlighter?.selection?.select || {};
    const hasIfc = Object.values(ifcSel).some((ids) =>
      ids instanceof Set ? ids.size > 0 : Array.isArray(ids) ? ids.length > 0 : false,
    );
    return hasIfc || state.selectedRunId != null;
  }

  function updateActions() {
    const selected = hasAnySelection();
    const hiddenCount = engine.visibility?.getHiddenCount?.() ?? 0;
    const isolated = engine.isolation?.isIsolated?.() ?? false;

    if (els.contextHideItem) els.contextHideItem.hidden = !selected;
    if (els.contextUnhideAll) {
      els.contextUnhideAll.hidden = hiddenCount === 0;
      els.contextUnhideAll.textContent = `👁 Unhide All (${hiddenCount})`;
    }
    if (els.contextIsolateItem) els.contextIsolateItem.hidden = !selected;
    if (els.contextIsolateGhost) els.contextIsolateGhost.hidden = !selected;
    if (els.contextSectionBox) els.contextSectionBox.hidden = !selected;
    if (els.contextShowAll) els.contextShowAll.hidden = !isolated && hiddenCount === 0;

    return !(
      (els.contextHideItem?.hidden ?? true) &&
      (els.contextUnhideAll?.hidden ?? true) &&
      (els.contextIsolateItem?.hidden ?? true) &&
      (els.contextIsolateGhost?.hidden ?? true) &&
      (els.contextSectionBox?.hidden ?? true) &&
      (els.contextShowAll?.hidden ?? true)
    );
  }

  els.viewerContainer.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      rightDownPos = { x: e.clientX, y: e.clientY };
    }
  });

  els.viewerContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const moved = rightDownPos ? Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y) : 0;
    rightDownPos = null;
    if (moved > 4) return; // Right-drag orbit gesture — do not pop menu

    close();
    const anyVisible = updateActions();
    if (!anyVisible) return;

    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - rect.height - 8))}px`;
  });

  els.contextHideItem?.addEventListener('click', async () => {
    close();
    await engine.visibility?.hideSelection?.();
  });

  els.contextUnhideAll?.addEventListener('click', async () => {
    close();
    await engine.visibility?.unhideAll?.();
  });

  els.contextIsolateItem?.addEventListener('click', async () => {
    close();
    await engine.isolation?.hardIsolate?.();
  });

  els.contextIsolateGhost?.addEventListener('click', async () => {
    close();
    await engine.isolation?.ghostIsolate?.();
  });

  els.contextSectionBox?.addEventListener('click', async () => {
    close();
    const sel = engine.highlighter?.selection?.select || {};
    const hasIfc = Object.values(sel).some((ids) => (ids?.size ?? ids?.length ?? 0) > 0);
    if (hasIfc) {
      await engine.section?.setBoxToSelection?.(sel);
    } else if (state.selectedRunId != null && drawingTool?.getRunBounds) {
      const box = drawingTool.getRunBounds(state.selectedRunId);
      if (box && !box.isEmpty()) {
        engine.section?.setMode?.('box');
        engine.section?.setBoxBounds?.(box);
      }
    } else {
      await engine.section?.setBoxToModel?.();
    }
  });

  els.contextShowAll?.addEventListener('click', async () => {
    close();
    await engine.isolation?.resetIsolation?.();
    await engine.visibility?.unhideAll?.();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('blur', close);

  return { close };
}
