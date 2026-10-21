# viewer / view-export-png
Status: draft
Branch: viewer/export-png        Owner folders: packages/viewer-core/, docs/specs/viewer/

## Goal
Implement client-side high-resolution PNG snapshot export of the active 3D viewport at arbitrary configurable resolutions and aspect ratios without interfering with the active render loop.

## Public interface
Exported via `engine.exportPng` on `viewer-core`:
- `capturePng(options?: { width?: number, height?: number, watermark?: string }): Promise<Blob>`
- `downloadPng(fileName?: string, options?: { width?: number, height?: number }): Promise<void>`

## Rules
- **R1: Offscreen Rendering:** Higher resolution snapshots render via an offscreen target or momentary resize, preserving user camera angle and lighting.
- **R2: Format & Fidelity:** Exports lossless 24-bit/32-bit PNG with transparent or themed background.
- **R3: Non-blocking:** Execution returns a promise and does not drop application UI frames.
