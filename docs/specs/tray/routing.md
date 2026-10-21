# IFC Cable Routing Architecture

## Objective

Convert cable-tray geometry from one or more IFC models into a validated graph,
then calculate and visualize routes between selected tray elements. The routing
engine must remain independent from the viewer and from Three.js.

## Current source-model evidence

The reference Revizto export does not use `IfcCableCarrierSegment` or
`IfcCableCarrierFitting`. It contains 122 geometric leaf objects exported as
`IfcBuildingElementPart`, arranged under 12 non-geometric hierarchy objects.
The leaf objects carry Revit/Revizto property sets identifying them as cable
trays. Consequently, IFC class alone is not a reliable candidate filter.

## Boundaries

This milestone includes:

- candidate extraction from standard cable-carrier classes and Revizto's
  generic building-element parts;
- geometry-derived centerlines and endpoints;
- tolerance-based endpoint clustering;
- graph diagnostics and connected-component analysis;
- shortest-path calculation by physical length;
- a viewer overlay for centerlines, nodes, and routes.

It does not yet include:

- code-compliant tray fill or cable separation;
- bend-radius modeling;
- equipment drops;
- IFC modification/export;
- authoritative fitting topology when the source IFC omits it.

## Modules

```text
IFC FragmentsModel
  -> src/routing/ifc-extractor.js
  -> packages/routing-core/src/centerline.js
  -> packages/routing-core/src/graph.js
  -> packages/routing-core/src/diagnostics.js
  -> packages/routing-core/src/pathfinding.js
  -> src/routing/routing-controller.js
  -> Three.js diagnostic overlay
```

`packages/routing-core` contains plain JavaScript data and algorithms. It has no
DOM, IFC, or Three.js dependencies. `src/routing` is the adapter and UI layer.

## Data contracts

### Extracted tray segment

```js
{
  id: "model-id:local-id",
  modelId: "model-id",
  localId: 234,
  globalId: "2x7k...",
  category: "IFCBUILDINGELEMENTPART",
  name: "Cable Tray with Fittings",
  start: { x, y, z },
  end: { x, y, z },
  centroid: { x, y, z },
  length: 4.25,
  confidence: 0.94
}
```

### Connectivity graph

```js
{
  nodes: Map<nodeId, { id, position, endpointRefs, edgeIds }>,
  edges: Map<segmentId, { id, from, to, length, segment }>,
  segmentToEdge: Map<segmentId, edgeId>
}
```

## Geometric inference

1. Collect transformed vertices for each geometric IFC item.
2. Compute the centroid and covariance matrix.
3. Use power iteration to estimate the principal longitudinal axis.
4. Project vertices onto that axis; projection extrema become endpoints.
5. Reject degenerate items and report low-confidence centerlines.
6. Cluster endpoints whose Euclidean distance is within the configured
   tolerance (default 100 mm).

Principal-axis confidence is the ratio of variance along the selected axis to
total variance. Low confidence indicates square fittings, complex assemblies,
or geometry whose longest direction is ambiguous.

## Known risk

Endpoint proximity cannot reconstruct every tee, elbow, or crossing. The graph
therefore reports disconnected components, dangling endpoints, and ambiguous
high-degree nodes rather than silently asserting questionable connections.
Future fitting-aware inference can be added without changing the core graph
contract.

## Acceptance criteria

- The routing core passes deterministic tests for centerlines, clustering,
  diagnostics, and shortest paths.
- The viewer can build a graph from a loaded IFC without modifying the IFC.
- The overlay distinguishes connected centerlines, dangling nodes, and a
  calculated route.
- The UI reports segment, node, component, and warning counts.
- Existing viewer build and element/tagging functions continue to compile.

