// packages/viewer-core/src/zone-grid-overlay.js
// Optional 3D Zone Grid Overlay for SVF2-Lite chunked bundles.
// Draws faint floor outlines + short labels (A1, B2...) for each spatial detail zone,
// live-colored by load state (cyan = auto-loaded, green = pinned, slate = unloaded),
// and lets the user click any zone rectangle in 3D to toggle/pin it.

import * as THREE from "three";
import { chunkBboxToBox3, isPrincipalChunk } from "./chunked-loader.js";

const COLORS = {
  auto: { border: 0x38bdf8, fill: 0x0ea5e9, fillOpacity: 0.14, badgeBg: "rgba(14,165,233,0.88)", badgeFg: "#082f49" },
  pinned: { border: 0x22c55e, fill: 0x16a34a, fillOpacity: 0.16, badgeBg: "rgba(34,197,94,0.88)", badgeFg: "#052e16" },
  unloaded: { border: 0x64748b, fill: 0x475569, fillOpacity: 0.05, badgeBg: "rgba(15,23,42,0.82)", badgeFg: "#cbd5e1" },
};

/**
 * Pure helper: computes floor-plane rectangles for all non-principal chunks with valid bboxes.
 */
export function computeZoneFloorRects(chunks, manifest = null) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const raw = [];
  let minY = Infinity;

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    if (isPrincipalChunk(ch, i, manifest) || ch.isPrincipal) continue;
    const box = chunkBboxToBox3(ch.bbox);
    if (!box) continue;
    if (box.min.y < minY) minY = box.min.y;
    const width = Math.max(0.5, box.max.x - box.min.x);
    const depth = Math.max(0.5, box.max.z - box.min.z);
    const shortLabel = String(ch.name || ch.id || "")
      .replace(/^zone\s+/i, "")
      .trim() || ch.id;
    raw.push({
      id: ch.id,
      name: ch.name || ch.id,
      shortLabel,
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
      width,
      depth,
      centerX: (box.min.x + box.max.x) * 0.5,
      centerZ: (box.min.z + box.max.z) * 0.5,
      loaded: Boolean(ch.loaded),
      autoLoaded: Boolean(ch.autoLoaded),
      pinned: Boolean(ch.pinned),
    });
  }

  const floorY = Number.isFinite(minY) ? minY + 0.05 : 0.05;
  return raw.map((r) => ({ ...r, y: floorY }));
}

function makeLabelSprite(text, palette, scaleWidth) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = palette.badgeBg;
  ctx.beginPath();
  ctx.roundRect?.(16, 16, 224, 64, 14);
  if (!ctx.roundRect) ctx.rect(16, 16, 224, 64);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = palette.badgeFg;
  ctx.font = "700 38px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text).slice(0, 10), 128, 50);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const w = Math.max(2.5, Math.min(scaleWidth * 0.32, 12));
  sprite.scale.set(w, w * (96 / 256), 1);
  sprite.renderOrder = 60;
  return { sprite, tex, mat };
}

/**
 * Creates a toggleable 3D floor-grid overlay bound to a ChunkedModelManager and viewer-core engine.
 * Starts hidden (`visible = false`) with zero GPU overhead until enabled.
 */
export function createZoneGridOverlay({ engine, manager, container = null, onToggleZone = null } = {}) {
  let visible = false;
  let rootGroup = null;
  const hitMeshes = [];
  const disposables = [];
  let downPos = null;

  function paletteFor(rect) {
    if (rect.loaded && rect.autoLoaded) return COLORS.auto;
    if (rect.loaded) return COLORS.pinned;
    return COLORS.unloaded;
  }

  function clearSceneGroup() {
    if (rootGroup && engine?.world?.scene?.three) {
      try { engine.world.scene.three.remove(rootGroup); } catch { /* noop */ }
    }
    for (const d of disposables) {
      try { d.dispose?.(); } catch { /* noop */ }
    }
    disposables.length = 0;
    hitMeshes.length = 0;
    rootGroup = null;
  }

  function rebuild(state = manager?.getState?.()) {
    clearSceneGroup();
    if (!visible || !state?.active || !engine?.world?.scene?.three) return;

    const rects = computeZoneFloorRects(state.chunks, state.manifest);
    if (rects.length === 0) return;

    rootGroup = new THREE.Group();
    rootGroup.name = "CovillafZoneGridOverlay";

    for (const r of rects) {
      const pal = paletteFor(r);

      // 1. Translucent clickable floor fill
      const planeGeo = new THREE.PlaneGeometry(r.width, r.depth);
      planeGeo.rotateX(-Math.PI / 2);
      const planeMat = new THREE.MeshBasicMaterial({
        color: pal.fill,
        transparent: true,
        opacity: pal.fillOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const fillMesh = new THREE.Mesh(planeGeo, planeMat);
      fillMesh.position.set(r.centerX, r.y, r.centerZ);
      fillMesh.userData = { zoneChunkId: r.id, zoneName: r.name };
      fillMesh.renderOrder = 55;
      rootGroup.add(fillMesh);
      hitMeshes.push(fillMesh);
      disposables.push(planeGeo, planeMat);

      // 2. Crisp border outline
      const hw = r.width * 0.5;
      const hd = r.depth * 0.5;
      const pts = [
        new THREE.Vector3(r.centerX - hw, r.y + 0.02, r.centerZ - hd),
        new THREE.Vector3(r.centerX + hw, r.y + 0.02, r.centerZ - hd),
        new THREE.Vector3(r.centerX + hw, r.y + 0.02, r.centerZ + hd),
        new THREE.Vector3(r.centerX - hw, r.y + 0.02, r.centerZ + hd),
      ];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({ color: pal.border, transparent: true, opacity: 0.9 });
      const loop = new THREE.LineLoop(lineGeo, lineMat);
      loop.renderOrder = 56;
      rootGroup.add(loop);
      disposables.push(lineGeo, lineMat);

      // 3. Billboard label (A1, B2, ...)
      const label = makeLabelSprite(r.shortLabel, pal, Math.min(r.width, r.depth));
      if (label) {
        label.sprite.position.set(r.centerX, r.y + 0.8, r.centerZ);
        rootGroup.add(label.sprite);
        disposables.push(label.tex, label.mat);
      }
    }

    engine.world.scene.three.add(rootGroup);
  }

  function onPointerDown(ev) {
    if (!visible || ev.button !== 0) return;
    downPos = { x: ev.clientX, y: ev.clientY };
  }

  function onPointerUp(ev) {
    if (!visible || ev.button !== 0 || !downPos || hitMeshes.length === 0) return;
    const dist = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
    downPos = null;
    if (dist > 5) return; // Ignore orbit/pan drags

    const cam = engine?.world?.camera?.three;
    if (!cam || !container) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    if (hits.length > 0) {
      const chunkId = hits[0].object?.userData?.zoneChunkId;
      const chunkName = hits[0].object?.userData?.zoneName || chunkId;
      if (chunkId && manager) {
        manager.toggleChunk(chunkId).then((loaded) => {
          onToggleZone?.({ chunkId, chunkName, loaded });
        }).catch(() => {});
      }
    }
  }

  if (container && typeof container.addEventListener === "function") {
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerup", onPointerUp);
  }

  const unsub = manager?.subscribe?.((st) => {
    if (!st.active) {
      visible = false;
      clearSceneGroup();
      return;
    }
    if (visible) rebuild(st);
  });

  return {
    isVisible() {
      return visible;
    },
    setVisible(next) {
      visible = Boolean(next);
      rebuild();
      return visible;
    },
    toggle() {
      return this.setVisible(!visible);
    },
    dispose() {
      visible = false;
      clearSceneGroup();
      unsub?.();
      if (container && typeof container.removeEventListener === "function") {
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointerup", onPointerUp);
      }
    },
  };
}
