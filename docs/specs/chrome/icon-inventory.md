# Icon inventory — ribbon-chrome SVG sprite

Status: approved | Parent: `revit-chrome-design.md` (R6: SVG only, monochrome
stroke icons, 16px + 32px from one path set, `currentColor`).

---

## Rules

- One sprite file: `packages/ribbon-chrome/src/sprite.svg`.
- One path set per icon, two `<symbol>` elements per icon: `icon-<name>-16`
  and `icon-<name>-32`. Both use `viewBox="0 0 24 24"` with stroke-based
  paths; the browser scales. Stroke-width: 1.5px at 24px; scales proportionally.
- Fill: `none`. Stroke: `currentColor`. No hardcoded colour values.
- No emoji anywhere in chrome (ribbon, QAT, tabs, status bar, group captions).
  Emoji in existing dock displays may be replaced opportunistically in the app
  branches; they are not a blocker.
- **Review gate:** any new icon needs a row in this table AND both sizes
  authored in the sprite before the PR can merge.

---

## Shared (both apps)

| IconName | Glyph description | Replaces (emoji/text) |
|---|---|---|
| `open` | Folder outline, open flap | 📁 / "Open" |
| `sample` | House outline with roofline | 🏠 / "Sample" |
| `save` | Floppy disk outline | 💾 / "Save" |
| `undo` | Curved arrow pointing left, counterclockwise | ↩ / "Undo" |
| `redo` | Curved arrow pointing right, clockwise | ↪ / "Redo" |
| `reset-view` | Four-corner expand arrows / crosshair | 🔄 / "Reset" |
| `views` | Isometric cube outline | ⊞ / "Views" |
| `settings` | Gear / cogwheel outline, 6-tooth | ⚙️ / "Settings" |
| `export` | Box with arrow pointing out / up-right | 📊 / "Export" |
| `link` | Two chain-link ovals connected | 🔗 / "Excel" |
| `theme` | Half-filled circle (light/dark split) | — (new) |
| `highlight` | Highlighter marker pen outline | — (new) |
| `isolate` | Single square framed alone in a larger field | — (new) |
| `color` | Paint swatch / palette outline | — (new) |
| `metadata` | Card with horizontal lines (like a form) | — (new) |

---

## Tray-only

| IconName | Glyph description | Replaces (emoji/text) |
|---|---|---|
| `tag` | Price-tag outline (rectangular with corner cutout) | — / "Tag" |
| `tag-batch` | Two stacked price-tags, offset | — / "Batch" |
| `tag-undo` | Price-tag with small curved-arrow undo | — / "Undo tag" |
| `system` | Three nodes connected by lines (network graph) | — / "System" |
| `validate` | Checklist with checkmark on last item | — / "Validate" |
| `continuity` | Linked chain path / route with nodes | — / "Continuity" |
| `routing` | Route path with two intermediate nodes | — / "Routing" |
| `route-start` | Flag-A: pennant flag with letter A | — / "Start" |
| `route-end` | Flag-B: pennant flag with letter B | — / "End" |
| `regen` | Circular refresh arrows (two half-circles) | — / "Regen" |
| `restore` | Clock with counterclockwise arrow (restore/history) | — / "Restore" |
| `camera-top` | Rectangle with upward arrow (top-down view glyph) | ⬆ / "Top" |
| `camera-front` | Rectangle with frontward arrow (front view glyph) | ◻ / "Front" |
| `camera-right` | Rectangle with rightward arrow (right view glyph) | ▷ / "Right" |

---

## Conduit-only

| IconName | Glyph description | Replaces (emoji/text) |
|---|---|---|
| `trace` | Polyline with node dots at vertices | ✏️ / "Trace" |
| `ortho` | Right-angle glyph (two lines at 90°) | 📐 / "Ortho" |
| `perp` | Perpendicular symbol (T rotated 90°) | ⊥ / "Perp" |
| `run` | Single horizontal pipe segment with end caps | — / "Run" |
| `vert-up` | Vertical arrow pointing up with conduit tick | ⬆ / "+Up" |
| `vert-down` | Vertical arrow pointing down with conduit tick | ⬇ / "-Down" |
| `finish` | Checkmark inside a rounded-square badge | ✓ / "Finish" |
| `cancel` | ×-cross inside a rounded-square badge | ✗ / "Cancel" |
| `diameter` | Circle outline with caliper marks at 3 and 9 o'clock | — / "Size" |
| `elevation` | Horizontal level datum line with up/down tick marks | — / "Elevation" |
| `pick` | Eyedropper / target crosshair with dot | ⊕ / "Pick" |
| `workplane` | Grid plane (3×3 dots on a tilted plane) | — / "Workplane" |
| `autoriser` | Vertical arrow with "A" auto badge | — / "Auto-riser" |
| `project` | Briefcase outline | 📁 / "Project" |
| `csv` | Table grid outline with outward arrow | 📊 / "CSV" |
