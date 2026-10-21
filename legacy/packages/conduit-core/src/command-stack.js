// Command stack for undo/redo history.
// Supports arbitrary command objects with execute() and undo() methods.
// Trims to MAX_UNDO_DEPTH (default 200) to keep memory bounded.

import { MAX_UNDO_DEPTH } from './config.js';

export function createCommandStack({ maxDepth = MAX_UNDO_DEPTH } = {}) {
  let undoStack = [];
  let redoStack = [];
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.error('[CommandStack] listener error:', err);
      }
    }
  }

  return {
    get maxDepth() {
      return maxDepth;
    },

    get undoCount() {
      return undoStack.length;
    },

    get redoCount() {
      return redoStack.length;
    },

    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },

    execute(command) {
      if (!command || typeof command.execute !== 'function' || typeof command.undo !== 'function') {
        throw new Error('Command must implement execute() and undo() methods.');
      }
      command.execute();
      undoStack.push(command);
      if (undoStack.length > maxDepth) {
        undoStack.shift();
      }
      redoStack = [];
      notify();
      return command;
    },

    undo() {
      if (undoStack.length === 0) return null;
      const command = undoStack.pop();
      command.undo();
      redoStack.push(command);
      notify();
      return command;
    },

    redo() {
      if (redoStack.length === 0) return null;
      const command = redoStack.pop();
      command.execute();
      undoStack.push(command);
      notify();
      return command;
    },

    clear() {
      undoStack = [];
      redoStack = [];
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
