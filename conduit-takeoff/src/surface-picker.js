// Samples an IFC surface for conduit placement or elevation.
// The Rust viewport core decides when element selection is allowed. This picker
// only raycasts. It never paints the selection highlighter itself.

export function createSurfacePicker({ engine }) {
  let highlighterReady = false;

  function applyHighlightPolicy(allow) {
    const highlighter = engine.highlighter;
    if (!highlighter) return;

    if (!allow) {
      if (highlighter.config) highlighter.config.selectEnabled = false;
      highlighter.enabled = false;
      return;
    }

    if (!highlighterReady && engine.world) {
      highlighter.setup({ world: engine.world });
      highlighter.mouseMoveThreshold = 10;
      highlighter.zoomToSelection = false;
      highlighterReady = true;
    }
    highlighter.enabled = true;
    if (highlighter.config) highlighter.config.selectEnabled = true;
  }

  async function sample(ndc) {
    const hit = await engine.pick(ndc, { snap: false });
    if (!hit?.point) return null;
    return { point: hit.point, normal: hit.normal || null, onSurface: true };
  }

  return { applyHighlightPolicy, sample };
}
