//! `ifc-io`: shared IFC text layer + tray read/write + conduit overlay read.
//!
//! Task 3.2 (`rust/ifc-io`). Depends on `geom-core` only (ARCHITECTURE
//! section 2, rule 2). See `docs/specs/ifc/base.md`; acceptance vectors in
//! `spec/vectors/ifc/*.json`.
//!
//! Rules (ARCHITECTURE.md section 3):
//! - metres internally (`f64`), IFC Z-up; STEP text is the only string I/O.
//! - pure: no I/O, no globals, no randomness. GUIDs come from a
//!   caller-injected function (owner-approved Q1); this crate only checks
//!   the GUID shape.
//! - panics are bugs: fallible operations return `Result`/`Option`.

pub mod guid;
pub mod naming;
pub mod overlay;
pub mod step;
pub mod tags;
pub mod validator;
pub mod value;

pub use guid::{is_guid_shape, GuidFn, GUID_ALPHABET};
pub use naming::{edited_name, tagged_name};
pub use overlay::{parse_conduit_overlay, OverlayError, OverlayRun};
pub use step::{entity_ids, escape_step, find_data_terminator, unescape_step};
pub use tags::{
    extract_project_tags, extract_tray_assignments, next_free_id, plan_project_tag, ProjectTag,
    TagEditOp, TrayAssignment,
};
pub use validator::{
    validate_tag_integrity, ExcelTag, ValidatedElement, ValidationError, ValidationReport,
    ValidationWarning,
};
pub use value::{format_typed_value, is_writable_pset, parse_value_type, IfcValueType, ValueError};
