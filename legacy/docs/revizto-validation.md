# Revizto Cable-Tray Validation

## Test model

`P22115-CC-2140-07-05_Cable_Tray.ifc` was used locally and remains excluded
from Git.

## Verified extraction

- 134 `IfcBuildingElementPart` records are present.
- 12 are hierarchy/container candidates without usable routing geometry.
- 122 geometric leaf elements are extracted as routing segments.
- The viewer can select an extracted element and bind it to a graph edge.
- The Fragments library fails to enumerate vertex samples for some Revizto
  representations (`geometries is not iterable`). Those items fall back to
  their per-item bounding box and are deliberately marked lower confidence.

## Connectivity sensitivity

Endpoint clustering was evaluated at several tolerances:

| Tolerance | Nodes | Components | Open ends |
|---:|---:|---:|---:|
| 100 mm | 244 | 122 | 244 |
| 500 mm | 232 | 116 | 226 |
| 1000 mm | 139 | 79 | 99 |

The source IFC therefore does not provide a directly connected centerline
network. A larger tolerance creates some inferred connections but must not be
treated as engineering truth. The UI keeps 100 mm as the conservative default
and reports components/open ends so the user can review the inference.

## Verified route

At a deliberately exploratory 1000 mm tolerance, local elements `#3192` and
`#3702` were selected through the viewer. The shortest-path UI returned a route
containing both selected segments with an estimated centerline length of
13.71 m. This verifies the complete interaction chain:

```text
IFC load -> tray extraction -> centerlines -> graph -> select start/end
-> shortest path -> route overlay and length
```

## Interpretation

The milestone proves that a graph can be generated and queried from the real
file, but also proves why diagnostics are essential. Before production routing,
connection inference should add fitting-aware and endpoint-to-centerline logic,
and inferred connections should be reviewable/approvable rather than accepted
silently.

