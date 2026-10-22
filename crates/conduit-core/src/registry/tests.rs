//! Registry seed vectors as Rust tests (task 4.1, spec R10).

use super::*;

#[test]
fn registry_defaults() {
    let list = default_diameters();
    assert!(list.len() >= 9);
    assert_eq!(
        list[0],
        Diameter {
            id: "diam-1".into(),
            label: "½\"".into(),
            mm: 12.7,
            color: PALETTE[0].into()
        }
    );
    assert!(list.iter().any(|d| d.label == "¾\""));
    assert!(list.iter().any(|d| d.label == "4\""));
    assert_eq!(DEFAULT_SELECTED_LABEL, "¾\"");
}

#[test]
fn registry_lookup_and_color() {
    let list = default_diameters();
    let one = find_diameter(&list, "1\"").unwrap();
    assert!((one.mm - 25.4).abs() < 1e-9);
    assert_eq!(registry_color(&list, "1\""), "#10b981");
    assert_eq!(registry_color(&list, "nope"), UNKNOWN_COLOR);
    assert_eq!(registry_color(&list, &one.id), "#10b981");
}

#[test]
fn registry_sort_and_palette() {
    let mut list = vec![
        Diameter {
            id: "b".into(),
            label: "2\"".into(),
            mm: 50.8,
            color: "x".into(),
        },
        Diameter {
            id: "a".into(),
            label: "1\"".into(),
            mm: 25.4,
            color: "y".into(),
        },
    ];
    sort_diameters(&mut list);
    assert_eq!(list[0].label, "1\"");
    assert_eq!(palette_color(0), PALETTE[0]);
    assert_eq!(palette_color(10), PALETTE[0]); // wraps
}
