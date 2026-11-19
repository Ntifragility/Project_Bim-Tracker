// Drag-guarded right-click Revizto viewport context menu for Conduit Takeoff.
// Distinguishes right-drag orbit (> 4px move) from right-click menu cleanly.
import * as THREE from 'three';

function getSelectedRunBounds(state, drawingTool) {
  if (state?.selectedRunId == null) return null;
  if (drawingTool?.getRunBounds) {
    const toolBox = drawingTool.getRunBounds(state.selectedRunId);
    if (toolBox && !toolBox.isEmpty()) return toolBox;
  }
  const run = state?.network?.runs?.find((r) => r.id === state.selectedRunId);
  if (!run || !Array.isArray(run.nodeIds) || run.nodeIds.length === 0) return null;
  const nodes = state.network.nodes || {};
  const box = new THREE.Box3();
  let count = 0;
  for (const nid of run.nodeIds) {
    const node = Array.isArray(nodes) ? nodes.find((n) => n.id === nid) : nodes[nid];
    if (!node) continue;
    const x = Number(node.x);
    const y = Number(node.y);
    const z = Number(node.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      box.expandByPoint(new THREE.Vector3(x, y, z));
      count++;
    }
  }
  return count > 0 && !box.isEmpty() ? box : null;
}

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

    if (els.contextFocusItem) els.contextFocusItem.hidden = !selected;
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
      (els.contextFocusItem?.hidden ?? true) &&
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
    const moved = rightDownPos ? Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y) : 0;
    rightDownPos = null;
    if (moved > 4) {
      e.preventDefault();
      return; // Right-drag orbit gesture — do not pop menu
    }

    close();
    const anyVisible = updateActions();
    if (!anyVisible) return;

    e.preventDefault();
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - rect.height - 8))}px`;
    const firstVisible = [
      els.contextFocusItem,
      els.contextHideItem,
      els.contextUnhideAll,
      els.contextIsolateItem,
      els.contextIsolateGhost,
      els.contextSectionBox,
      els.contextShowAll,
    ].filter(Boolean).find((btn) => !btn.hidden);
    firstVisible?.focus?.();
  });

  els.contextFocusItem?.addEventListener('click', async () => {
    close();
    const ifcSel = engine.highlighter?.selection?.select || {};
    const hasIfc = Object.values(ifcSel).some((ids) =>
      ids instanceof Set ? ids.size > 0 : Array.isArray(ids) ? ids.length > 0 : false,
    );
    if (hasIfc && typeof engine.focusOnSelection === 'function') {
      await engine.focusOnSelection(ifcSel);
      return;
    }
    const runBox = getSelectedRunBounds(state, drawingTool);
    if (runBox && typeof engine.focusOnBox === 'function') {
      engine.focusOnBox(runBox);
    }
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
  window.addEventListener('resize', close);

  return { close };
}
