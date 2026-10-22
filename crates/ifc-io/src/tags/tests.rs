//! `tags.json` extraction + plan vectors as Rust tests (task 3.2, spec R8-R9).

use super::*;

const FIXTURE: &str = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('0aaaaaaaaaaaaaaaaaaaaa',$,'Project',$,$,$,$,$,$);\n#10=IFCBUILDINGELEMENTPART('1aaaaaaaaaaaaaaaaaaaaa',$,'Tray',$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;\n";

fn with_tag_fixture() -> String {
    format!(
        "{FIXTURE}\n#11=IFCPROPERTYSINGLEVALUE('Tag',$,IFCLABEL('CT-001'),$);\n#12=IFCPROPERTYSET('g',$,'CCP_TAG',$,(#11));\n#13=IFCRELDEFINESBYPROPERTIES('g',$,$,$,(#10),#12);\n"
    )
}

fn with_tray_fixture() -> String {
    format!(
        "{FIXTURE}\n#11=IFCPROPERTYSINGLEVALUE('SystemTag',$,IFCLABEL('PT1'),$);\n#12=IFCPROPERTYSINGLEVALUE('ElementTag',$,IFCLABEL('PT1.01.01'),$);\n#13=IFCPROPERTYSINGLEVALUE('ComponentId',$,IFCLABEL('CT-001-C001'),$);\n#14=IFCPROPERTYSET('g',$,'CCP_TRAY_SYSTEM',$,(#11,#12,#13));\n#15=IFCRELDEFINESBYPROPERTIES('g',$,$,$,(#10),#14);\n"
    )
}

#[test]
fn tags_extract_project_basic() {
    let tags = extract_project_tags(&with_tag_fixture(), "CCP_TAG", "Tag");
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].local_id, 10);
    assert_eq!(tags[0].tag, "CT-001");
    assert_eq!(tags[0].property_id, 11);
}

#[test]
fn tags_extract_project_case_insensitive() {
    let tags = extract_project_tags(&with_tag_fixture(), "ccp_tag", "tag");
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].tag, "CT-001");
}

#[test]
fn tags_extract_tray_basic() {
    let list = extract_tray_assignments(&with_tray_fixture());
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].local_id, 10);
    assert_eq!(list[0].system_tag, "PT1");
    assert_eq!(list[0].element_tag, "PT1.01.01");
    assert_eq!(list[0].component_id, "CT-001-C001");
}

#[test]
fn tags_extract_tray_element_tag_defaults() {
    let src = FIXTURE.replace(
        "#10=IFCBUILDINGELEMENTPART",
        "#11=IFCPROPERTYSINGLEVALUE('SystemTag',$,IFCLABEL('S'),$);\n#12=IFCPROPERTYSINGLEVALUE('ComponentId',$,IFCLABEL('S-C001'),$);\n#13=IFCPROPERTYSET('g',$,'CCP_TRAY_SYSTEM',$,(#11,#12));\n#14=IFCRELDEFINESBYPROPERTIES('g',$,$,$,(#10),#13);\n#10=IFCBUILDINGELEMENTPART",
    );
    let list = extract_tray_assignments(&src);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].element_tag, "S-C001");
}

#[test]
fn tags_plan_update_create_skip() {
    let existing = vec![ProjectTag {
        local_id: 10,
        tag: "OLD".into(),
        property_id: 11,
    }];
    assert_eq!(
        plan_project_tag(10, "NEW", &[1, 10], &existing, 20),
        TagEditOp::UpdateProperty {
            property_id: 11,
            value: "NEW".into()
        }
    );
    assert_eq!(
        plan_project_tag(10, "CT-001", &[1, 10], &[], 11),
        TagEditOp::CreateProperty {
            local_id: 10,
            property_name: "Tag".into(),
            value: "CT-001".into()
        }
    );
    assert_eq!(
        plan_project_tag(10, "", &[1, 10], &[], 11),
        TagEditOp::Skip {
            reason: "empty-tag"
        }
    );
    assert_eq!(
        plan_project_tag(999, "CT-999", &[10], &[], 11),
        TagEditOp::Skip {
            reason: "element-not-found-in-source-ifc"
        }
    );
}
