//! `tray-tagging`: scheme/allocation, classifier, validator, assignment state
//! (saved/pending/undo), Tag Register and Summary rows.
//!
//! Task 5.1 (`rust/tray-tagging`). Depends on `geom-core` / `ifc-io` only; never on
//! `conduit-core`, the DOM, Three.js or viewer code (ARCHITECTURE section 2,
//! rule 4). See `docs/specs/tray/tagging.md`; vectors in
//! `spec/vectors/tray/tagging.json` + `validator.json` (state/row vectors in
//! `spec/vectors/tray/tagging-state.json`, added by this task).

pub mod classifier;
pub mod rows;
pub mod scheme;
pub mod state;
pub mod validator;

pub use classifier::{classify_taggable_element, Classification, ElementRef as ClassifyElement};
pub use rows::{build_register_rows, build_summary_rows, RegisterRow, SummaryRow};
pub use scheme::{
    allocate_element_tags, format_element_tag, get_system_tag, is_supported_kind,
    normalize_tag_scheme, parse_generated_element_tag, validate_tag_scheme, AllocateResult,
    ElementRef, ExistingTag, ParsedTag, SchemeInput, SchemeValidation, TagAssignment, TagScheme,
    TypeCodes, DEFAULT_FITTING_CODE, DEFAULT_TRAY_CODE, MAX_SEQUENCE_DIGITS, SCHEME_VERSION,
};
pub use state::{
    apply_batch, assignment_key, effective_assignments, preview_conflict, undo_batch,
    BatchSnapshot, EffectiveElement, PendingEdit, SavedAssignment,
};
pub use validator::{
    validate_tag_integrity, ExcelTag, IntegrityCounts, IntegrityIssue, IntegrityReport,
    ValidElement,
};
