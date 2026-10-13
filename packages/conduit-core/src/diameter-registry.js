// Diameter Registry for trade sizes and color mappings.
// Provides predefined trade sizes in inches with distinctive colors.

import { DEFAULT_DIAMETERS } from './config.js';

export const DIAMETER_PALETTE = [
  '#f59e0b', // Amber (3/4")
  '#3b82f6', // Blue (1/2")
  '#10b981', // Emerald (1")
  '#ec4899', // Pink (1 1/4")
  '#8b5cf6', // Violet (1 1/2")
  '#06b6d4', // Cyan (2")
  '#f97316', // Orange (2 1/2")
  '#14b8a6', // Teal (3")
  '#eab308', // Yellow (4")
  '#6366f1', // Indigo (Fallback/Custom)
];

export function createDiameterRegistry(customList = null) {
  const list = (customList || DEFAULT_DIAMETERS).map((d, index) => ({
    id: d.id || `diam-${index + 1}`,
    label: d.label,
    mm: d.mm,
    color: d.color || DIAMETER_PALETTE[index % DIAMETER_PALETTE.length],
  }));

  let selectedId = list.find((d) => d.label === '¾"')?.id || list[0]?.id || null;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.error('[DiameterRegistry] listener error:', err);
      }
    }
  }

  return {
    getAll() {
      return [...list];
    },

    getById(id) {
      return list.find((d) => d.id === id) || null;
    },

    getByLabel(label) {
      return list.find((d) => d.label === label) || null;
    },

    getSelected() {
      return list.find((d) => d.id === selectedId) || list[0] || null;
    },

    setSelected(id) {
      const match = list.find((d) => d.id === id);
      if (match && selectedId !== id) {
        selectedId = id;
        notify();
      }
      return this.getSelected();
    },

    getColor(labelOrId) {
      const entry = list.find((d) => d.id === labelOrId || d.label === labelOrId);
      return entry?.color || '#f59e0b';
    },

    add({ label, mm, color }) {
      const id = `diam-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newEntry = {
        id,
        label,
        mm: Number(mm) || 0,
        color: color || DIAMETER_PALETTE[list.length % DIAMETER_PALETTE.length],
      };
      list.push(newEntry);
      list.sort((a, b) => a.mm - b.mm);
      notify();
      return newEntry;
    },

    remove(id) {
      const idx = list.findIndex((d) => d.id === id);
      if (idx !== -1 && list.length > 1) {
        const [removed] = list.splice(idx, 1);
        if (selectedId === id) {
          selectedId = list[0].id;
        }
        notify();
        return removed;
      }
      return null;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
