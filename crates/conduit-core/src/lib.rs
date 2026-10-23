//! `conduit-core`: network, command stack, diameter registry, marker model,
//! snap, fitting (NEC bends), BOM stick optimizer, takeoff, CSV export,
//! project I/O.
//!
//! Tasks 4.1 (`rust/conduit-network`) + 4.2 (`rust/conduit-snap`) + 4.3
//! (`rust/conduit-fitting`) + 4.4 (`rust/conduit-bom`) + 4.5
//! (`rust/conduit-takeoff-io`: network snap binding). Depends on
//! `geom-core` / `ifc-io` only; never on `tray-*`, the DOM, Three.js or
//! viewer code (ARCHITECTURE section 2).
//! See `docs/specs/conduit/network.md` + `snap.md` + `fitting.md` +
//! `bom.md` + `takeoff-io.md`; vectors in `spec/vectors/conduit/network*.json` +
//! `snap-engine.json` + `fitting-engine.json` + `bom-engine.json` +
//! `takeoff-io-engine.json`.

pub mod bom;
pub mod fitting;
pub mod history;
pub mod network;
pub mod registry;
pub mod snap;
pub mod takeoff;

pub use bom::{
    compute_detailed_bom, optimize_stick_cutting, BomOptions, BomTotals, CuttingPlan, DetailedBom,
    RunBom, SizeBom, StickPlan, DEFAULT_STICK_LENGTH_M as BOM_DEFAULT_STICK_M, KERF_WASTE_M,
    MAX_PULL_DISTANCE_M,
};
pub use fitting::{
    analyze_run_bends, bend_angle, nec_bend_radius_m, solve_auto_riser, solve_elbow, BendInfo,
    ElbowSolution, NecBendRow, NecQuery, RiserNode, RunBends, DEFAULT_BEND_RADIUS_M,
    NEC_BEND_TABLE,
};
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
pub use snap::{
    closest_on_segment, find_snap, raycast_elevation_plane, resolve, snap_ortho_3d,
    snap_polar_angle, snap_to_nodes, snap_to_segments, FindSnapHit, SnapCandidate, SnapConfig,
    SnapNode, SnapSegment, SnapType,
};
pub use takeoff::{
    compute_run_takeoff, compute_takeoff, size_to_mm, RunTakeoff, Takeoff, TakeoffRun, TakeoffSize,
    TakeoffTotals, TAKEOFF_EPS,
};
