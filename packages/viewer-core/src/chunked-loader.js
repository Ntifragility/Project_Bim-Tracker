// packages/viewer-core/src/chunked-loader.js
// SVF2-Lite Chunked .frag Bundle Manager (shared by Conduit Takeoff & Tray Viewer).
// Pluggable transport design: Local / OneDrive-synced folder works offline right now;
// cloud transports (Cloudflare R2 / SharePoint / Google Drive) plug into the exact same interface.

import * as THREE from "three";
import { createBundleCache } from "./bundle-cache.js";

/**
 * Normalizes a cloud/HTTP .fragbundle URL (accepts folder URL with or without trailing slash,
 * or direct manifest.json URL) into a clean base URL without trailing slash.
 */
export function normalizeBundleBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    throw new Error("Bundle URL cannot be empty.");
  }
  const stripped = trimmed.replace(/\/manifest\.json(\?.*)?$/i, "").replace(/\/+$/, "");
  return stripped;
}

/**
 * HTTP / Cloud URL transport for .fragbundle folders hosted on Cloudflare R2, S3,
 * SharePoint/OneDrive CORS links, or any static web server, with automatic IndexedDB caching.
 */
export function createHttpBundleTransport(
  bundleUrl,
  {
    fetchImpl = typeof fetch === "function" ? fetch.bind(globalThis) : null,
    cache = createBundleCache(),
    onCacheHit = null,
    headers = undefined,
  } = {},
) {
  const baseUrl = normalizeBundleBaseUrl(bundleUrl);
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch API is unavailable for HTTP bundle transport.");
  }

  return {
    kind: "http-url",
    baseUrl,
    cache,
    async readManifest() {
      const manifestUrl = `${baseUrl}/manifest.json`;
      const cacheKey = `${baseUrl}::manifest.json`;
      try {
        const res = await fetchImpl(manifestUrl, { cache: "no-cache", headers });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} fetching ${manifestUrl}`);
        }
        const text = await res.text();
        if (cache) {
          try { await cache.put(cacheKey, new TextEncoder().encode(text)); } catch { /* noop */ }
        }
        return JSON.parse(text);
      } catch (err) {
        if (cache) {
          const cached = await cache.get(cacheKey);
          if (cached) {
            onCacheHit?.("manifest.json", cached.byteLength);
            return JSON.parse(new TextDecoder().decode(cached));
          }
        }
        throw err;
      }
    },
    async readChunkBytes(filename) {
      const cleanName = String(filename || "").replace(/^\/+/, "");
      const cacheKey = `${baseUrl}::${cleanName}`;
      if (cache) {
        const cached = await cache.get(cacheKey);
        if (cached && cached.byteLength > 0) {
          onCacheHit?.(cleanName, cached.byteLength);
          return cached;
        }
      }
      const chunkUrl = `${baseUrl}/${encodeURI(cleanName)}`;
      const res = await fetchImpl(chunkUrl, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching chunk '${cleanName}'`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (cache) {
        cache.put(cacheKey, bytes).catch(() => {});
      }
      return bytes;
    },
  };
}

/**
 * Local / OneDrive-synced folder transport from <input webkitdirectory> or dropped File[].
 * Never reads .frag bytes until `readChunkBytes(filename)` is explicitly called.
 */
export function createLocalFolderTransport(fileList) {
  const files = Array.from(fileList || []);
  const byName = new Map();
  let manifestFile = null;

  for (const f of files) {
    const rawName = (f.webkitRelativePath || f.name || "").replace(/\\/g, "/");
    const base = rawName.split("/").pop();
    if (!base) continue;
    byName.set(base.toLowerCase(), f);
    if (base.toLowerCase() === "manifest.json") {
      manifestFile = f;
    }
  }

  return {
    kind: "local-folder",
    async readManifest() {
      if (!manifestFile) {
        throw new Error("Selected folder does not contain manifest.json (expected a .fragbundle folder).");
      }
      const text = await manifestFile.text();
      return JSON.parse(text);
    },
    async readChunkBytes(filename) {
      const f = byName.get(String(filename || "").toLowerCase());
      if (!f) {
        throw new Error(`Chunk file '${filename}' not found in selected bundle folder.`);
      }
      return new Uint8Array(await f.arrayBuffer());
    },
  };
}

/**
 * Validates a manifest.json object produced by `ifc2frag.exe --split-by-storey` / `--split-by-category`.
 */
export function validateBundleManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Invalid manifest.json: expected JSON object.");
  }
  if (manifest.format !== "fragbundle" || !Array.isArray(manifest.chunks)) {
    throw new Error("Unsupported manifest.json: expected format === 'fragbundle' and chunks[].");
  }
  return manifest;
}

/**
 * Computes a THREE.Box3 from a chunk's manifest bbox ({ min: [x,y,z], max: [x,y,z] }).
 */
export function chunkBboxToBox3(bbox) {
  if (!bbox || !Array.isArray(bbox.min) || !Array.isArray(bbox.max)) return null;
  const min = new THREE.Vector3(Number(bbox.min[0]), Number(bbox.min[1]), Number(bbox.min[2]));
  const max = new THREE.Vector3(Number(bbox.max[0]), Number(bbox.max[1]), Number(bbox.max[2]));
  if (
    !Number.isFinite(min.x) || !Number.isFinite(min.y) || !Number.isFinite(min.z) ||
    !Number.isFinite(max.x) || !Number.isFinite(max.y) || !Number.isFinite(max.z)
  ) {
    return null;
  }
  const box = new THREE.Box3(min, max);
  return box.isEmpty() ? null : box;
}

/**
 * Identifies whether a manifest chunk is the always-on Tier 0 Principal Structure
 * (or base overview chunk) that Auto-Stream should never auto-unload.
 */
export function isPrincipalChunk(chunk, index = 0, manifest = null) {
  if (!chunk) return false;
  if (chunk.tier === 0 || chunk.isPrincipal === true) return true;
  const id = String(chunk.id || "").toLowerCase();
  const name = String(chunk.name || "").toLowerCase();
  if (id === "principal-structure" || id.startsWith("principal") || name.startsWith("principal")) {
    return true;
  }
  if (index === 0 && manifest?.splitMode === "spatial") return true;
  return false;
}

/**
 * Pure spatial selector for Auto-Stream by Camera.
 * Given manifest chunks and the current camera position + look-at target,
 * returns which detail chunk IDs should be loaded (up to `maxActiveDetailChunks`).
 *
 * - Never includes the Principal Structure (Tier 0 stays on independently).
 * - When zoomed far out looking at the whole plant, returns an empty set so overview stays 60 fps.
 * - Uses hysteresis so panning along a zone border doesn't thrash load/unload.
 */
export function selectChunksForCamera(
  chunks,
  cameraPos,
  cameraTarget = null,
  {
    manifest = null,
    maxActiveDetailChunks = 2,
    currentlyLoadedIds = new Set(),
    zoomOutThresholdFactor = 3.2,
    hysteresisMargin = 0.25,
    minActivationRadiusM = 60,
  } = {},
) {
  const desiredIds = new Set();
  if (!Array.isArray(chunks) || chunks.length === 0 || !cameraPos) {
    return { desiredIds, zoomedOut: false, nearestChunk: null, viewDistance: 0 };
  }

  const camVec = new THREE.Vector3(
    Number(cameraPos.x) || 0,
    Number(cameraPos.y) || 0,
    Number(cameraPos.z) || 0,
  );
  const tgtVec = cameraTarget
    ? new THREE.Vector3(
        Number(cameraTarget.x) || 0,
        Number(cameraTarget.y) || 0,
        Number(cameraTarget.z) || 0,
      )
    : camVec.clone();

  const candidates = [];
  const diags = [];

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    if (isPrincipalChunk(ch, i, manifest)) continue;
    const box = chunkBboxToBox3(ch.bbox);
    if (!box) continue;
    const size = new THREE.Vector3();
    box.getSize(size);
    const diag = Math.max(size.length(), 1);
    diags.push(diag);

    const distTarget = box.distanceToPoint(tgtVec);
    const distCam = box.distanceToPoint(camVec);
    const effectiveDist = Math.min(distTarget, distCam);
    const isLoaded = currentlyLoadedIds.has(ch.id);
    // Hysteresis: already-loaded zones get a distance bonus so border panning doesn't thrash
    const score = isLoaded ? effectiveDist * (1 - hysteresisMargin) : effectiveDist;

    candidates.push({ chunk: ch, box, diag, distTarget, distCam, effectiveDist, score });
  }

  if (candidates.length === 0) {
    return { desiredIds, zoomedOut: false, nearestChunk: null, viewDistance: camVec.distanceTo(tgtVec) };
  }

  diags.sort((a, b) => a - b);
  const medianDiag = diags[Math.floor(diags.length / 2)] || 20;
  const viewDistance = camVec.distanceTo(tgtVec);

  candidates.sort((a, b) => a.score - b.score);
  const nearest = candidates[0];

  // Zoomed-out overview guard: only skip detail chunks when zoomed far out overlooking the entire plant
  if (
    cameraTarget &&
    viewDistance > medianDiag * zoomOutThresholdFactor &&
    nearest.distCam > medianDiag * 2.0
  ) {
    return { desiredIds, zoomedOut: true, nearestChunk: nearest.chunk, viewDistance };
  }

  const maxRange = Math.max(medianDiag * 2.5, minActivationRadiusM);
  const limit = Math.max(1, Number(maxActiveDetailChunks) || 2);

  for (const c of candidates) {
    if (desiredIds.size >= limit) break;
    if (c.effectiveDist <= maxRange) {
      desiredIds.add(c.chunk.id);
    }
  }

  return { desiredIds, zoomedOut: false, nearestChunk: nearest.chunk, viewDistance };
}

/**
 * Reads the current camera position & look-at target from a viewer-core engine.
 */
function readEngineCameraPose(engine) {
  const cam = engine?.world?.camera?.three;
  if (!cam?.position) return null;
  const pos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };

  const controls = engine?.world?.camera?.controls;
  let target = null;
  if (controls) {
    try {
      if (typeof controls.getTarget === "function") {
        const tmp = new THREE.Vector3();
        controls.getTarget(tmp);
        if (Number.isFinite(tmp.x) && Number.isFinite(tmp.y) && Number.isFinite(tmp.z)) {
          target = { x: tmp.x, y: tmp.y, z: tmp.z };
        }
      } else if (controls.target) {
        target = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
      }
    } catch { /* fallback to camera pos */ }
  }
  return { pos, target };
}

/**
 * Creates a reactive on-demand chunk loader/unloader bound to a viewer-core engine,
 * with optional Auto-Stream by Camera (defaults to OFF for pure Principal Structure tracing).
 */
export function createChunkedModelManager({
  engine,
  onChange = null,
  autoStreamDebounceMs = 150,
  maxActiveDetailChunks = 2,
} = {}) {
  let activeTransport = null;
  let activeManifest = null;
  const loadedChunks = new Map(); // chunkId -> { model, modelId, chunk }
  const loadingChunks = new Set(); // chunkId
  const pinnedChunks = new Set(); // chunkId manually checked by user (never auto-unloaded)
  const autoLoadedChunks = new Set(); // chunkId loaded automatically by camera streamer
  const listeners = new Set();
  if (typeof onChange === "function") listeners.add(onChange);

  // Auto-Stream state
  let autoStreamEnabled = false;
  let autoStreamZoomedOut = false;
  let autoStreamTimer = null;
  let autoStreamBoundControls = null;
  let reconciling = false;
  let reconcileQueued = false;

  function getState() {
    const chunks = (activeManifest?.chunks || []).map((ch, idx) => ({
      ...ch,
      isPrincipal: isPrincipalChunk(ch, idx, activeManifest),
      loaded: loadedChunks.has(ch.id),
      loading: loadingChunks.has(ch.id),
      pinned: pinnedChunks.has(ch.id),
      autoLoaded: autoLoadedChunks.has(ch.id),
    }));
    let loadedCompressedBytes = 0;
    let totalCompressedBytes = 0;
    for (const ch of chunks) {
      const b = Number(ch.compressedBytes) || 0;
      totalCompressedBytes += b;
      if (ch.loaded) loadedCompressedBytes += b;
    }
    const autoActiveNames = chunks
      .filter((c) => c.autoLoaded && c.loaded)
      .map((c) => c.name);
    return {
      active: Boolean(activeManifest),
      manifest: activeManifest,
      transportKind: activeTransport?.kind || null,
      bundleUrl: activeTransport?.baseUrl || null,
      chunks,
      loadedCount: loadedChunks.size,
      totalCount: chunks.length,
      loadedCompressedBytes,
      totalCompressedBytes,
      autoStreamEnabled,
      autoStreamZoomedOut,
      autoActiveNames,
      maxActiveDetailChunks,
    };
  }

  function notify() {
    const snap = getState();
    for (const cb of listeners) {
      try { cb(snap); } catch (err) { console.warn("[chunked-loader] listener error:", err); }
    }
  }

  async function disposeLoadedChunk(entry) {
    const { model, modelId } = entry;
    const obj = model?.object || model;
    if (obj) {
      try { engine?.section?.unregisterClippedObject?.(obj); } catch { /* noop */ }
      if (engine?.world?.scene?.three) {
        try { engine.world.scene.three.remove(obj); } catch { /* noop */ }
      }
    }
    try { engine?.visibility?.clearModelState?.(modelId); } catch { /* noop */ }
    try {
      if (typeof engine?.fragments?.core?.disposeModel === "function") {
        await engine.fragments.core.disposeModel(modelId);
      } else if (typeof model?.dispose === "function") {
        await model.dispose();
      }
    } catch (err) {
      console.warn(`[chunked-loader] disposeModel('${modelId}') warning:`, err);
    }
  }

  function detachAutoStreamListeners() {
    if (autoStreamTimer) {
      clearTimeout(autoStreamTimer);
      autoStreamTimer = null;
    }
    if (autoStreamBoundControls) {
      try {
        autoStreamBoundControls.removeEventListener?.("rest", onCameraMoved);
        autoStreamBoundControls.removeEventListener?.("controlend", onCameraMoved);
        autoStreamBoundControls.removeEventListener?.("update", onCameraMoved);
      } catch { /* noop */ }
      autoStreamBoundControls = null;
    }
  }

  function onCameraMoved() {
    if (!autoStreamEnabled || !activeManifest) return;
    if (autoStreamTimer) clearTimeout(autoStreamTimer);
    autoStreamTimer = setTimeout(() => {
      autoStreamTimer = null;
      reconcileCameraChunks();
    }, autoStreamDebounceMs);
  }

  function attachAutoStreamListeners() {
    detachAutoStreamListeners();
    const controls = engine?.world?.camera?.controls;
    if (!controls || typeof controls.addEventListener !== "function") return;
    autoStreamBoundControls = controls;
    controls.addEventListener("rest", onCameraMoved);
    controls.addEventListener("controlend", onCameraMoved);
    controls.addEventListener("update", onCameraMoved);
  }

  async function reconcileCameraChunks(overridePose = null) {
    if (!autoStreamEnabled || !activeManifest || !activeTransport) return;
    if (reconciling) {
      reconcileQueued = true;
      return;
    }
    reconciling = true;
    try {
      const pose = overridePose || readEngineCameraPose(engine);
      if (!pose) return;

      const { desiredIds, zoomedOut } = selectChunksForCamera(
        activeManifest.chunks,
        pose.pos,
        pose.target,
        {
          manifest: activeManifest,
          maxActiveDetailChunks,
          currentlyLoadedIds: new Set(loadedChunks.keys()),
        },
      );
      autoStreamZoomedOut = zoomedOut;

      // 1. Unload auto-loaded (unpinned, non-principal) chunks that are no longer desired FIRST to free RAM
      const toUnload = [];
      for (const chunkId of Array.from(autoLoadedChunks)) {
        if (pinnedChunks.has(chunkId)) continue;
        const idx = activeManifest.chunks.findIndex((c) => c.id === chunkId);
        if (idx >= 0 && isPrincipalChunk(activeManifest.chunks[idx], idx, activeManifest)) continue;
        if (!desiredIds.has(chunkId)) {
          toUnload.push(chunkId);
        }
      }
      for (const chunkId of toUnload) {
        autoLoadedChunks.delete(chunkId);
        await unloadChunk(chunkId);
      }

      // 2. Load newly desired chunks near camera
      for (const chunkId of desiredIds) {
        if (!autoStreamEnabled) break; // user turned it off mid-load
        if (loadedChunks.has(chunkId)) continue;
        try {
          await loadChunk(chunkId, { source: "auto" });
        } catch (err) {
          console.warn(`[chunked-loader] auto-stream load('${chunkId}') failed:`, err);
        }
      }

      notify();
    } finally {
      reconciling = false;
      if (reconcileQueued && autoStreamEnabled) {
        reconcileQueued = false;
        reconcileCameraChunks();
      }
    }
  }

  async function setAutoStream(enabled, { unloadAutoOnDisable = true } = {}) {
    const next = Boolean(enabled);
    if (next === autoStreamEnabled) return autoStreamEnabled;
    autoStreamEnabled = next;
    autoStreamZoomedOut = false;

    if (autoStreamEnabled) {
      attachAutoStreamListeners();
      notify();
      await reconcileCameraChunks();
    } else {
      detachAutoStreamListeners();
      if (unloadAutoOnDisable) {
        for (const chunkId of Array.from(autoLoadedChunks)) {
          autoLoadedChunks.delete(chunkId);
          if (!pinnedChunks.has(chunkId)) {
            await unloadChunk(chunkId);
          }
        }
      }
      notify();
    }
    return autoStreamEnabled;
  }

  async function closeBundle() {
    autoStreamEnabled = false;
    autoStreamZoomedOut = false;
    detachAutoStreamListeners();
    for (const entry of loadedChunks.values()) {
      await disposeLoadedChunk(entry);
    }
    loadedChunks.clear();
    loadingChunks.clear();
    pinnedChunks.clear();
    autoLoadedChunks.clear();
    activeTransport = null;
    activeManifest = null;
    notify();
  }

  async function openBundle(transport) {
    if (!transport || typeof transport.readManifest !== "function" || typeof transport.readChunkBytes !== "function") {
      throw new Error("Invalid bundle transport.");
    }
    await closeBundle();
    const manifest = validateBundleManifest(await transport.readManifest());
    activeTransport = transport;
    activeManifest = manifest;

    // Fit camera to the union bounding box of all chunks (without loading any .frag yet)
    const unionBox = new THREE.Box3();
    for (const ch of manifest.chunks) {
      const b = chunkBboxToBox3(ch.bbox);
      if (b) unionBox.union(b);
    }
    if (!unionBox.isEmpty() && typeof engine?.focusOnBox === "function") {
      engine.focusOnBox(unionBox);
    }

    notify();
    return { manifest, unionBox: unionBox.isEmpty() ? null : unionBox };
  }

  async function loadChunk(chunkId, { source = "manual" } = {}) {
    if (!activeManifest || !activeTransport) return null;
    if (loadedChunks.has(chunkId)) {
      if (source === "manual") {
        pinnedChunks.add(chunkId);
        autoLoadedChunks.delete(chunkId);
        notify();
      }
      return loadedChunks.get(chunkId).model;
    }
    if (loadingChunks.has(chunkId)) return null;

    const chunk = activeManifest.chunks.find((c) => c.id === chunkId);
    if (!chunk) throw new Error(`Unknown chunk id '${chunkId}'.`);

    loadingChunks.add(chunkId);
    notify();
    try {
      const bytes = await activeTransport.readChunkBytes(chunk.file);
      const modelId = `chunk::${activeManifest.sourceName || "bundle"}::${chunk.id}`;
      const model = await engine.loadFrag(bytes, modelId);
      if (!model) throw new Error(`Failed to load chunk '${chunk.name}'.`);
      const obj = model.object || model;
      if (obj && engine?.world?.scene?.three && !engine.world.scene.three.children.includes(obj)) {
        engine.world.scene.three.add(obj);
      }
      // Dynamic Chunk Sync: keep Section Box/Planes, Raycast/Surface Snapping, and Isolation synced
      if (obj) {
        try { engine?.section?.registerClippedObject?.(modelId, obj); } catch { /* noop */ }
        try { engine?.section?.syncClipping?.(); } catch { /* noop */ }
      }
      try { engine?.fragments?.core?.update?.(true); } catch { /* noop */ }
      if (engine?.isolation?.isIsolated?.() && typeof engine?.visibility?.recomputeVisibility === "function") {
        try { await engine.visibility.recomputeVisibility(); } catch { /* noop */ }
      }
      loadedChunks.set(chunkId, { model, modelId, chunk });
      if (source === "auto") {
        autoLoadedChunks.add(chunkId);
      } else {
        pinnedChunks.add(chunkId);
        autoLoadedChunks.delete(chunkId);
      }
      loadingChunks.delete(chunkId);
      notify();
      return model;
    } catch (err) {
      loadingChunks.delete(chunkId);
      notify();
      throw err;
    }
  }

  async function unloadChunk(chunkId) {
    const entry = loadedChunks.get(chunkId);
    pinnedChunks.delete(chunkId);
    autoLoadedChunks.delete(chunkId);
    if (!entry) return false;
    loadedChunks.delete(chunkId);
    await disposeLoadedChunk(entry);
    notify();
    return true;
  }

  async function toggleChunk(chunkId) {
    if (loadedChunks.has(chunkId)) {
      await unloadChunk(chunkId);
      return false;
    }
    await loadChunk(chunkId, { source: "manual" });
    return true;
  }

  function focusChunk(chunkId) {
    if (!activeManifest) return false;
    const chunk = activeManifest.chunks.find((c) => c.id === chunkId);
    if (!chunk) return false;
    const box = chunkBboxToBox3(chunk.bbox);
    if (!box || typeof engine?.focusOnBox !== "function") return false;
    engine.focusOnBox(box);
    return true;
  }

  function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return {
    openBundle,
    closeBundle,
    loadChunk,
    unloadChunk,
    toggleChunk,
    focusChunk,
    setAutoStream,
    reconcileCameraChunks,
    getState,
    subscribe,
  };
}
