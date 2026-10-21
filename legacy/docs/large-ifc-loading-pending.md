# Large IFC loading — pending improvements

Saved 14 Oct 2026. Not implemented. Do these later.

The conduit viewer reads an IFC through `web-ifc` 0.0.77 inside the browser. That parser is 32-bit WebAssembly. Its heap stops at 4 GB (65,536 pages), and the library default `MEMORY_LIMIT` stops at 2 GB. `engine.loadIfc` in `src/covillaf/engine.js` also imports every attribute and relation, and the takeoff keeps the raw file in `sourceModel.buffer` for the session.

A new Rust IFC parser, or an Electron or Tauri shell around the current viewer, does not raise that ceiling. The Node build of web-ifc is the same 32-bit module.

## How Revizto opens a large model, and how this viewer does

| Step | Revizto | This viewer |
| --- | --- | --- |
| Where it runs | 64-bit desktop app | Browser tab. Parser is web-ifc 0.0.77 |
| What the large number is | A project on disk. The viewer loads parts | The IFC file itself, read into one buffer |
| Memory ceiling | Publish wants 64–128 GB of RAM. The view is limited by the graphics card | Wasm heap stops at 4 GB. The library default stops at 2 GB |
| Open sequence | Import or publish once, then open a scene of separate models | Hash the whole file, parse it, keep the raw bytes for the session |
| Properties | Empty object properties stay off unless turned on. Revizto says they bloat the project | Every open calls `addAllAttributes` and `addAllRelations` |
| What is drawn | Outer parts first. Interiors appear when you zoom or cut a section. Whole models can be unloaded | The fragment model stays in the scene |
| The next open | Opens the published scene | Parses the IFC again |
| A 12 GB open | Possible as a project on disk, with parts left unloaded | The file is larger than the parser heap, so the open fails |

Revizto sizes a normal machine for about a 2 GB model. Bigger projects are allowed. Publishing them is specified at 64–128 GB of RAM, because that step runs in a 64-bit process. After publish, the viewer stores separate models and, when video memory runs out, loads the outer shell first and leaves interiors unloaded until a zoom or a section. Models can also be unloaded on purpose.

A 5 GB IFC cannot be opened here. The file is read with `file.arrayBuffer()` before parsing, then copied into the wasm heap. Triangles are extra memory on top of those bytes. A 5 GB STEP file is already past the 4 GB heap, and the parsed model is larger than the file.

On a desktop, the size only goes up when a 64-bit native converter reads the IFC and the viewer draws tiles. Working memory during conversion is often several times the file size.

| Machine RAM | Raw IFC that can reasonably be converted |
| --- | --- |
| 16 GB | A few hundred MB, sometimes about 1 GB |
| 32 GB | About 1–2 GB |
| 64 GB | About 5 GB for a normal federated model |
| 128 GB | The 5–10 GB class, if the file is not one solid of heavy Booleans |

An 8–16 GB GPU still cannot hold every triangle from a file that size. The viewer has to keep only the tiles in view.

## Option B — do this in the current browser engine

These stay under the 4 GB cap. They make files that already open faster and lighter. They do not admit a 5 GB or 12 GB IFC.

- Load geometry only. Read properties when an element is selected, instead of `addAllAttributes()` and `addAllRelations()` on every open.
- Leave out openings, spaces, and annotations at load. They become meshes that conduit tracing does not pick against.
- Hash the file while geometry loads, then drop `sourceModel.buffer`. Today the SHA-256 runs first and the raw IFC stays in memory for the session.
- Use `web-ifc-mt.wasm`. It is already copied into the app and is not selected. It needs shared memory, which needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- Confirm `fragments.init("/covillaf/fragments/worker.mjs")` actually starts. If that setup fails, the same work falls back onto the page thread. Hide models that are not being traced. `engine.hider` is already on the engine.

## Option A — months, the Revizto-shaped path

Publish outside the tab. A 64-bit converter such as IfcOpenShell, on a machine with 64–128 GB of RAM, writes a tile cache. The viewer opens that cache, draws the shell first, and brings interiors in when the camera gets close or a section is cut. The conduit tracing stays. The new work is the publisher, the cache, and those load rules.

That reaches about 5 GB on a 64 GB machine. A 12 GB project can sit on disk when only the tiles in view are drawn. Sheets, issues, clash, and live sync are a different product and are not part of this item.

## Sources

- `src/covillaf/engine.js` load path, and the takeoff open path in `conduit-takeoff/src/main.js`.
- `node_modules/web-ifc` 0.0.77: wasm memory `maximum: 65536` pages, `MEMORY_LIMIT: 2147483648`.
- Revizto help: system requirements, importing models from files, and priorities for loading model parts.
