# Conduit overlay desktop app

Manual 3D conduit tracing on an IFC model exported from Revizto. The app estimates how much conduit to buy. It does not route conduit automatically.

## Why this exists

- Revizto cannot draw a multi-segment measurement line.
- Navisworks is not available on this machine.
- A line drawn in Navisworks is viewpoint markup. A small orbit drops it.
- Revit is not available.
- Drawn runs must survive camera movement and reopen in the same coordinates as the source model.

## Product

Desktop app. The user loads a Revizto IFC, clicks a path, and saves those runs as a second IFC. Load both files in Revizto (or any IFC viewer). They align because they share a coordinate frame.

The source IFC stays read-only. The app never writes into it.

## Non-goals

- Automatic routing, pathfinding, clash avoidance, or code compliance (fill, supports, NEC).
- Editing, round-tripping, or replacing the Revizto IFC.
- Revit (`.rvt`) or Navisworks integration.
- Writing `IfcCableCarrierSegment` solids. Annotations are enough for quantity.

## Stack

- Language: Python.
- IFC read/write: IfcOpenShell. Rust has no IFC writer mature enough for this.
- Viewer: PyVista (VTK). Load tessellated geometry once, raycast against that cache.
- UI: desktop window. Orbit, pan, zoom, click-to-pick.

## User flow

1. Open a source IFC.
2. Start a run. Set conduit size (½", ¾", 1", or a custom size) and an optional system name.
3. Click points on the model. Each click appends a vertex in world coordinates.
4. Finish the run. The app stores length and fitting counts.
5. Repeat for more runs.
6. Save an overlay IFC. Reopen it later on top of the same source file.
7. Import the overlay into Revizto beside the original export.

## Drawing

- Click a mesh face to place a point. Store the world coordinate, not a screen coordinate.
- Undo the last point. Delete a whole run.
- Ortho mode: lock the new segment to the nearest world axis (X, Y, or Z).
- Elevation lock: keep the next point at a fixed Z, or at a fixed offset below a picked slab.
- A run is a polyline of 2 or more points. Segments may change direction. No curve fitting.
- Selecting an existing run shows its vertices and quantities. Vertices can be moved by picking a new point.

## Quantities

Computed from the polyline. Size is whatever the user set on the run. The app does not infer size from the model.

| Output | Rule |
| --- | --- |
| Length | Sum of segment lengths, in the source file's length unit. |
| Elbow | A vertex where the direction change is within tolerance of 45° or 90°. Store the angle class. |
| Riser | A segment whose direction is parallel to world Z, within tolerance. Its length is included in total length and also reported separately. |
| Couplings | `ceil(length / stick_length) + elbow_count`. Default stick length is 10 ft. Convert stick length into the file's unit before dividing. |

Tolerances (direction change, axis alignment) are constants in one place, not scattered magic numbers.

Per-run fields:

- `id`
- `size`
- `system` (optional)
- `length`
- `elbow_45`
- `elbow_90`
- `riser_length`
- `couplings`
- polyline vertices, world coordinates

Export a CSV of those fields alongside the overlay IFC.

## Overlay IFC

One file, `conduit-overlay.ifc`, IFC4.

Copy from the source, do not invent:

- Length unit (`IfcUnitAssignment`).
- `IfcGeometricRepresentationContext`: world coordinate system, true north, precision.
- `IfcMapConversion` and `IfcProjectedCRS` when the source has them (survey point / shared coordinates).
- Site placement needed for the same project origin.

Each run is one `IfcAnnotation`:

- Representation: `IfcPolyline` inside `IfcGeometricCurveSet`.
- Points are in the same world space as the source model.
- Name: run id.

Property set `Pset_ConduitRun` on each annotation:

- `Size` (string)
- `System` (string)
- `Length` (real, file length unit)
- `Elbow45` (integer)
- `Elbow90` (integer)
- `RiserLength` (real)
- `Couplings` (integer)
- `StickLength` (real)

On load, rebuild the in-memory runs from these annotations and this property set. What is drawn after reload must match what was saved.

## Coordinates

A picked point is converted to world coordinates through the full IFC placement chain before it is stored. Overlay geometry uses that same world space, with the copied context and map conversion. Federation in Revizto is by shared coordinates, not by nesting one file inside the other.

## Performance

- Source geometry is cached after the first load. Saving the overlay does not re-tessellate the building.
- Picking raycasts the cache.
- The app must open a multi-hundred-MB coordination IFC. Show a progress state during load. Do not block the window with a silent hang.

## Acceptance

- Draw a 3-segment run, orbit, pan, and zoom. The run stays on the model.
- Save, quit, reopen source + overlay. The same vertices and quantities come back.
- Import the overlay into Revizto next to the source export. The polyline sits on the traced path.
- A 10 ft axis-aligned run at ¾" reports length 10 ft, 0 elbows, and couplings from the stick rule.
- A run with one 90° turn reports one 90° elbow and one extra coupling.
- The source IFC file is byte-identical after save.
