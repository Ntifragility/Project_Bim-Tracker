//! `naming.json` vectors as Rust tests (task 3.2, spec R5).

use super::*;

#[test]
fn naming_tagged() {
    assert_eq!(tagged_name("Cable.ifc"), "Cable_tagged.ifc");
    assert_eq!(tagged_name("model.IFC"), "model_tagged.ifc");
    assert_eq!(tagged_name("plain"), "plain_tagged.ifc");
    assert_eq!(tagged_name(""), "model_tagged.ifc");
}

#[test]
fn naming_edited() {
    assert_eq!(edited_name("Cable Tray.ifc"), "Cable Tray_edited.ifc");
    assert_eq!(edited_name("a.IFC"), "a_edited.ifc");
    assert_eq!(edited_name("noext"), "noext_edited.ifc");
    assert_eq!(edited_name(""), "model_edited.ifc");
}
