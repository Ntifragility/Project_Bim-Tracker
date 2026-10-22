//! History model vectors as Rust tests (task 4.1, spec R9).

use super::*;

#[test]
fn history_sequence() {
    let h = History::with_depth(5);
    let h = history_execute(&h, "a".into());
    assert!(h.can_undo() && !h.can_redo());
    let h = history_execute(&h, "b".into());
    let (h, u) = history_undo(&h);
    assert_eq!(u.as_deref(), Some("b"));
    assert!(h.can_redo());
    let (h, r) = history_redo(&h);
    assert_eq!(r.as_deref(), Some("b"));
    let (h, _) = history_undo(&h);
    let (h, _) = history_undo(&h);
    assert!(!h.can_undo());
    assert_eq!(h.undo_count(), 0);
}

#[test]
fn history_max_depth() {
    let mut h = History::with_depth(3);
    for i in 0..5 {
        h = history_execute(&h, format!("c{i}"));
    }
    assert_eq!(h.undo_count(), 3);
    assert_eq!(
        h.undo,
        vec!["c2".to_string(), "c3".to_string(), "c4".to_string()]
    );
}

#[test]
fn history_empty_and_clear() {
    let h = History::new();
    let (_, u) = history_undo(&h);
    assert_eq!(u, None);
    let (_, r) = history_redo(&h);
    assert_eq!(r, None);
    let h = history_execute(&h, "x".into());
    let h = history_clear(&h);
    assert!(!h.can_undo() && !h.can_redo());
}
