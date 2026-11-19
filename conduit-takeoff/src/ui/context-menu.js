// Drag-guarded right-click viewport context menu for Conduit Takeoff.
// Distinguishes right-drag orbit (> 4px move) from right-click menu cleanly.
import * as THREE from 'three';

function getSelectedRunBounds(state) {
  if (state?.selectedRunId == null || !state?.network?.runs) return null;
  const run = state.network.runs.find((r) => r.id === state.selectedRunId);
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

export function initConduitContextMenu({ state, els, engine }) {
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
    if (els.contextFocusItem) els.contextFocusItem.hidden = !selected;
    return !(els.contextFocusItem?.hidden ?? true);
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
    els.contextFocusItem?.focus?.();
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
    const runBox = getSelectedRunBounds(state);
    if (runBox && typeof engine.focusOnBox === 'function') {
      engine.focusOnBox(runBox);
    }
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
