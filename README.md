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

After assigning tags, select **Export Tagged IFC**. The viewer downloads a new
`<model-name>_tagged.ifc` file and leaves the original IFC unchanged. Each tag
is stored on its assigned element as:

```text
CCP_TAG
└── Tag = CT-001
```

When a tagged IFC is loaded again, existing `CCP_TAG` values are preserved and
shown for their elements. Assigning a different tag asks for confirmation and
updates the existing property; elements without `CCP_TAG` receive a new property
set on export.

Select **Validate Tags** before export to compare effective IFC tags with the
selected Excel tag column. Duplicate IFC tags, duplicate Excel tags, and blank
Excel tags block tagged-IFC export. Unassigned Excel tags and IFC tags missing
from Excel are reported as warnings but do not block export.

## Verification

```powershell
npm test
npm run build
```

See [routing architecture](docs/routing-architecture.md) and
[Revizto validation evidence](docs/revizto-validation.md).
