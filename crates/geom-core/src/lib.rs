//! `geom-core`: shared 3D geometry primitives (task 3.1).
//!
//! Pure-Rust home for every geometric primitive the product cores share:
//! 3D vectors, segment queries, unit conversion, and the scene <-> IFC
//! coordinate frame. See `docs/specs/geom/base.md`; acceptance vectors in
//! `spec/vectors/geom/*.json`.
//!
//! Rules (ARCHITECTURE.md section 3):
//! - metres internally (`f64`), IFC Z-up; imperial converts at the TS edge.
//! - pure: no I/O, no globals, no randomness; expected errors are `Result`.
//! - pansics are bugs: fallible operations return `Result`/`Option`.

pub mod frames;
pub mod segment;
pub mod units;
pub mod vec3;

pub use frames::Mat4;
pub use segment::ClosestPoint;
pub use units::Unit;
pub use vec3::Vec3;
