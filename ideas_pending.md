# COVILLAF viewer — next ideas

Saved 30 Sep 2026. Not implemented. Talk about these later. Static and modal analysis stay out.

The behaviors below come from the pasted viewer class. `ThatOpenEngine` is the simulation shell and does not contain those modules, so each item would be built on the That Open components the COVILLAF engine already uses.

## Next

- Section planes and a section box, honored by picking, so a level or a rack can be tagged and colored on its own.
- Assembly selection that stops at the spatial container, plus select-similar by IFC class, so a tray run can be tagged in one step.
- Ghost isolate: the chosen system stays solid and the rest of the plant stays faint.
- Frame cap, lower resolution while the camera moves, and a reload notice if the browser loses the WebGL context.

## After those

- Undo for color and visibility, beside the existing tag-batch undo.
- A PNG of the current view at a chosen size, including painted colors, without resizing the live canvas.
- Lengths and positions in IFC coordinates (Z-up, double precision), converted to the scene only when drawing. The page still shifts the first file to the origin.

## Leave as they are

Cable-tray tags, exported IFC color, the Excel bridge, and routing. The simulation pieces in `ThatOpenEngine` (deflected shapes, diagrams, modes, and the Python kernel) stay disconnected.
