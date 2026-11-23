// packages/viewer-core/src/perf-hud.js
// Live Hardware Resources & Loaded % Telemetry HUD for side-by-side Edge/Chrome comparison
// (Full monolithic .frag vs. SVF2-Lite Chunked .fragbundle).

function fmtMb(bytes) {
  const mb = (Number(bytes) || 0) / (1024 * 1024);
  return mb < 1 && mb > 0 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}

function fmtCount(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function estimateSceneGpuBytes(scene) {
  if (!scene || typeof scene.traverse !== "function") return 0;
  const seen = new Set();
  let total = 0;
  scene.traverse((obj) => {
    const geo = obj?.geometry;
    if (!geo || seen.has(geo)) return;
    seen.add(geo);
    if (geo.index?.array?.byteLength) total += geo.index.array.byteLength;
    const attrs = geo.attributes || {};
    for (const k of Object.keys(attrs)) {
      const len = attrs[k]?.array?.byteLength;
      if (len) total += len;
    }
  });
  return total;
}

export function mountPerfHud(container, { engine, chunkedManager = null, defaultOpen = true } = {}) {
  if (!container || typeof document === "undefined" || !engine) return null;
  if (container.querySelector("#svf2-perf-hud")) return null;

  const host = document.createElement("div");
  host.id = "svf2-perf-hud";
  host.style.cssText =
    "position:absolute;top:56px;right:12px;z-index:26;min-width:225px;max-width:265px;" +
    "background:rgba(15,23,42,0.88);color:#e2e8f0;border:1px solid rgba(148,163,184,0.3);" +
    "border-radius:8px;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;" +
    "backdrop-filter:blur(8px);box-shadow:0 8px 24px rgba(0,0,0,0.35);overflow:hidden;";

  host.addEventListener("pointerdown", (e) => e.stopPropagation());
  host.addEventListener("wheel", (e) => e.stopPropagation());
  host.addEventListener("contextmenu", (e) => e.stopPropagation());

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;" +
    "background:rgba(30,41,59,0.92);border-bottom:1px solid rgba(148,163,184,0.18);cursor:pointer;user-select:none;";

  const titleEl = document.createElement("span");
  titleEl.style.cssText = "font-weight:700;color:#38bdf8;";
  titleEl.textContent = "📊 Perf & Resources";

  const rightWrap = document.createElement("div");
  rightWrap.style.cssText = "display:flex;align-items:center;gap:5px;";

  const modeBadge = document.createElement("span");
  modeBadge.style.cssText =
    "font-size:10px;padding:1px 5px;border-radius:4px;background:#1e293b;color:#94a3b8;border:1px solid #334155;";
  modeBadge.textContent = "IDLE";

  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.title = defaultOpen ? "Minimize Perf & Resources" : "Expand Perf & Resources";
  minBtn.textContent = defaultOpen ? "−" : "+";
  minBtn.style.cssText =
    "background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;" +
    "width:18px;height:18px;line-height:14px;text-align:center;cursor:pointer;font-weight:700;padding:0;";

  rightWrap.appendChild(modeBadge);
  rightWrap.appendChild(minBtn);

  header.appendChild(titleEl);
  header.appendChild(rightWrap);
  host.appendChild(header);

  const body = document.createElement("div");
  body.style.cssText = `padding:7px 9px;display:${defaultOpen ? "block" : "none"};`;
  host.appendChild(body);

  let open = Boolean(defaultOpen);
  function toggleOpen() {
    open = !open;
    body.style.display = open ? "block" : "none";
    minBtn.textContent = open ? "−" : "+";
    minBtn.title = open ? "Minimize Perf & Resources" : "Expand Perf & Resources";
    host.style.minWidth = open ? "225px" : "auto";
    if (open) updateHud();
  }
  minBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleOpen();
  });
  header.addEventListener("click", toggleOpen);

  // Rolling FPS tracker (independent rAF, zero interference with engine)
  const frameTimes = [];
  let rafId = null;
  let lastFrameTs = performance.now();
  function onFrame(now) {
    const dt = now - lastFrameTs;
    lastFrameTs = now;
    if (dt > 0 && dt < 2000) {
      frameTimes.push(dt);
      if (frameTimes.length > 30) frameTimes.shift();
    }
    rafId = requestAnimationFrame(onFrame);
  }
  rafId = requestAnimationFrame(onFrame);

  let cachedGpuBytes = 0;
  let lastGpuScanAt = 0;

  function updateHud() {
    const chunkState = chunkedManager?.getState?.();
    const mono = engine.getLastLoadStats?.() || null;

    let modeLabel = "IDLE";
    let modeColor = "#94a3b8";
    let loadedPct = 0;
    let loadedBytes = 0;
    let totalBytes = 0;
    let loadTimeMs = 0;
    let detailLabel = "No model loaded";

    if (chunkState?.active) {
      modeLabel = `CHUNKED ${chunkState.loadedCount}/${chunkState.totalCount}`;
      modeColor = "#34d399";
      loadedBytes = chunkState.loadedCompressedBytes;
      totalBytes = chunkState.totalCompressedBytes;
      loadedPct = totalBytes > 0 ? Math.min(100, (loadedBytes * 100) / totalBytes) : 0;
      loadTimeMs = mono?.lastChunkMs || 0;
      detailLabel = `${chunkState.manifest?.sourceName || "Bundle"}`;
    } else if (mono && mono.bytes > 0) {
      modeLabel = "FULL .FRAG";
      modeColor = "#f59e0b";
      loadedBytes = mono.bytes;
      totalBytes = mono.bytes;
      loadedPct = 100;
      loadTimeMs = mono.elapsedMs || 0;
      detailLabel = mono.name || "model.frag";
    }

    modeBadge.textContent = modeLabel;
    modeBadge.style.color = modeColor;

    if (!open) return;

    const avgDt = frameTimes.length > 0
      ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      : 0;
    const fps = avgDt > 0 ? 1000 / avgDt : 0;

    const rInfo = engine.world?.renderer?.three?.info;
    const drawCalls = rInfo?.render?.calls ?? 0;
    const triangles = rInfo?.render?.triangles ?? 0;
    const geoCount = rInfo?.memory?.geometries ?? 0;
    const texCount = rInfo?.memory?.textures ?? 0;

    const now = performance.now();
    if (now - lastGpuScanAt >= 1200) {
      lastGpuScanAt = now;
      cachedGpuBytes = estimateSceneGpuBytes(engine.world?.scene?.three);
    }

    const mem = performance?.memory;
    const heapStr = mem
      ? `${fmtMb(mem.usedJSHeapSize)} / ${fmtMb(mem.jsHeapSizeLimit)}`
      : "N/A (non-Chromium)";

    body.innerHTML =
      `<div style="margin-bottom:6px;">` +
      `  <div style="display:flex;justify-content:space-between;margin-bottom:2px;">` +
      `    <span style="opacity:0.8;">Loaded File</span>` +
      `    <strong style="color:${modeColor};">${loadedPct.toFixed(1)}%</strong>` +
      `  </div>` +
      `  <div style="height:5px;background:#1e293b;border-radius:3px;overflow:hidden;margin-bottom:3px;">` +
      `    <div style="height:100%;width:${loadedPct.toFixed(1)}%;background:${modeColor};transition:width 0.2s;"></div>` +
      `  </div>` +
      `  <div style="font-size:10px;opacity:0.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${detailLabel}">` +
      `    ${fmtMb(loadedBytes)} / ${fmtMb(totalBytes)}${loadTimeMs ? ` • ${Math.round(loadTimeMs)} ms` : ""}` +
      `  </div>` +
      `</div>` +
      `<div style="display:grid;grid-template-columns:1fr auto;gap:2px 8px;border-top:1px solid rgba(148,163,184,0.16);padding-top:5px;">` +
      `  <span style="opacity:0.75;">FPS / Frame</span><strong>${fps.toFixed(0)} fps (${avgDt.toFixed(1)} ms)</strong>` +
      `  <span style="opacity:0.75;">Triangles</span><strong>${fmtCount(triangles)}</strong>` +
      `  <span style="opacity:0.75;">Draw Calls</span><strong>${drawCalls}</strong>` +
      `  <span style="opacity:0.75;">GPU Buffers</span><strong>${fmtMb(cachedGpuBytes)} (${geoCount}g/${texCount}t)</strong>` +
      `  <span style="opacity:0.75;">JS Heap RAM</span><strong>${heapStr}</strong>` +
      `</div>` +
      `<div style="margin-top:5px;font-size:9px;opacity:0.6;border-top:1px solid rgba(148,163,184,0.12);padding-top:4px;">` +
      `  Tip: Press Shift+Esc in Edge/Chrome for full Worker + GPU process RAM.` +
      `</div>`;
  }

  const timerId = setInterval(updateHud, 400);
  const unsub = chunkedManager?.subscribe?.(() => updateHud());
  updateHud();
  container.appendChild(host);

  return {
    dispose() {
      clearInterval(timerId);
      if (rafId != null) cancelAnimationFrame(rafId);
      unsub?.();
      host.remove();
    },
  };
}
