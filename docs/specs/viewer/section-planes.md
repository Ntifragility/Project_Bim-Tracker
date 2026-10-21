# viewer / section-planes
Status: done
Branch: viewer/section-planes        Owner folders: packages/viewer-core/, docs/specs/viewer/

## Goal
Integrate section planes / section box clipping into `viewer-core` utilizing That Open's stock `Clipper` component, ensuring raycasting and pointer picks honor clipped geometry.

## Public interface
Exported via `engine.clipper` on `viewer-core`:
- `createPlane(planeNormal?: THREE.Vector3, planeConstant?: number): ClipperPlane`
- `deletePlane(planeId: string): void`
- `deleteAll(): void`
- `toggle(enabled?: boolean): boolean`
- `pickHonorsPlanes: boolean`

## Rules
- **R1: Stock Component Wrapper:** Use unmodified `@thatopen/components` `Clipper` without library monkey-patching.
- **R2: Raycasting Clipping Filter:** When clipping is enabled, `engine.pick(ndc)` discards raycast intersections that lie in clipped space.
- **R3: Non-destructive:** Clipping does not mutate IFC geometry data.
