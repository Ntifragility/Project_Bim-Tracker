// packages/viewer-core/src/chunked-panel.js
// Shared SVF2-Lite Chunked Bundle UI panel (works identically in Conduit Takeoff & Cable Tray Viewer).
// Zero regression to single-file .frag / .ifc workflows.

import { createLocalFolderTransport, createChunkedModelManager } from "./chunked-loader.js";

function fmtMb(bytes) {
  const mb = (Number(bytes) || 0) / (1024 * 1024);
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}

export function mountChunkedBundlePanel(container, { engine, onStatus = null } = {}) {
  if (!container || typeof document === "undefined" || !engine) return null;
  if (container.querySelector("#svf2-chunk-host")) return null;

  const manager = createChunkedModelManager({ engine });

  const host = document.createElement("div");
  host.id = "svf2-chunk-host";
  host.style.cssText =
    "position:absolute;left:12px;bottom:12px;z-index:26;max-width:320px;min-width:220px;" +
    "background:rgba(15,23,42,0.88);color:#e2e8f0;border:1px solid rgba(148,163,184,0.3);" +
    "border-radius:8px;font:12px/1.35 system-ui,sans-serif;backdrop-filter:blur(8px);" +
    "box-shadow:0 8px 24px rgba(0,0,0,0.35);overflow:hidden;";

  // Stop canvas pointer events from leaking through the panel
  host.addEventListener("pointerdown", (e) => e.stopPropagation());
  host.addEventListener("wheel", (e) => e.stopPropagation());
  host.addEventListener("contextmenu", (e) => e.stopPropagation());

  const folderInput = document.createElement("input");
  folderInput.type = "file";
  folderInput.multiple = true;
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.setAttribute("directory", "");
  folderInput.style.display = "none";
  host.appendChild(folderInput);

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;" +
    "background:rgba(30,41,59,0.9);border-bottom:1px solid rgba(148,163,184,0.18);";
  host.appendChild(header);

  const body = document.createElement("div");
  body.style.cssText = "max-height:240px;overflow-y:auto;padding:6px 8px;display:none;";
  host.appendChild(body);

  let collapsed = false;

  function render(st) {
    header.innerHTML = "";
    if (!st.active) {
      body.style.display = "none";
      const btnOpen = document.createElement("button");
      btnOpen.type = "button";
      btnOpen.textContent = "📂 Open Chunked Bundle";
      btnOpen.title = "Open a .fragbundle folder (local or OneDrive/SharePoint synced) to stream floors on demand";
      btnOpen.style.cssText =
        "width:100%;background:#0ea5e9;color:#082f49;border:none;border-radius:5px;" +
        "padding:5px 10px;font-weight:600;font-size:12px;cursor:pointer;";
      btnOpen.addEventListener("click", () => folderInput.click());
      header.appendChild(btnOpen);
      return;
    }

    const titleWrap = document.createElement("div");
    titleWrap.style.cssText = "min-width:0;flex:1;";
    titleWrap.innerHTML =
      `<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${st.manifest.sourceName || "Bundle"}">` +
      `📦 ${st.manifest.sourceName || "Chunked Bundle"}</div>` +
      `<div style="font-size:10px;opacity:0.8;">Loaded: ${st.loadedCount}/${st.totalCount} (${fmtMb(st.loadedCompressedBytes)} / ${fmtMb(st.totalCompressedBytes)})</div>`;

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:4px;";

    const btnToggle = document.createElement("button");
    btnToggle.type = "button";
    btnToggle.textContent = collapsed ? "▲" : "▼";
    btnToggle.title = collapsed ? "Expand chunks" : "Collapse chunks";
    btnToggle.style.cssText = "background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:10px;";
    btnToggle.addEventListener("click", () => {
      collapsed = !collapsed;
      render(manager.getState());
    });

    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.textContent = "✕";
    btnClose.title = "Close bundle & free memory";
    btnClose.style.cssText = "background:#1e293b;color:#fca5a5;border:1px solid #334155;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:10px;";
    btnClose.addEventListener("click", async () => {
      await manager.closeBundle();
      onStatus?.("Closed chunked bundle and freed memory.");
    });

    actions.appendChild(btnToggle);
    actions.appendChild(btnClose);
    header.appendChild(titleWrap);
    header.appendChild(actions);

    body.style.display = collapsed ? "none" : "block";
    body.innerHTML = "";

    // Auto-Stream by Camera bar (only shown when bundle has > 1 chunk)
    if (st.totalCount > 1) {
      const autoBar = document.createElement("div");
      autoBar.style.cssText =
        "display:flex;flex-direction:column;gap:3px;padding:5px 6px;margin-bottom:5px;" +
        "border-radius:6px;background:rgba(30,41,59,0.75);border:1px solid rgba(148,163,184,0.18);";

      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";

      const autoLabel = document.createElement("span");
      autoLabel.style.cssText = "font-size:11px;font-weight:600;color:#e2e8f0;";
      autoLabel.textContent = "🔦 Auto-Stream (Camera)";
      autoLabel.title =
        "Automatically loads up to 2 detail zones closest to your camera when zoomed in, " +
        "and unloads far zones to save RAM. OFF = Principal Structure only.";

      const autoBtn = document.createElement("button");
      autoBtn.type = "button";
      autoBtn.dataset.testid = "svf2-autostream-toggle";
      autoBtn.textContent = st.autoStreamEnabled ? "ON" : "OFF";
      autoBtn.style.cssText = st.autoStreamEnabled
        ? "background:#0ea5e9;color:#082f49;border:1px solid #38bdf8;border-radius:999px;padding:1px 10px;font-size:10px;font-weight:700;cursor:pointer;"
        : "background:#1e293b;color:#94a3b8;border:1px solid #475569;border-radius:999px;padding:1px 10px;font-size:10px;font-weight:700;cursor:pointer;";
      autoBtn.addEventListener("click", async () => {
        const next = !st.autoStreamEnabled;
        onStatus?.(
          next
            ? "Auto-Stream ON — detail zones near camera will load automatically."
            : "Auto-Stream OFF — unloaded auto-streamed detail zones.",
        );
        await manager.setAutoStream(next);
      });

      topRow.appendChild(autoLabel);
      topRow.appendChild(autoBtn);
      autoBar.appendChild(topRow);

      const hint = document.createElement("div");
      hint.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.25;";
      if (!st.autoStreamEnabled) {
        hint.textContent = "OFF — Principal Structure only (fastest for conduit tracing)";
      } else if (st.autoStreamZoomedOut) {
        hint.textContent = "Zoomed out — Principal only (zoom in to stream bay details)";
      } else if (st.autoActiveNames.length > 0) {
        hint.textContent = `Streaming near camera: ${st.autoActiveNames.join(", ")}`;
      } else {
        hint.textContent = `Watching camera (max ${st.maxActiveDetailChunks} detail zones)`;
      }
      autoBar.appendChild(hint);
      body.appendChild(autoBar);
    }

    for (const ch of st.chunks) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 4px;" +
        "border-radius:4px;border-bottom:1px solid rgba(148,163,184,0.1);";

      const left = document.createElement("label");
      left.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;min-width:0;";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = ch.loaded;
      cb.disabled = ch.loading;
      cb.addEventListener("change", async () => {
        try {
          onStatus?.(cb.checked ? `Loading chunk ${ch.name} (${fmtMb(ch.compressedBytes)})…` : `Unloading ${ch.name}…`);
          await manager.toggleChunk(ch.id);
          onStatus?.(cb.checked ? `Loaded ${ch.name} (${ch.elements} elements).` : `Unloaded ${ch.name} (RAM freed).`);
        } catch (err) {
          console.error("[chunked-panel] toggleChunk error:", err);
          onStatus?.(`Chunk error: ${err?.message || err}`);
        }
      });

      const nameSpan = document.createElement("span");
      nameSpan.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;";
      nameSpan.textContent = ch.loading ? `${ch.name} (loading…)` : ch.name;
      nameSpan.title = `${ch.name} — ${ch.elements} elements, ${fmtMb(ch.compressedBytes)}`;

      left.appendChild(cb);
      left.appendChild(nameSpan);

      const right = document.createElement("div");
      right.style.cssText = "display:flex;align-items:center;gap:4px;flex-shrink:0;";

      if (ch.autoLoaded && ch.loaded) {
        const autoTag = document.createElement("span");
        autoTag.textContent = "AUTO";
        autoTag.title = "Auto-loaded by camera proximity (unloads automatically when you fly away)";
        autoTag.style.cssText =
          "font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;" +
          "background:rgba(14,165,233,0.22);color:#38bdf8;border:1px solid rgba(56,189,248,0.4);";
        right.appendChild(autoTag);
      } else if (st.autoStreamEnabled && ch.pinned && ch.loaded && !ch.isPrincipal) {
        const pinTag = document.createElement("span");
        pinTag.textContent = "📌";
        pinTag.title = "Pinned manually (won't be auto-unloaded by camera)";
        pinTag.style.cssText = "font-size:10px;";
        right.appendChild(pinTag);
      }

      const sizeBadge = document.createElement("span");
      sizeBadge.style.cssText = "font-size:10px;opacity:0.75;font-variant-numeric:tabular-nums;";
      sizeBadge.textContent = fmtMb(ch.compressedBytes);

      const focusBtn = document.createElement("button");
      focusBtn.type = "button";
      focusBtn.textContent = "🔍";
      focusBtn.title = `Focus camera on ${ch.name}`;
      focusBtn.style.cssText = "background:transparent;border:none;cursor:pointer;font-size:11px;padding:0 2px;";
      focusBtn.addEventListener("click", () => manager.focusChunk(ch.id));

      right.appendChild(sizeBadge);
      right.appendChild(focusBtn);

      row.appendChild(left);
      row.appendChild(right);
      body.appendChild(row);
    }
  }

  folderInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const transport = createLocalFolderTransport(files);
      const { manifest } = await manager.openBundle(transport);
      collapsed = false;
      onStatus?.(`Opened chunked bundle '${manifest.sourceName}' (${manifest.chunks.length} chunks). Loading first chunk…`);
      if (manifest.chunks.length > 0) {
        await manager.loadChunk(manifest.chunks[0].id);
        onStatus?.(`Loaded '${manifest.chunks[0].name}'. Use the bottom-left panel to load/unload more floors.`);
      }
    } catch (err) {
      console.error("[chunked-panel] openBundle error:", err);
      onStatus?.(`Bundle error: ${err?.message || err}`);
      alert(`Could not open chunked bundle: ${err?.message || err}`);
    }
  });

  manager.subscribe(render);
  render(manager.getState());
  container.appendChild(host);

  return {
    manager,
    openPicker() {
      folderInput.click();
    },
    dispose() {
      manager.closeBundle();
      host.remove();
    },
  };
}

/**
 * Shared modal explaining the hybrid Small-IFC (in-browser) / Large-IFC (ifc2frag.exe) workflow.
 * Works on any static host with zero backend dependency.
 */
export function showDesktopCompilerModal({
  onOpenBundle = null,
  downloadUrl = "",
} = {}) {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById("svf2-compiler-modal-backdrop");
  if (existing) existing.remove();

  const resolvedUrl =
    downloadUrl ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_COMPILER_DOWNLOAD_URL) ||
    "https://github.com/covillaf/Project_Bim_Tracker/releases/latest";

  const backdrop = document.createElement("div");
  backdrop.id = "svf2-compiler-modal-backdrop";
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(2,6,23,0.72);backdrop-filter:blur(4px);font:13px/1.45 system-ui,sans-serif;color:#e2e8f0;";

  const card = document.createElement("div");
  card.style.cssText =
    "width:min(480px,92vw);background:#0f172a;border:1px solid rgba(148,163,184,0.35);" +
    "border-radius:12px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,0.55);";

  card.innerHTML =
    `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">` +
      `<div style="font-size:15px;font-weight:700;color:#f8fafc;">⚡ Desktop IFC Compiler (ifc2frag.exe)</div>` +
      `<button type="button" data-action="close" style="background:transparent;border:none;color:#94a3b8;font-size:16px;cursor:pointer;">✕</button>` +
    `</div>` +
    `<p style="margin:0 0 10px;color:#cbd5e1;">Use our native 64-bit Windows compiler to turn large <strong>200 MB – 4 GB</strong> IFC models into fast <strong>.fragbundle</strong> folders that stream at 60 FPS in your browser.</p>` +
    `<div style="background:rgba(30,41,59,0.75);border:1px solid rgba(148,163,184,0.2);border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#cbd5e1;">` +
      `<div style="margin-bottom:6px;"><strong>• Small IFCs (&lt; 200 MB):</strong> Open directly via <em>Open Native IFC</em> — no compiler needed.</div>` +
      `<div style="margin-bottom:6px;"><strong>• Large IFCs (≥ 200 MB):</strong> Double-click <code>ifc2frag.exe</code>, select your <code>.ifc</code>, and it builds a <code>.fragbundle/</code> folder (Principal Structure + Spatial Zones, optional bolt/fastener skip).</div>` +
      `<div><strong>• View in Browser:</strong> Click <em>Open Chunked Bundle</em> and select the generated <code>.fragbundle</code> folder.</div>` +
    `</div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">` +
      `<a href="${resolvedUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;background:#0ea5e9;color:#082f49;font-weight:700;padding:7px 12px;border-radius:6px;font-size:12px;">⬇ Download ifc2frag.exe</a>` +
      (typeof onOpenBundle === "function"
        ? `<button type="button" data-action="open-bundle" style="background:#1e293b;color:#38bdf8;border:1px solid #38bdf8;font-weight:600;padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;">📂 Open Chunked Bundle</button>`
        : "") +
      `<button type="button" data-action="close" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;">Close</button>` +
    `</div>`;

  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  card.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener("click", close));
  const openBtn = card.querySelector('[data-action="open-bundle"]');
  if (openBtn && typeof onOpenBundle === "function") {
    openBtn.addEventListener("click", () => {
      close();
      onOpenBundle();
    });
  }

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
  return { close };
}
