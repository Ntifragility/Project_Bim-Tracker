//! `tray-routing`: centerline, graph, pathfinding, diagnostics, continuity check.
//!
//! Task 5.2 (`rust/tray-routing`). Depends on `geom-core` only; never on
//! `conduit-core`, the DOM, Three.js or viewer code (ARCHITECTURE section 2,
//! rule 4). See `docs/specs/tray/routing.md`; vectors in
//! `spec/vectors/tray/routing.json`. `vec` helpers are canonical in
//! `geom-core` (spec R9) — re-exported here, never forked.

pub mod centerline;
pub mod diagnostics;
pub mod graph;
pub mod pathfinding;

// R9: canonical vec helpers live in geom-core; re-export for the spec's
// interface surface.
pub use geom_core::vec3::{cross as vec_cross, length_sq as vec_length_sq};
pub use geom_core::vec3::{
    distance as vec_distance, dot as vec_dot, length as vec_length, mean as vec_mean,
    normalize as vec_normalize, scale as vec_scale, Vec3,
};

pub use centerline::{derive_centerline, Centerline};
pub use diagnostics::{diagnose_graph, Diagnosis, DEFAULT_MINIMUM_CONFIDENCE};
pub use graph::{
    build_connectivity_graph, connected_components, Component, Edge, EndpointRef, Graph, Node,
    SegmentRef, DEFAULT_TOLERANCE_M,
};
pub use pathfinding::{shortest_path, Path};

/// Add two vectors (legacy `vec.add` parity; `+` also works via `Add`).
#[must_use]
pub fn vec_add(a: Vec3, b: Vec3) -> Vec3 {
    Vec3::new(a.x + b.x, a.y + b.y, a.z + b.z)
}

/// Subtract two vectors (legacy `vec.sub` parity; `-` also works via `Sub`).
#[must_use]
pub fn vec_sub(a: Vec3, b: Vec3) -> Vec3 {
    Vec3::new(a.x - b.x, a.y - b.y, a.z - b.z)
}

#[cfg(test)]
mod vec_tests;
