//! `conduit-core`: network, command stack, diameter registry, marker model,
//! snap, fitting (NEC bends), BOM stick optimizer, takeoff, CSV export,
//! project I/O.
//!
//! Task 4.1 (`rust/conduit-network`): network CRUD, minimal takeoff, history
//! model, registry seed. Depends on `geom-core` / `ifc-io` only; never on
//! `tray-*`, the DOM, Three.js or viewer code (ARCHITECTURE section 2).
//! See `docs/specs/conduit/network.md`; vectors in
//! `spec/vectors/conduit/network*.json`.

pub mod history;
pub mod network;
pub mod registry;
pub mod takeoff;

pub use history::{
    history_clear, history_execute, history_redo, history_undo, History, MAX_UNDO_DEPTH,
};
pub use network::{
    add_node, append_to_run, create_network, delete_run, drop_incomplete_runs, remove_last_point,
    set_stick_length, split_segment, start_run, update_run, validate_network, NetError, Network,
    NetworkFile, Node, Run, NETWORK_VERSION,
};
pub use registry::{
    default_diameters, find_diameter, palette_color, registry_color, sort_diameters, Diameter,
    DEFAULT_SELECTED_LABEL, DEFAULT_STICK_LENGTH_M, DIAMETER_PALETTE, PALETTE, UNKNOWN_COLOR,
};
pub use takeoff::{
    compute_run_takeoff, compute_takeoff, size_to_mm, RunTakeoff, Takeoff, TakeoffRun, TakeoffSize,
    TakeoffTotals, TAKEOFF_EPS,
};
