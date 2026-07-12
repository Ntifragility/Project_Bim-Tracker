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

## View navigation

- Hold the middle mouse button (mouse wheel) and drag to pan the view.
- Select an IFC element, then drag with the left mouse button to orbit around it.
- Scroll the mouse wheel to zoom.
- Select an IFC element, then right-click and choose **Focus on Item** to center it.
- Open **Settings** to change the temporary selection highlight color.
- Right-click selected elements and choose **Appearance Color** to recolor their
  viewer appearance only. This does not write color back into the IFC.

Panning moves only the camera view; it does not change IFC model coordinates.

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
element's IFC attributes or property sets. The export also includes
`SourceState`, showing whether a row is pending or modifies a saved IFC tag.

When that workbook is uploaded again, `ComponentId` is selected automatically:
clicking a row highlights its single IFC element. Selecting `SystemTag` as the
navigation column instead makes each row highlight the complete tray system.

To inspect a complete tray system without Excel, type or choose its system tag and
select **Highlight System** (or press Enter). Every loaded component assigned to
that system is highlighted.

The **Tray System Manager** lists every system tag found in the loaded IFC data
and pending assignments. Selecting a system lets you highlight or isolate the
whole system, add the current viewer selection, remove pending elements, rename
the system, inspect the component list, and regenerate sequential component IDs.
Use the manager search box and sort selector to quickly narrow large system
lists by tag, status, or source model. System cards use colored state badges so
saved, pending, modified, mixed, and pending-deletion changes are easier to scan.
The manager labels systems as:

- **Saved**: read from an uploaded tagged IFC;
- **Pending**: assigned during the current viewer session;
- **Modified**: originally read from a tagged IFC, then changed in the current session;
- **Mixed**: a combination of saved IFC tags and pending edits.

The component list under the selected system shows each `ComponentId`, sequence
number, local IFC element ID, and source. Clicking a component row highlights
that single IFC element. **Regenerate Sequence** rewrites the selected system's
component IDs as `SystemTag-C001`, `SystemTag-C002`, and so on, using the current
sorted component order.

Removing from the manager deletes pending session assignments immediately. If the
selected component came from an uploaded tagged IFC, the removal is stored as a
pending deletion and **Export Tagged IFC** clears the saved `SystemTag`,
`ComponentId`, and `SequenceNumber` values in the new exported IFC. The original
source IFC is still left unchanged. The manager summary reports pending deletions,
and the pending-deletions list lets you show one in the viewer or restore it
before export if it was removed by mistake. Use **Restore all** to cancel every
pending deletion in one step.

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
