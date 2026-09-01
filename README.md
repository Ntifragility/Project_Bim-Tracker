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

## Safe IFC property and color editing

Select an IFC element and expand one of its non-quantity property sets. Select a
property row to load it into **Safe IFC Editor**, enter the new value, and stage
the change. Existing `IfcPropertySingleValue` values are updated using their
original IFC data type.

Use **Manual Metadata** to add several values such as WBS and SOP to one element
at a time. New properties are restricted to `BIM_TRACKER_EDIT` or organization
property sets beginning with `COSAPI_`, such as `COSAPI_CONSTRUCTION`,
`COSAPI_PLANNING`, or `COSAPI_QA`. Supported safe types are label, text,
identifier, integer, decimal, Boolean, date, and date-time. After staging one
element, select the next element and use **Copy Previous** to reuse the previous
property set, property names, types, and values.

The right-click **Appearance Color** command now also stages the selected RGB
color for persistent export. Transparency can be set in Safe IFC Editor. Select
**Export Edited IFC** to download a new `<model-name>_edited.ifc` containing the
staged property and `IfcStyledItem` appearance changes. The source IFC is never
overwritten. Quantities, GUIDs, geometry, entity classes, relationships, and
type-level data remain read-only.

IFC appearance support varies by importer. Validate the exported RGB and
transparency in Navisworks with a small test set before using the colors as a
production deliverable.

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

Open **Tray Systems**, keep **Assign Tags** selected, and select one or more IFC
elements in the viewer. Define the prefix, system/run, element kind, type codes,
starting sequence, and digit count. **Preview selected** shows the exact tags and
their order before anything changes. Reorder elements with the arrow controls,
review any existing-tag conflicts, and select **Apply tags**. The last batch can
be undone immediately. Excel is optional.

For example, prefix `PT`, system/run `1`, tray code `01`, and fitting code `02`
produce independent sequences:

```text
Cable trays:    PT1.01.01, PT1.01.02, PT1.01.03
Cable fittings: PT1.02.01, PT1.02.02, PT1.02.03
```

**Auto classify** recognizes standard IFC cable-carrier classes and conservative
name patterns. Ambiguous generic elements must be assigned explicitly as Cable
Tray or Cable Fitting instead of being guessed.

**Export Tagged IFC** downloads a new `<model-name>_tagged.ifc` and leaves the
original unchanged. Each assigned element receives:

```text
CCP_TRAY_SYSTEM
├── SystemTag = PT1
├── ElementTag = PT1.01.01
├── ComponentId = PT1.01.01
├── ElementKind = tray
├── TypeCode = 01
├── SequenceNumber = 01
└── SchemeVersion = 2
```

The exporter also writes the final element tag to the native `IfcElement.Tag`
attribute for supported cable-tray, fitting, flow, duct, and generic building
element-part entities. Replacing a pre-existing native tag requires explicit
confirmation in the batch preview, and the original value is retained as
`OriginalIfcTag` in the custom property set.

System tags may repeat across every component in the same tray system. Element
tags and component IDs are unique within the project. Existing legacy
`SystemTag-C001` assignments remain readable and manageable.

**Export Mapping** creates `IFC_Tag_Mapping.xlsx` with a complete **Tag Register**
sheet for saved and pending effective assignments, plus a **Summary** sheet. The
register includes the system/element identifiers, kind, type code, IFC identity,
classification evidence, original tag, change state, and best-effort `Width`,
`Height`, and `Length` values read from each element's IFC data.

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
After building the routing graph, **Check Continuity** reports whether the
selected tray system belongs to one connected graph component or is split across
disconnected graph components. The report shows total system components,
components represented in the graph, missing graph geometry, disconnected group
count, and the component IDs found in each group. The viewer colors each
connected group with a temporary overlay so split systems can be located visually.
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

See [tagging architecture](docs/tagging-architecture.md),
[routing architecture](docs/routing-architecture.md), and
[Revizto validation evidence](docs/revizto-validation.md).
