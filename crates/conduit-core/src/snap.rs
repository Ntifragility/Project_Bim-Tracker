//! Conduit snap engine: Revit-style precision snapping (task 4.2).
//!
//! Direct port of `legacy/packages/conduit-core/src/snap-engine.js`:
//! node/segment/midpoint snapping, polar angle guides, 3-axis ortho lock,
//! elevation-plane raycast, and the priority-chain `resolve` — with class
//! state replaced by an explicit [`SnapConfig`] struct. Vector math
//! delegates to `geom-core`; network binding (`findSnap`) lives in 4.1.

use crate::network::Network;
use geom_core::{vec3, Vec3};

const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;
const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;
const EPSILON: f64 = 1e-7;

/// Snap result type (legacy `snapType` parity).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapType {
    Endpoint,
    Midpoint,
    Segment,
    PolarAngle,
    Ortho,
    Workplane,
}

/// One snap candidate (legacy `SnapCandidate` parity).
#[derive(Debug, Clone, PartialEq)]
pub struct SnapCandidate {
    pub point: Vec3,
    pub snap_type: SnapType,
    pub distance: f64,
    pub target_id: Option<String>,
    pub angle_deg: Option<f64>,
    pub guide_axis: Option<char>,
    pub t: Option<f64>,
}

/// A snap target node.
#[derive(Debug, Clone, PartialEq)]
pub struct SnapNode {
    pub id: String,
    pub point: Vec3,
}

/// A snap target segment.
#[derive(Debug, Clone, PartialEq)]
pub struct SnapSegment {
    pub id: String,
    pub start: Vec3,
    pub end: Vec3,
}

/// Explicit snap configuration (legacy `SnapEngine` constructor parity).
#[derive(Debug, Clone, PartialEq)]
pub struct SnapConfig {
    pub tolerance_m: f64,
    pub angular_tolerance_deg: f64,
    pub up_axis_y: bool,
    pub polar_enabled: bool,
    pub ortho_enabled: bool,
    pub endpoint_enabled: bool,
    pub midpoint_enabled: bool,
    pub segment_enabled: bool,
    pub allowed_polar_angles: Vec<f64>,
}

impl Default for SnapConfig {
    fn default() -> Self {
        SnapConfig {
            tolerance_m: 0.25,
            angular_tolerance_deg: 4.5,
            up_axis_y: true,
            polar_enabled: true,
            ortho_enabled: false,
            endpoint_enabled: true,
            midpoint_enabled: true,
            segment_enabled: true,
            allowed_polar_angles: vec![0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0],
        }
    }
}

/// Closest point on segment `a -> b` to `p` (delegates to `geom-core`;
/// degenerate segments clamp to `a`, legacy parity via `segment`).
#[must_use]
pub fn closest_on_segment(p: Vec3, a: Vec3, b: Vec3) -> geom_core::ClosestPoint {
    geom_core::segment::closest_on_segment(p, a, b)
}

/// Snap to the nearest node within `tol` metres (legacy `snapToNodes` parity).
#[must_use]
pub fn snap_to_nodes(query: Vec3, nodes: &[SnapNode], tol: f64) -> Option<SnapCandidate> {
    let mut closest: Option<SnapCandidate> = None;
    let mut min_distance = tol;
    for node in nodes {
        let d = vec3::distance(query, node.point);
        if d <= min_distance {
            min_distance = d;
            closest = Some(SnapCandidate {
                point: node.point,
                snap_type: SnapType::Endpoint,
                distance: d,
                target_id: Some(node.id.clone()),
                angle_deg: None,
                guide_axis: None,
                t: None,
            });
        }
    }
    closest
}

/// Snap to segment centerlines/midpoints (legacy `snapToSegments` parity).
#[must_use]
pub fn snap_to_segments(
    query: Vec3,
    segments: &[SnapSegment],
    tol: f64,
    midpoint_threshold: f64,
) -> Option<SnapCandidate> {
    let mut closest: Option<SnapCandidate> = None;
    let mut min_distance = tol;
    for seg in segments {
        let hit = closest_on_segment(query, seg.start, seg.end);
        if hit.distance <= min_distance && hit.t > 0.02 && hit.t < 0.98 {
            min_distance = hit.distance;
            let is_mid = (hit.t - 0.5).abs() <= midpoint_threshold;
            let snap_point = if is_mid {
                vec3::scale(seg.start + seg.end, 0.5)
            } else {
                hit.point
            };
            closest = Some(SnapCandidate {
                point: snap_point,
                snap_type: if is_mid {
                    SnapType::Midpoint
                } else {
                    SnapType::Segment
                },
                distance: if is_mid {
                    vec3::distance(query, snap_point)
                } else {
                    hit.distance
                },
                target_id: Some(seg.id.clone()),
                angle_deg: None,
                guide_axis: None,
                t: Some(if is_mid { 0.5 } else { hit.t }),
            });
        }
    }
    closest
}

/// Polar angle snap on the horizontal plane (legacy `snapPolarAngle` parity).
#[must_use]
pub fn snap_polar_angle(
    from: Vec3,
    to: Vec3,
    allowed: &[f64],
    tol_deg: f64,
    up_axis_y: bool,
) -> Option<SnapCandidate> {
    let dx = to.x - from.x;
    let d_plane = if up_axis_y {
        to.z - from.z
    } else {
        to.y - from.y
    };
    let radial = dx.hypot(d_plane);
    if radial < 0.05 {
        return None;
    }
    let mut raw = d_plane.atan2(dx) * RAD_TO_DEG;
    if raw < 0.0 {
        raw += 360.0;
    }
    let mut best: Option<f64> = None;
    let mut min_diff = tol_deg;
    for angle in allowed {
        let target = ((angle % 360.0) + 360.0) % 360.0;
        let mut diff = (raw - target).abs();
        if diff > 180.0 {
            diff = 360.0 - diff;
        }
        if diff <= min_diff {
            min_diff = diff;
            best = Some(target);
        }
    }
    let snapped_angle = best?;
    let rad = snapped_angle * DEG_TO_RAD;
    let snapped_x = from.x + radial * rad.cos();
    let snapped_plane = if up_axis_y { from.z } else { from.y } + radial * rad.sin();
    let point = if up_axis_y {
        Vec3::new(snapped_x, from.y, snapped_plane)
    } else {
        Vec3::new(snapped_x, snapped_plane, from.z)
    };
    let guide = if snapped_angle % 90.0 == 0.0 {
        Some(if snapped_angle % 180.0 == 0.0 {
            'X'
        } else if up_axis_y {
            'Z'
        } else {
            'Y'
        })
    } else {
        None
    };
    Some(SnapCandidate {
        point,
        snap_type: SnapType::PolarAngle,
        distance: vec3::distance(to, point),
        target_id: None,
        angle_deg: Some(snapped_angle),
        guide_axis: guide,
        t: None,
    })
}

/// 3-axis ortho lock (legacy `snapOrtho3D` parity: Y tie-break first).
#[must_use]
pub fn snap_ortho_3d(from: Vec3, to: Vec3) -> SnapCandidate {
    let dx = (to.x - from.x).abs();
    let dy = (to.y - from.y).abs();
    let dz = (to.z - from.z).abs();
    let max = dx.max(dy).max(dz);
    let (point, axis) = if max == dy {
        (Vec3::new(from.x, to.y, from.z), 'Y')
    } else if max == dx {
        (Vec3::new(to.x, from.y, from.z), 'X')
    } else {
        (Vec3::new(from.x, from.y, to.z), 'Z')
    };
    SnapCandidate {
        point,
        snap_type: SnapType::Ortho,
        distance: vec3::distance(to, point),
        target_id: None,
        angle_deg: None,
        guide_axis: Some(axis),
        t: None,
    }
}

/// Elevation-plane raycast with horizon fallback (legacy parity).
#[must_use]
pub fn raycast_elevation_plane(
    origin: Vec3,
    dir: Vec3,
    elevation: f64,
    up_axis_y: bool,
    last: Option<Vec3>,
) -> Vec3 {
    let origin_h = if up_axis_y { origin.y } else { origin.z };
    let dir_h = if up_axis_y { dir.y } else { dir.z };
    if dir_h.abs() > EPSILON {
        let t = (elevation - origin_h) / dir_h;
        if t > 0.0 {
            let mut hit = origin + vec3::scale(dir, t);
            if up_axis_y {
                hit.y = elevation;
            } else {
                hit.z = elevation;
            }
            return hit;
        }
    }
    let fallback = last.map_or(10.0, |l| 5.0f64.max(vec3::distance(origin, l)));
    let mut fwd = origin + vec3::scale(dir, fallback);
    if up_axis_y {
        fwd.y = elevation;
    } else {
        fwd.z = elevation;
    }
    fwd
}

/// Priority-chain resolve (legacy `SnapEngine.resolve` parity).
#[must_use]
pub fn resolve(
    raw: Vec3,
    cfg: &SnapConfig,
    last: Option<Vec3>,
    nodes: &[SnapNode],
    segments: &[SnapSegment],
) -> SnapCandidate {
    if cfg.endpoint_enabled && !nodes.is_empty() {
        if let Some(snap) = snap_to_nodes(raw, nodes, cfg.tolerance_m) {
            return snap;
        }
    }
    if (cfg.midpoint_enabled || cfg.segment_enabled) && !segments.is_empty() {
        if let Some(snap) = snap_to_segments(raw, segments, cfg.tolerance_m, 0.08) {
            match snap.snap_type {
                SnapType::Midpoint if cfg.midpoint_enabled => return snap,
                SnapType::Segment if cfg.segment_enabled => return snap,
                _ => {}
            }
        }
    }
    if cfg.ortho_enabled {
        if let Some(anchor) = last {
            return snap_ortho_3d(anchor, raw);
        }
    }
    if cfg.polar_enabled {
        if let Some(anchor) = last {
            if let Some(snap) = snap_polar_angle(
                anchor,
                raw,
                &cfg.allowed_polar_angles,
                cfg.angular_tolerance_deg,
                cfg.up_axis_y,
            ) {
                return snap;
            }
        }
    }
    SnapCandidate {
        point: raw,
        snap_type: SnapType::Workplane,
        distance: 0.0,
        target_id: None,
        angle_deg: None,
        guide_axis: None,
        t: None,
    }
}

/// Network-bound snap hit (legacy `findSnap` result parity).
#[derive(Debug, Clone, PartialEq)]
pub enum FindSnapHit {
    Node {
        node_id: String,
        point: Vec3,
        distance: f64,
    },
    Segment {
        run_id: String,
        index: usize,
        point: Vec3,
        distance: f64,
    },
}

fn network_point(net: &Network, node_id: &str) -> Option<Vec3> {
    net.nodes
        .iter()
        .find(|n| n.id == *node_id)
        .map(|n| Vec3::new(n.x, n.y, n.z))
}

/// Nearest node within `tolerance_m`, otherwise the nearest point on a
/// segment within `tolerance_m` (`legacy snap.js:findSnap` parity, task 4.5).
///
/// Nodes short-circuit the segment stage (R3); endpoint `t` values are
/// skipped (R4); pairs with a missing endpoint node are skipped (R6
/// deviation: legacy throws a `TypeError` here, unreachable after
/// `validate_network`).
#[must_use]
pub fn find_snap(net: &Network, point: Vec3, tolerance_m: f64) -> Option<FindSnapHit> {
    let mut best: Option<FindSnapHit> = None;
    for node in &net.nodes {
        let d = vec3::distance(Vec3::new(node.x, node.y, node.z), point);
        let better = best
            .as_ref()
            .map(|b| match b {
                FindSnapHit::Node { distance, .. } | FindSnapHit::Segment { distance, .. } => {
                    d < *distance
                }
            })
            .unwrap_or(true);
        if d <= tolerance_m && better {
            best = Some(FindSnapHit::Node {
                node_id: node.id.clone(),
                point: Vec3::new(node.x, node.y, node.z),
                distance: d,
            });
        }
    }
    if best.is_some() {
        return best;
    }
    for run in &net.runs {
        for index in 0..run.node_ids.len().saturating_sub(1) {
            let (Some(a), Some(b)) = (
                network_point(net, &run.node_ids[index]),
                network_point(net, &run.node_ids[index + 1]),
            ) else {
                continue;
            };
            let hit = closest_on_segment(point, a, b);
            if hit.t <= 0.0 || hit.t >= 1.0 || hit.distance > tolerance_m {
                continue;
            }
            let better =
                best.as_ref()
                    .map(|b| match b {
                        FindSnapHit::Node { distance, .. }
                        | FindSnapHit::Segment { distance, .. } => hit.distance < *distance,
                    })
                    .unwrap_or(true);
            if better {
                best = Some(FindSnapHit::Segment {
                    run_id: run.id.clone(),
                    index,
                    point: hit.point,
                    distance: hit.distance,
                });
            }
        }
    }
    best
}

#[cfg(test)]
mod tests;
