# viewer / smoke-tests
Status: implemented
Branch: viewer/smoke-tests        Owner folders: packages/viewer-core/, docs/specs/viewer/, samples/, scripts/

## Goal
Establish automated compatibility smoke tests for `viewer-core` verifying That Open compatibility, coordinate frame conversions, deep link parsing (`?ifc=`), and asset bundling against the public sample fixture (`public/fixtures/survey-box.ifc`).

## Public interface / Tests
- `packages/viewer-core/test/smoke.test.js`
  - Verifies `viewer-core` module exports (`createEngine`, `createCovillafEngine`, `createCoordinateFrame`, `appearanceStyleName`).
  - Verifies coordinate frame conversions between IFC Z-up coordinates and Three.js scene coordinates across translation/rotation matrices.
  - Verifies appearance group styling name normalization.
  - Verifies deep link `?ifc=/fixtures/survey-box.ifc` resolution and fixture validity.
  - Verifies Vite plugin setup and asset distribution handlers.

## Rules
- **R1: Zero Regressions:** Smoke tests must execute under `npm test` across all Node environments.
- **R2: Deep-Link Parity:** Validates that `?ifc=` deep links resolve to existing fixtures with valid IFC4 schemas.
- **R3: Coordinate Precision:** Coordinate transforms must roundtrip within 1e-6 metre tolerance.

## Acceptance criteria
- `npm test` runs and passes all tests including `packages/viewer-core/test/smoke.test.js`.
- Both apps build cleanly.
- `public/fixtures/survey-box.ifc` is available for `?ifc=` deep linking.
