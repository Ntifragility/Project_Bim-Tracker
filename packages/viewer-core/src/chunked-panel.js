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
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0) return;
    try {
      const transport = createLocalFolderTransport(files);
      const { manifest } = await manager.openBundle(transport);
      collapsed = false;
      onStatus?.(`Opened chunked bundle '${manifest.sourceName}' (${manifest.chunks.length} chunks). Check any floor to load.`);
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
