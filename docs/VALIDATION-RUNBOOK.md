# Validation runbook: headed-browser + real-model pass (manual)

Status: living checklist. Who: owner, manual click-through (no Playwright).
Why: CI and headless gates are green, but no headed browser has ever run the
apps, and no real (non-synthetic) IFC has been loaded since the rewrite.
Do Gate A first; B and C in any order after. Record everything in
`docs/validation-results.md` (template at the bottom of this file).

Conventions: `[ ]` = unchecked box the owner ticks. `FAIL` = stop the gate,
paste the console text, file a blocker per line. Real IFCs stay out of git
(`*.ifc` is gitignored): copy them into `public/fixtures/` temporarily and
delete afterwards. Never commit model content, only filenames.

## 0. Prerequisites (once, ~15 min)

1. Merge #61 (`infra/ci-harness`) — CI must be green on `main` after it.
2. On a clean checkout of `main`:
   `npm ci && npm test` — expect 94/94.
3. `wasm-pack build bindings/conduit-wasm --target bundler` and
   `wasm-pack build bindings/tray-wasm --target bundler`
   (needed for the wasm-flag paths; `pkg/` is gitignored, rebuild per machine).
4. `npm run build` and `npm run build:conduit`.
5. Serve both apps (two terminals):
   `npx serve dist -p 5173` and `npx serve conduit-takeoff/dist -p 5174`
   (or `npx vite preview --port 5173` from root / conduit-takeoff).
6. Sanity-fetch (curl or browser address bar):
   - `http://localhost:5173/fixtures/survey-box.ifc` starts with
     `ISO-10303-21;` and contains `Box A`.
   - `http://localhost:5174/fixtures/survey-box.ifc` — same
     (conduit `publicDir` share fix; if 404, the fix regressed — FAIL).
   - `web-ifc.wasm` returns 200 on both ports.

## Gate A — synthetic fixture (survey-box.ifc, both apps)

### A1. Tray app: `http://localhost:5173/?ifc=/fixtures/survey-box.ifc`

- [ ] Model loads, camera fits the two boxes, no console errors.
- [ ] Click Box A: properties panel shows identity + psets; selection highlights.
- [ ] Console (dev): `__covillaf` engine present; `pick` returns `{point, normal, original}` with `original` Z-up metres.
- [ ] Appearance: paint a color, then `appearanceHistory.undo()` restores; hide then unhide works.
- [ ] Ghost: `ghostIsolate` faint non-selected, solid kept; `resetIsolation` restores full visibility.
- [ ] Section plane: create plane, geometry clips, pick on the clipped region returns null, `deletePlane` restores.
- [ ] `capturePng` / `downloadPng` downloads a valid PNG.
- [ ] Coordinates: `lengthOriginal` on a known pair sane; `frame()` shows `{up:'Z', units:'m'}`.
- [ ] Reload with `?ifc=/fixtures/survey-box.ifc&tagging=wasm&routing=wasm`: console shows `tagging=wasm, routing=wasm`, no fallback warning; tagging workbench opens (empty set is OK — the fixture has no trays, expect graceful empty, not a throw).

### A2. Conduit app: `http://localhost:5174/?ifc=/fixtures/survey-box.ifc`

- [ ] Loads; camera presets fit/top/front/right move the camera.
- [ ] Trace 2 runs manually: runs list renders, summary shows lengths/sticks, bend badges render.
- [ ] Save `.conduit.json`, reload page, load it back: same runs restored.
- [ ] CSV export and overlay IFC export download.
- [ ] Reload with `?ifc=/fixtures/survey-box.ifc&core=wasm`: console shows `compute backend: wasm`; retrace the same runs; length/sticks EQUAL the JS-path numbers (record both).
- [ ] Reload without flag: console shows `compute backend: js`.

## Gate B — your generic IFCs (no tray/conduit content expected)

For EACH of your IFC files (temp copy to `public/fixtures/`, delete after):

- [ ] Tray `?ifc=/fixtures/<yours>.ifc` loads without throw; schema label correct (IFC2X3/IFC4).
- [ ] Click 3 arbitrary elements: highlight + properties render, no `ReferenceError`.
- [ ] Batch tagging preview on a generic selection: expect graceful empty/ambiguous (classifier refuses with a message, no crash) — record the message.
- [ ] `selectAssembly` / `selectSimilar`: returns at least the source element, app doesn't hang.
- [ ] Safe-editor accept: stage `BIM_TRACKER_EDIT.ReviewStatus=Approved` on one element, export: `*_edited.ifc` downloads, source file byte-identical apart from appended entities, geometry untouched (open both, compare visually or diff STEP text minus new `#` ids).
- [ ] Safe-editor reject: new property in `Pset_Random` gives an explanatory rejection, nothing staged.
- [ ] Conduit same file: trace 1 run over its geometry, summary renders; save/load round-trips.
- [ ] Routing graph on the generic model: empty set or diagnostic report, no throw.

Record per file: load OK?, approx element count, any throw + console text.

## Gate C — flag matrix (survey-box only, ~10 min)

| # | Tray flags | Conduit flag | Expect |
|---|---|---|---|
| C1 | (default) | (default) | baseline numbers (record takeoff totals + tag count) |
| C2 | `?tagging=wasm` | `?core=wasm` | same numbers as C1, no fallback warnings |
| C3 | `?routing=wasm` | (default) | routing panel opens, empty-set handled, no throw |
| C4 | `?tagging=wasm&routing=wasm` | `?core=wasm` | full-wasm boot clean, numbers equal C1 |

FAIL = numbers differ or uncaught throw. A fallback warning with JS numbers intact = pass-with-note (means `pkg/` wasn't built on that machine).

## Results template (`docs/validation-results.md`)

Copy this per run. One row per checkbox above: `PASS | FAIL | NOTE + console text`.

```md
# Validation results — <date>
Commit: <SHA> | Browser: <name + version> | OS: <...>
PR #61 merged: yes/no

## Gate A1 (tray, survey-box)
- load: PASS
...

## Gate A2 (conduit, survey-box)
...

## Gate B (<filename.ifc>, <size MB>, <schema>)
...

## Gate C (flag matrix vs C1 baseline)
- C1 baseline takeoff total: <m>, sticks: <n>
- C2/C3/C4: PASS/FAIL + notes

## Console errors pasted
...
```

## Out of scope (explicit)

- No Playwright (manual per owner decision).
- No conduit project-file regression (no file exists; synthetic `project-synthetic.json` is the ceiling per D7b).
- No real-model performance bench (record subjective smooth/janky only).
- No new specs for fixes found here: file a blocker (`docs/blockers/`) per FAIL and fix directly on a `fix/<topic>` branch.
