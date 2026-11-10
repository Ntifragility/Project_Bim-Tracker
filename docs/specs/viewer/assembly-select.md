# viewer / assembly-select
Status: approved (spec written 2026-10-26; code todo)
Branch: spec/viewer-gaps        Owner folders: docs/specs/viewer/, packages/viewer-core/, spec/vectors/viewer/
From: `docs/covillaf-next.md` §Next ¶2 ("Assembly selection that stops at the spatial container, plus select-similar by IFC class, so a tray run can be tagged in one step").

## Goal
One-step run selection for tagging: click a tray element → select its assembly up to (and including) the spatial container; plus select-similar by IFC class across the loaded models.

## Public interface
```ts
engine.selection: {
  selectAssembly(expressId: number, modelId: string, opts?: { stopAt?: 'storey' | 'building' | 'site' }): Promise<SelectSet>
  selectSimilar(expressId: number, modelId: string, opts?: { sameSystem?: boolean }): Promise<SelectSet>
}
type SelectSet = { modelId: string, expressIds: number[] }[]
```
- Spatial walk uses the existing model relations (no new IFC parse): element → contained-in → stop-at level. `stopAt` default `'storey'`.
- `sameSystem` (default false): intersect with `CCP_TRAY_SYSTEM` equality when the source carries it.

## Rules
- **R1:** Stock-first: evaluate That Open `Classifier` / `Hider` / existing selection maps before custom traversal (ARCH §5). Record the choice in the code PR.
- **R2:** Never selects across unloaded/hidden models; hidden members reported in `SelectSet` meta, not added.
- **R3:** Result feeds the existing highlighter `select` style (no new style names).
- **R4:** Pure-data results: plain arrays, no Maps across any future Wasm use.

## Acceptance criteria (vectors: `spec/vectors/viewer/assembly-select.json`, synthetic tree)
| Case | Check |
|---|---|
| stop-at-storey | click tray segment → all 5 siblings in storey selected, building siblings excluded |
| stop-at-building | `stopAt:'building'` → whole-building set |
| similar-class | select-similar on `IfcCableCarrierSegment` → all segments, no fittings |
| similar-system | `sameSystem:true` → only same-system segments |
| hidden-excluded | hidden member listed in meta, not in `expressIds` |

## Out of scope
- Tagging itself (5.1/7.1 own it); selection only produces the set.
- Custom spatial-index build (reuse loaded relations).

## Parity reference
- New feature track (D5/Phase B); no legacy counterpart. Tagging consumer: `src/ui/tagging-panel.js` batch flow.

## Open questions — none (stock-vs-custom recorded at landing per R1).
