# viewer / undo-appearance
Status: approved (spec written 2026-10-26; code todo)
Branch: spec/viewer-gaps        Owner folders: docs/specs/viewer/, packages/viewer-core/, spec/vectors/viewer/
From: `docs/covillaf-next.md` §After ¶1 ("Undo for color and visibility, beside the existing tag-batch undo").

## Goal
Undo/redo for viewer appearance state (colour/highlight styles, hide/isolate/ghost) as an engine-owned stack, beside the existing tag-batch undo (which stays in the tray app's `tagging-panel.js`).

## Public interface
```ts
engine.appearanceHistory: {
  push(label: string): void        // snapshot current appearance (called by paint/hide/isolate/ghost wrappers)
  undo(): boolean                  // false when empty
  redo(): boolean
  clear(): void
  depth(): { undo: number, redo: number }
}
```
- Snapshot = `{ styles: Map<style, modelIdMap>, hidden: Set<id>, isolated: modelIdMap | null, ghost: modelIdMap | null }` (plain serializable copies).
- Cap 50; push clears redo.

## Rules
- **R1:** Undo restores appearance only — never touches tags, network, selection, camera.
- **R2:** Every mutating appearance API (`paint`, `hide`, `isolate`, `ghostIsolate`, `resetIsolation`, `clear`) pushes exactly one entry (coalesce drag-paint bursts ≤500 ms into one).
- **R3:** Tag-batch undo untouched and independent (different stack, different owner).
- **R4:** Redo cleared on any new push (standard).

## Acceptance criteria (vectors: `spec/vectors/viewer/undo-appearance.json`)
| Case | Check |
|---|---|
| paint-undo | paint A red → undo → A back to previous style |
| hide-redo | hide B → undo → visible → redo → hidden |
| ghost-undo | ghostIsolate(sys) → undo → full visibility restored |
| cap-50 | 51 pushes → depth.undo == 50, oldest dropped |
| tag-independence | tag-batch apply + appearance undo → tags unchanged |

## Out of scope
- Tag/metadata undo (tray app owns it). Camera undo. Persistent history across reloads.

## Parity reference
- New feature track (D5/Phase B); no legacy counterpart. Tag-batch undo reference: `src/ui/tagging-panel.js:153-572`.

## Open questions — none.
