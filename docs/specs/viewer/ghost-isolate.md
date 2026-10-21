# viewer / ghost-isolate
Status: draft
Branch: viewer/ghost-isolate        Owner folders: packages/viewer-core/, docs/specs/viewer/

## Goal
Provide a "ghost isolate" visualization mode in `viewer-core` where isolated system elements remain solid and fully opaque while all other loaded model elements are rendered faint, semi-transparent, and non-distracting.

## Public interface
Exported via `engine.isolation` on `viewer-core`:
- `ghostIsolate(modelIdMap: Record<string, Set<number> | number[]>): Promise<void>`
- `hardIsolate(modelIdMap: Record<string, Set<number> | number[]>): Promise<void>`
- `resetIsolation(): Promise<void>`
- `isGhostActive(): boolean`

## Rules
- **R1: Transparent Styling:** Non-isolated elements are styled with a low opacity ghost material (e.g. 15% opacity, depth write disabled) rather than completely hidden.
- **R2: Selection Preservation:** Ghosted elements remain inspectable or can be configured as non-pickable while in ghost mode.
- **R3: Memory Safety:** Restoring isolation cleans up custom fragment materials and restores original appearance maps.
