// Fitting Marker Model.
// Manages point markers for supports, junction boxes, straps, etc.

export const DEFAULT_MARKER_TYPES = [
  'Support',
  'Junction Box',
  'Strap',
  'Pull Box',
];

export function createMarkerStore(initialMarkers = []) {
  let markers = initialMarkers.map((m) => ({
    id: m.id || `marker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: m.type || DEFAULT_MARKER_TYPES[0],
    position: {
      x: Number(m.position?.x) || 0,
      y: Number(m.position?.y) || 0,
      z: Number(m.position?.z) || 0,
    },
    runId: m.runId || null,
    notes: m.notes || '',
  }));

  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.error('[MarkerStore] listener error:', err);
      }
    }
  }

  return {
    getAll() {
      return [...markers];
    },

    getById(id) {
      return markers.find((m) => m.id === id) || null;
    },

    addMarker({ type, position, runId = null, notes = '' }) {
      if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
        throw new Error('Marker position must include numeric x, y, and z.');
      }
      const marker = {
        id: `marker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: type || DEFAULT_MARKER_TYPES[0],
        position: { x: position.x, y: position.y, z: position.z },
        runId,
        notes,
      };
      markers.push(marker);
      notify();
      return marker;
    },

    removeMarker(id) {
      const idx = markers.findIndex((m) => m.id === id);
      if (idx !== -1) {
        const [removed] = markers.splice(idx, 1);
        notify();
        return removed;
      }
      return null;
    },

    moveMarker(id, position) {
      const marker = markers.find((m) => m.id === id);
      if (marker && position) {
        marker.position = {
          x: Number(position.x) || marker.position.x,
          y: Number(position.y) || marker.position.y,
          z: Number(position.z) || marker.position.z,
        };
        notify();
        return marker;
      }
      return null;
    },

    countByType() {
      const counts = {};
      for (const m of markers) {
        counts[m.type] = (counts[m.type] || 0) + 1;
      }
      return counts;
    },

    clear() {
      markers = [];
      notify();
    },

    load(newMarkers) {
      markers = (newMarkers || []).map((m) => ({
        id: m.id || `marker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: m.type || DEFAULT_MARKER_TYPES[0],
        position: {
          x: Number(m.position?.x) || 0,
          y: Number(m.position?.y) || 0,
          z: Number(m.position?.z) || 0,
        },
        runId: m.runId || null,
        notes: m.notes || '',
      }));
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
