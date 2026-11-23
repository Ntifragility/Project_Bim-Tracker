# SVF2-Lite Chunked Streaming — Session Handoff

**Branch:** `viewer/svf2-lite-chunks`
**Worktree:** `C:\Users\Marco Villafuerte\Desktop\wt-svf2-lite`
**Original Repo (untouched):** `C:\Users\Marco Villafuerte\Desktop\Project_Bim_Tracker` (`viewer/cpp-ifc2frag`)

## What Was Built & Verified
1. **Native 64-bit C++ Compiler (`tools/ifc2frag-cpp/build/ifc2frag.exe`):**
   - Unified `AutoBundle` default: `< 50 MB` IFC → 1-chunk `.fragbundle/`; `≥ 50 MB` IFC → `Principal Structure` (~12.5% tris) + 8–12 X-Z `Zone A1..` detail chunks + `manifest.json` v1 (`--single` CLI flag kept if needed).
   - Lossless speedups: parallel Stage 4 chunk packing & zlib compression (up to 3 threads, deterministic order), zero-allocation quantized integer transform hashing, and low-RAM multi-threaded welding (4 threads, 16-shell batch on `> 250 MB` IFCs).
   - Opt-in `--skip-fasteners` (and double-click YES/NO prompt) to skip `IFCFASTENER` & `IFCMECHANICALFASTENER` before `web-ifc` tessellation.
   - `frag_schema_parity_test.exe`: **7/7 passed**.

2. **Viewer-Core Streaming & Telemetry (`packages/viewer-core/src/`):**
   - `chunked-loader.js`: `createLocalFolderTransport`, `createChunkedModelManager`, `isPrincipalChunk`, `selectChunksForCamera` (150 ms debounce, 25% border hysteresis, working-distance thresholds, unload-first RAM discipline).
   - `chunked-panel.js`: Shared bottom-left chunk panel with **Auto-Stream (Camera)** defaulting to **ON** on multi-chunk bundles, `AUTO` / `📌` badges, and clean emoji-free `showDesktopCompilerModal`.
   - `perf-hud.js`: Live Perf & Resources HUD with `−` / `+` minimize button.
   - `vite-plugin.js`: Serves local `tools/ifc2frag-cpp/build/ifc2frag.exe` at `/covillaf/downloads/ifc2frag.exe` in dev mode; production falls back to `VITE_COMPILER_DOWNLOAD_URL` or `https://github.com/Ntifragility/Project_Bim-Tracker/releases/latest`.

3. **App Integration (Conduit Takeoff & Cable Tray Viewer):**
   - Both apps mount `mountChunkedBundlePanel` + `mountPerfHud`, replace old dev-only *"Compile IFC → .frag"* ribbon button with **Desktop Compiler**, guard accidental `manifest.json` picks in Open Native IFC, and warn on `> 200 MB` raw IFCs.
   - Cable Tray Viewer preserves **Open Native IFC** as primary for tray tagging & Safe IFC export.
   - `npm test`: **171/171 passed**; `npm run build` & `npm run build:conduit`: **both passed**.

## Real Benchmark (2 GB Steel IFC → `226.3 MB` `.frag`)
| Metric | Full `.frag` | SVF2-Lite Chunked (`1/13` Principal) |
|---|---|---|
| Load time | `8,153 ms` | **`1,411 ms`** (5.8× faster) |
| FPS | `55 fps` (pop-in) | **`60 fps` locked** (crisp) |
| JS Heap | `519.6 MB` | **`128.1 MB`** (4.1× less) |

## Next Steps When Resuming
1. **Live-test Auto-Stream ON by default** on the 2 GB steel `.fragbundle` (and benchmark `--skip-fasteners` compile speed & size).
2. **Dynamic Chunk Sync with Conduit Tools:** ensure Section Box/Planes, Surface Snapping, Elevation Picker, Hide/Isolate, and Project Save/Resume stay synced as chunks stream in/out.
3. **Cloud URL Transport + IndexedDB Cache:** plug an HTTP transport (`createHttpBundleTransport`) into `chunked-loader.js` for zero-click Cloudflare R2 / SharePoint loading (eliminates browser folder-upload prompt).
4. **Publish `ifc2frag.exe` to GitHub Releases** (`Ntifragility/Project_Bim-Tracker`) and open/merge PR for `viewer/svf2-lite-chunks` → `main`.
