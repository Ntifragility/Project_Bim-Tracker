# Icon inventory — ribbon-chrome SVG sprite

Status: draft | Parent: `revit-chrome-design.md` (R6: SVG only, monochrome
line icons, 16px + 32px from one path set).

## Shared (both apps)

| IconName | Glyph | Replaces (emoji) |
|---|---|---|
| `open` | folder outline | 📁 |
| `sample` | house outline | 🏠 |
| `save` | floppy outline | 💾 |
| `undo` | curved arrow L | ↩ |
| `redo` | curved arrow R | ↪ |
| `reset-view` | crosshair/expand | 🔄 |
| `views` | cube iso | ⊞ |
| `settings` | gear | ⚙️ |
| `export` | box + arrow out | 📊 |
| `link` | chain link | 📊 (excel) |

## Tray-only

| IconName | Glyph |
|---|---|
| `tag` | price-tag outline |
| `tag-batch` | stacked tags |
| `tag-undo` | tag + curved arrow |
| `system` | connected nodes |
| `highlight` | highlighter/marker |
| `isolate` | framed solo square |
| `validate` | checklist + check |
| `continuity` | linked chain path |
| `routing` | route nodes + path |
| `route-start/end` | flag A / flag B |
| `metadata` | card + lines |
| `color` | paint swatch |
| `camera-top/front/right` | view glyphs |

## Conduit-only

| IconName | Glyph |
|---|---|
| `trace` | polyline + node dots |
| `ortho` | right-angle glyph |
| `perp` | perpendicular symbol |
| `run` | pipe segment |
| `vert-up/down` | vertical arrows |
| `finish` | check in run badge |
| `cancel` | cross in run badge |
| `diameter` | circle + calipers |
| `elevation` | level marker |
| `pick` | eyedropper/target |
| `workplane` | grid plane |
| `autoriser` | riser arrow auto |
| `project` | briefcase/box |
| `csv` | table + arrow |
| `waste` | percent badge |

## Rules

- One path set, two render sizes (16/32). Stroke-based, `currentColor`.
- No emoji anywhere in chrome; emoji in existing dock displays removed
  opportunistically during the app branches, not as a separate task.
- New icons need a row here + both sizes before use (review gate).
