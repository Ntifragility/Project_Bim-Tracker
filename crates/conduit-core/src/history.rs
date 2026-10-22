//! Undo/redo history MODEL without closures (task 4.1, spec R9).
//!
//! Direct port of the stack discipline in
//! `legacy/packages/conduit-core/src/command-stack.js`: `execute` pushes
//! and clears redo, trimming to `max_depth`; `undo`/`redo` move labels
//! between stacks. The TS side owns the `execute()`/`undo()` closures and
//! listeners (conduit `io.json` R8: they never port to Rust). Labels here
//! are opaque command descriptions used only for history bookkeeping.

/// Maximum undo depth (legacy `MAX_UNDO_DEPTH = 200` parity).
pub const MAX_UNDO_DEPTH: usize = 200;

/// History stacks of opaque command labels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct History {
    pub undo: Vec<String>,
    pub redo: Vec<String>,
    pub max_depth: usize,
}

impl History {
    /// Empty history with the default depth.
    #[must_use]
    pub fn new() -> Self {
        Self::with_depth(MAX_UNDO_DEPTH)
    }

    /// Empty history with an explicit depth.
    #[must_use]
    pub fn with_depth(max_depth: usize) -> Self {
        History {
            undo: Vec::new(),
            redo: Vec::new(),
            max_depth,
        }
    }

    /// Undo-stack length (legacy `undoCount` parity).
    #[must_use]
    pub fn undo_count(&self) -> usize {
        self.undo.len()
    }

    /// Redo-stack length (legacy `redoCount` parity).
    #[must_use]
    pub fn redo_count(&self) -> usize {
        self.redo.len()
    }

    /// Whether undo is available (legacy `canUndo` parity).
    #[must_use]
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Whether redo is available (legacy `canRedo` parity).
    #[must_use]
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

impl Default for History {
    fn default() -> Self {
        Self::new()
    }
}

/// Execute: push the label, clear redo, trim to `max_depth`
/// (legacy `execute` parity minus the closure call + listeners).
#[must_use]
pub fn history_execute(hist: &History, label: String) -> History {
    let mut next = hist.clone();
    next.undo.push(label);
    if next.undo.len() > next.max_depth {
        next.undo.remove(0);
    }
    next.redo.clear();
    next
}

/// Undo: pop the latest label onto redo (legacy `undo` parity).
/// Returns the new history plus the undone label (`None` when empty).
#[must_use]
pub fn history_undo(hist: &History) -> (History, Option<String>) {
    let mut next = hist.clone();
    let label = next.undo.pop();
    if let Some(label) = label.clone() {
        next.redo.push(label);
    }
    (next, label)
}

/// Redo: pop the latest redo label back onto undo (legacy `redo` parity).
#[must_use]
pub fn history_redo(hist: &History) -> (History, Option<String>) {
    let mut next = hist.clone();
    let label = next.redo.pop();
    if let Some(label) = label.clone() {
        next.undo.push(label);
    }
    (next, label)
}

/// Clear both stacks (legacy `clear` parity).
#[must_use]
pub fn history_clear(hist: &History) -> History {
    let mut next = hist.clone();
    next.undo.clear();
    next.redo.clear();
    next
}

#[cfg(test)]
mod tests;
