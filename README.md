# BIM Tracker and IFC Cable Routing Prototype

Browser-based IFC inspection, Excel tag assignment, and geometry-derived cable
tray routing built with That Open Components and Three.js.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/` and upload an IFC model. A local model served by
the development server can also be deep-linked for repeatable review:

```text
http://127.0.0.1:5173/?ifc=/model.ifc
```

## Routing workflow

1. Load an IFC containing cable-tray geometry.
2. Set the connection tolerance in millimetres. Start conservatively at 100 mm.
3. Select **Build Graph**.
4. Review the segment, component, open-end, and low-confidence counts.
5. Click a tray and select **Set Start**.
6. Click another tray and select **Set End**.
7. Select **Calculate Route**.

Overlay colors:

- green: inferred centerline;
- amber: low-confidence centerline (usually box fallback or ambiguous shape);
- red point: dangling/open endpoint;
- yellow: calculated route.

The graph is an inference from model geometry. A successful path is not yet a
code-compliance or constructability approval.

## Tagged IFC export

Select multiple IFC elements in the viewer (or add them individually to the
selection basket), type the system tag, and select **Assign System Tag**. Excel is
optional. The viewer generates sequential component IDs in selection order.
**Export Tagged IFC** downloads a new `<model-name>_tagged.ifc` and leaves the
original unchanged. Each assigned element receives:

```text
CCP_TRAY_SYSTEM
├── SystemTag = 140ST-900-001
├── ComponentId = 140ST-900-001-C001
└── SequenceNumber = 001
```

System tags may repeat across every component in the same tray system. Component
IDs are unique within the project.

**Export Mapping** creates `IFC_Tag_Mapping.xlsx` with the system/component
identifiers and best-effort `Width`, `Height`, and `Length` values read from each
element's IFC attributes or property sets.

Select **Validate Tags** before export to compare effective IFC tags with the
selected Excel tag column. Duplicate component IDs, duplicate Excel system tags,
blank Excel tags, and missing component IDs block export. Unassigned Excel systems
and IFC systems missing from Excel are warnings.

## Verification

```powershell
npm test
npm run build
```

See [routing architecture](docs/routing-architecture.md) and
[Revizto validation evidence](docs/revizto-validation.md).
