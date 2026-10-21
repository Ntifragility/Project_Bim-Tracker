// Thin browser binding for the Rust viewport core.
// Gesture policy, orbit/pan deltas, and the IFC selection gate live in
// packages/viewport-core. This file only applies those deltas to camera-controls.

import wasmUrl from '../../crates/viewport-core/pkg/viewport_core.wasm?url';

const ACTION_NAME = ['none', 'orbit', 'pan', 'place', 'sample', 'select'];
const MODE_CODE = { navigate: 0, drawing: 1, 'pick-elevation': 2 };

let loadPromise;

function loadCore() {
  if (!loadPromise) {
    loadPromise = fetch(wasmUrl)
      .then((response) => response.arrayBuffer())
      .then((bytes) => WebAssembly.instantiate(bytes))
      .then(({ instance }) => instance.exports);
  }
  return loadPromise;
}

function claimPointerCamera(controls) {
  if (!controls?.constructor?.ACTION) return;
  const { NONE } = controls.constructor.ACTION;
  controls.mouseButtons.left = NONE;
  controls.mouseButtons.middle = NONE;
  controls.mouseButtons.right = NONE;
  controls.dollyToCursor = true;
}

function readDecision(api) {
  return {
    action: ACTION_NAME[api.viewport_decision_action()] || 'none',
    preserveRubberband: api.viewport_decision_preserve() !== 0,
    allowElementHighlight: api.viewport_decision_highlight() !== 0,
    azimuthDelta: api.viewport_decision_azimuth(),
    polarDelta: api.viewport_decision_polar(),
    truckX: api.viewport_decision_truck_x(),
    truckY: api.viewport_decision_truck_y(),
  };
}

export async function createViewportControls({ controls } = {}) {
  const api = await loadCore();
  const selfTest = api.viewport_self_test();
  if (selfTest !== 0) {
    throw new Error(`viewport-core self-test failed (${selfTest})`);
  }
  claimPointerCamera(controls);

  function apply(apiCall) {
    apiCall();
    const read = readDecision(api);
    if (!controls) return read;
    if (read.action === 'orbit') {
      controls.rotate(read.azimuthDelta, read.polarDelta, false);
    } else if (read.action === 'pan') {
      controls.truck(read.truckX, read.truckY, false);
    }
    return read;
  }

  return {
    setMode(mode) {
      api.viewport_set_mode(MODE_CODE[mode] ?? 0);
      return api.viewport_allow_highlight() !== 0;
    },

    allowHighlight() {
      return api.viewport_allow_highlight() !== 0;
    },

    pointerDown(event) {
      return apply(() => api.viewport_pointer_down(
        event.button,
        event.clientX,
        event.clientY,
        performance.now(),
        event.shiftKey ? 1 : 0,
      ));
    },

    pointerMove(event, view) {
      return apply(() => api.viewport_pointer_move(
        event.clientX,
        event.clientY,
        performance.now(),
        view.distance,
        view.viewportHeight,
      ));
    },

    pointerUp(event, view) {
      return apply(() => api.viewport_pointer_up(
        event.clientX,
        event.clientY,
        performance.now(),
        view.distance,
        view.viewportHeight,
      ));
    },
  };
}
