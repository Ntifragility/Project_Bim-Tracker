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
Pset_ProjectTag
└── Tag = CT-001
```

## Verification

```powershell
npm test
npm run build
```

See [routing architecture](docs/routing-architecture.md) and
[Revizto validation evidence](docs/revizto-validation.md).
