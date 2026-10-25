# excel-io / base (task 7.3)
Status: approved (spec written 2026-10-26; code 75% landed, FIX-1 wiring owed)
Branch: spec/excel-io        Owner folders: docs/specs/excel-io/
Code landing: app/excel-io (follows this spec; owned folders: packages/excel-io/, src/ui/excel-panel.js, src/ui/tagging-panel.js, spec/vectors/excel/)

## Goal
Pin `packages/excel-io` as the optional Excel plugin behind SheetJS: apps import only `readWorkbook` / `writeWorkbookBytes` / `exportTagMapping`; cores and bindings never import it (ARCH §2 rule 8, D4). Close the 7.1 FIX-1 gap (export passes `[]` summary) by restoring the Summary sheet from `getTraySystemSummaries()`.

## Current state (verified 2026-10-26 on origin/main@cd81800)
- `packages/excel-io/src/index.js` (50 lines): `readWorkbook(data)`, `writeWorkbookBytes(sheetsMap)`, `exportTagMapping(rows, summaryRows, file)`.
- Wired: `src/ui/excel-panel.js:8` imports `readWorkbook`; `src/ui/tagging-panel.js:12,681` imports/calls `exportTagMapping(rows, [], …)` — summary hardcoded `[]` (7.1 FIX-1).
- Summary source exists: `src/ui/system-manager.js:60 getTraySystemSummaries()` (per-system: tag, count, models, modified/pending/ifc/deleted counts) exposed on `api`.
- Test: 1 roundtrip test, 92/92 suite green. No vectors dir yet.

## Public interface (frozen — already landed, spec pins it)
```ts
readWorkbook(data: ArrayBuffer | Uint8Array): { sheetNames: string[], readSheet(name?, {defval?}): Row[], raw: Workbook }
writeWorkbookBytes(sheetsMap: Record<string, Row[]>): Uint8Array
exportTagMapping(tagRegisterRows: Row[], summaryRows?: Row[], fileName?: string): void
type Row = Record<string, string | number | boolean>
```
- Sheet names: `"Tag Register"`, `"Summary"` (fixed, capitalized exactly).
- `readSheet` default: first sheet; missing sheet → `[]` (never throws).

## Row shapes (normative — landing must produce exactly these)
**Tag Register** (from 5.1 effective assignments; columns fixed order):
`SystemTag | ElementTag | ComponentId | IfcClass | Model | Source`
**Summary** (from `getTraySystemSummaries()`; one row per system):
`SystemTag | Count | Models (comma-joined, sorted) | Modified | Pending | FromIFC | Deleted`
- Empty register → workbook still written with headers, 0 data rows.
- Summary empty (no systems) → Summary sheet omitted (current `length > 0` guard kept).

## Rules
- **R1: Apps only.** Imported by apps (`src/ui/*`, `conduit-takeoff/src/*`) only. `crates/*`, `bindings/*`, `viewer-core` never import it (boundary check enforces).
- **R2: No business rules.** excel-io renders rows it is given; allocation, classification, validation, summaries-by-rule stay in cores / app panels. Sorting/joining for display (models list) is allowed; counting/tagging decisions are not.
- **R3: SheetJS hidden.** Callers never touch `XLSX.*` directly; all access through the 3 functions (mockable in tests).
- **R4: FIX-1 closure.** `tagging-panel.js` export handler calls `api.getTraySystemSummaries()`, maps to Summary rows per shape above, passes to `exportTagMapping` instead of `[]`. Export with no systems → register-only file (no crash, no empty sheet).
- **R5: Frozen bridge untouched.** `excel-ifc-bridge/` + `src/viewer-socket.js` stay frozen (D4/architecture §1b); this spec does not reference them.
- **R6: xlsx advisory.** Re-evaluate the `xlsx@0.18.5` dependency advisories when landing (ARCH §5); record decision in the landing PR.

## Acceptance criteria (acceptance vectors → spec/vectors/excel/excel-io.json)
| Case | Input | Expected |
|---|---|---|
| roundtrip | 2 Tag-Register rows → bytes → read | same rows back (already tested) |
| register-shape | effective assignments (2 systems × tray+fitting, mixed sources) | columns exactly `SystemTag,ElementTag,ComponentId,IfcClass,Model,Source`, row order = assignment order |
| summary-shape | `getTraySystemSummaries()` output (1 system, 2 models, 1 pending) | one row: `SystemTag,Count,Models="a.ifc,b.ifc",Modified,Pending,FromIFC,Deleted` |
| empty-register | `[]` rows | file written, headers present, 0 rows; Summary omitted |
| missing-sheet | read unknown sheet | `[]`, no throw |
| unicode | tags with `PT1.01.01` + CJK model name | byte-roundtrip lossless |

## Out of scope
- Live Excel bridge (`excel-ifc-bridge/`, `viewer-socket.js`) — frozen.
- Tag Register / Summary *rules* (scheme, classifier, validator) — 5.1 specs/vectors.
- Conduit CSV export — TS-side in conduit app (`io.json` jsOnly), not this package.
- `.xlsx` upload column-mapping UI — `excel-panel.js` already owns it.

## Parity reference
- Legacy/code: `packages/excel-io/src/index.js` (50 lines), `src/ui/excel-panel.js` (~410 lines, 7.1), `src/ui/tagging-panel.js:679-681` (FIX-1 site), `src/ui/system-manager.js:60` (summary source).
- Spec chain: `docs/specs/tray/tagging.md` §Excel persistence (register from effective, summary by system/kind/model/source).
- Vectors: `spec/vectors/tray/tagging.json` (33) + `validator.json` (7) feed the rows; `spec/vectors/excel/excel-io.json` (new, 6 cases above) pins the shapes.

## Open questions / [UNVERIFIED]
- **Q1:** Summary `kind` breakdown (tray vs fitting columns) — tagging.md says "by system, kind, model, source" but `getTraySystemSummaries()` has no kind split. Landing decides: add kind columns or narrow the tagging.md sentence; spec update in same branch.
- **Q2:** `xlsx` version/advisory call (R6) — recorded at landing.
