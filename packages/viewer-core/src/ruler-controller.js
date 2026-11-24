// Revizto-style 5-Mode Ruler controller for viewer-core.
//
// Modes:
//   1. 'laser'         - 1-click surface-normal perpendicular distance ray
//   2. 'p2p'           - Point-to-point distance (Regular or Chain) + IFC Z-up ΔX/ΔY/ΔZ + Slope
//   3. 'min-distance'  - Shortest 3D clearance (or 0.000 clash) between any 2 objects
//   4. 'elevation'     - Spot IFC Z elevation & vertical clear drop (Shift+Click for 2-pt ΔZ)
//   5. 'angle'         - 3-point interior angle (P1 -> Vertex -> P3)

import * as THREE from "three";
import {
  MEASUREMENT_UNITS,
  MEASUREMENT_UNIT_LABELS,
  collectWorldTrianglesFromObject,
  computeMinDistance,
  extractItemWorldTriangles,
  formatMeasurementLength,
} from "./min-distance-solver.js";
import { isPointClippedByPlanes } from "./section-controller.js";

export const RULER_MODES = ["laser", "p2p", "min-distance", "elevation", "angle"];

export const RULER_COLOR_PRESETS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
];

/**
 * Pure helper: computes IFC Z-up delta vector, horizontal run, 3D length & slope angle.
 */
export function computeIfcDelta(coords, pointA, pointB) {
  const toIfc = (pt) => {
    if (coords && typeof coords.toOriginal === "function") {
      return coords.toOriginal(pt);
    }
    return new THREE.Vector3(pt.x, -pt.z, pt.y);
  };
  const aIfc = toIfc(pointA);
  const bIfc = toIfc(pointB);
  const dx = bIfc.x - aIfc.x;
  const dy = bIfc.y - aIfc.y;
  const dz = bIfc.z - aIfc.z;
  const horizDist = Math.hypot(dx, dy);
  const totalDist = Math.hypot(dx, dy, dz);
  const slopeDeg = horizDist > 1e-6 ? (Math.atan2(Math.abs(dz), horizDist) * 180) / Math.PI : Math.abs(dz) > 1e-6 ? 90 : 0;
  return {
    aIfc,
    bIfc,
    dx,
    dy,
    dz,
    horizDist,
    totalDist,
    slopeDeg,
  };
}

/**
 * Pure helper: computes interior angle (in degrees, [0, 180]) at `vertex` between `vertex->a` and `vertex->c`.
 */
export function computeAngleDegrees(a, vertex, c) {
  const v1 = new THREE.Vector3(a.x - vertex.x, a.y - vertex.y, a.z - vertex.z);
  const v2 = new THREE.Vector3(c.x - vertex.x, c.y - vertex.y, c.z - vertex.z);
  const len1 = v1.length();
  const len2 = v2.length();
  if (len1 < 1e-8 || len2 < 1e-8) return 0;
  v1.divideScalar(len1);
  v2.divideScalar(len2);
  const dot = Math.max(-1, Math.min(1, v1.dot(v2)));
  return (Math.acos(dot) * 180) / Math.PI;
}

function disposeObject3D(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}

function setOverlayOrder(obj, order = 998) {
  obj.traverse((child) => {
    child.renderOrder = order;
  });
}

export function createRulerController({
  world,
  fragments,
  coordinates,
  highlighter,
  section,
  pick,
} = {}) {
  const scene = world?.scene?.three || null;
  const camera = world?.camera?.three || null;

  const rootGroup = new THREE.Group();
  rootGroup.name = "__revizto_ruler_root__";
  if (scene) scene.add(rootGroup);

  const previewGroup = new THREE.Group();
  previewGroup.name = "__revizto_ruler_preview__";
  rootGroup.add(previewGroup);

  // Snap point indicator shown while ruler mode is active (crisp solid Revizto-style dot)
  const reticleGeo = new THREE.SphereGeometry(0.026, 14, 14);
  const reticleMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
  reticleMesh.visible = false;
  reticleMesh.renderOrder = 999;
  rootGroup.add(reticleMesh);

  const externalPickSources = new Map(); // key -> { object3D, labelResolver }
  const listeners = new Set();

  let overlayContainer = null;
  let rafId = null;
  let disposed = false;
  let nextMeasurementId = 1;
  let lastPointerNdc = null;
  let lastPreviewPoint = null;
  let hoverStatusText = "";
  let isComputingAsync = false;

  const state = {
    active: false,
    mode: "p2p",
    chain: false,
    unit: "m",
    color: "#ef4444",
    showDeltas: true,
    snapEnabled: true,
    draftPoints: [], // Vector3[] for p2p / elevation / angle
    draftObjects: [], // picked object descriptors for min-distance
    measurements: [],
  };

  function ensureOverlayContainer() {
    if (overlayContainer || typeof document === "undefined") return overlayContainer;
    const canvas = world?.renderer?.three?.domElement;
    const host = canvas?.parentElement;
    if (!host) return null;
    const el = document.createElement("div");
    el.className = "rc-ruler-overlay-layer";
    el.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:25;";
    host.appendChild(el);
    overlayContainer = el;
    return el;
  }

  function snapshotState() {
    return {
      active: state.active,
      mode: state.mode,
      chain: state.chain,
      unit: state.unit,
      color: state.color,
      showDeltas: state.showDeltas,
      snapEnabled: state.snapEnabled,
      count: state.measurements.length,
      draftCount: state.mode === "min-distance" ? state.draftObjects.length : state.draftPoints.length,
      isComputing: isComputingAsync,
      hintText: buildHintText(),
      measurements: state.measurements.map((m) => ({
        id: m.id,
        kind: m.kind,
        color: m.color,
        label: m.label,
        tooltip: m.tooltip,
        clashing: Boolean(m.clashing),
      })),
    };
  }

  function buildHintText() {
    if (!state.active) return "";
    if (isComputingAsync) return "Computing shortest clearance...";
    switch (state.mode) {
      case "laser":
        return hoverStatusText || "Laser: click a surface to measure perpendicular distance";
      case "p2p":
        if (state.draftPoints.length === 0) {
          return state.chain ? "Chain: click start point" : "Click first point";
        }
        return state.chain
          ? "Chain: click next point (Esc or right-click to finish chain)"
          : "Click second point";
      case "min-distance":
        if (state.draftObjects.length === 0) {
          return "MIN: click first object (IFC element or conduit)";
        }
        return `MIN: ${state.draftObjects[0].label || "Object 1"} selected — click second object`;
      case "elevation":
        if (state.draftPoints.length === 1) {
          return "Elevation ΔZ: click second point to measure height difference";
        }
        return hoverStatusText || "Elevation: click point for Spot Z & drop (Shift+Click for 2-pt ΔZ)";
      case "angle":
        if (state.draftPoints.length === 0) return "Angle: click first leg point";
        if (state.draftPoints.length === 1) return "Angle: click vertex point";
        return "Angle: click second leg point";
      default:
        return "";
    }
  }

  function emit() {
    const snap = snapshotState();
    for (const cb of listeners) {
      try {
        cb(snap);
      } catch {
        // Ignore listener errors.
      }
    }
  }

  function getActivePlanes() {
    return section?.getActivePlanes?.() || [];
  }

  function projectToScreen(point) {
    if (!camera || !world?.renderer?.three) return null;
    const canvas = world.renderer.three.domElement;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (!width || !height) return null;

    const projected = point.clone().project(camera);
    if (projected.z > 1 || projected.z < -1) return null;
    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (-projected.y * 0.5 + 0.5) * height,
    };
  }

  function formatDeltaTooltip(delta) {
    const u = state.unit;
    const dx = formatMeasurementLength(delta.dx, u, { showPlus: true });
    const dy = formatMeasurementLength(delta.dy, u, { showPlus: true });
    const dz = formatMeasurementLength(delta.dz, u, { showPlus: true });
    const slope = `${delta.slopeDeg.toFixed(1)}°`;
    return `ΔX ${dx} · ΔY ${dy} · ΔZ ${dz} · Slope ${slope}`;
  }

  function formatMeasurementTexts(m) {
    const u = state.unit;
    switch (m.kind) {
      case "laser": {
        const d = m.points[0].distanceTo(m.points[1]);
        return {
          label: `⊥ ${formatMeasurementLength(d, u)}`,
          tooltip: formatDeltaTooltip(computeIfcDelta(coordinates, m.points[0], m.points[1])),
        };
      }
      case "p2p": {
        const delta = computeIfcDelta(coordinates, m.points[0], m.points[1]);
        return {
          label: formatMeasurementLength(delta.totalDist, u),
          tooltip: formatDeltaTooltip(delta),
        };
      }
      case "min-distance": {
        if (m.clashing) {
          return {
            label: `CLASH ${formatMeasurementLength(0, u)}`,
            tooltip: `${m.labelA || "Object A"} ↔ ${m.labelB || "Object B"} intersect`,
          };
        }
        const d = m.points[0].distanceTo(m.points[1]);
        const delta = computeIfcDelta(coordinates, m.points[0], m.points[1]);
        return {
          label: `MIN ${formatMeasurementLength(d, u)}`,
          tooltip: `${m.labelA || "A"} ↔ ${m.labelB || "B"} · ${formatDeltaTooltip(delta)}`,
        };
      }
      case "elevation": {
        if (m.points.length >= 2 && m.isDrop) {
          const d = Math.abs(computeIfcDelta(coordinates, m.points[0], m.points[1]).dz);
          const elStr = formatMeasurementLength(m.ifcZ, u, { showPlus: true });
          const dropStr = formatMeasurementLength(d, u);
          return {
            label: `EL ${elStr} · ↓ ${dropStr}`,
            tooltip: `Top Z ${elStr} to surface ${formatMeasurementLength(m.ifcZ2, u, { showPlus: true })}`,
          };
        }
        if (m.points.length >= 2) {
          const dz = Math.abs(computeIfcDelta(coordinates, m.points[0], m.points[1]).dz);
          return {
            label: `ΔZ ${formatMeasurementLength(dz, u)}`,
            tooltip: `Z₁ ${formatMeasurementLength(m.ifcZ, u, { showPlus: true })} → Z₂ ${formatMeasurementLength(m.ifcZ2, u, { showPlus: true })}`,
          };
        }
        return {
          label: `EL ${formatMeasurementLength(m.ifcZ, u, { showPlus: true })}`,
          tooltip: `Spot elevation in ${MEASUREMENT_UNIT_LABELS[u] || u}`,
        };
      }
      case "angle": {
        return {
          label: `∠ ${m.angleDeg.toFixed(1)}°`,
          tooltip: `Interior vertex angle (${m.angleDeg.toFixed(2)}°)`,
        };
      }
      default:
        return { label: "", tooltip: "" };
    }
  }

  function createBadgeElement(m) {
    const container = ensureOverlayContainer();
    if (!container) return null;
    const badge = document.createElement("div");
    badge.className = "rc-ruler-badge";
    if (m.clashing) badge.classList.add("is-clash");
    badge.style.setProperty("--ruler-color", m.clashing ? "#ef4444" : m.color);
    badge.style.pointerEvents = "auto";
    badge.title = m.tooltip || "";

    const textSpan = document.createElement("span");
    textSpan.className = "rc-ruler-badge-text";
    textSpan.textContent = m.label;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "rc-ruler-badge-del";
    delBtn.title = "Remove measurement";
    delBtn.setAttribute("aria-label", "Remove measurement");
    delBtn.textContent = "×";
    delBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeMeasurement(m.id);
    });

    badge.appendChild(textSpan);
    badge.appendChild(delBtn);
    container.appendChild(badge);
    return badge;
  }

  function createLivePreviewBadge() {
    const container = ensureOverlayContainer();
    if (!container) return null;
    const el = document.createElement("div");
    el.className = "rc-ruler-badge is-preview";
    el.style.display = "none";
    container.appendChild(el);
    return el;
  }

  let liveBadgeEl = null;
  let liveBadgeAnchor = null;

  function updateOverlayLabels() {
    if (disposed) return;
    if (camera) camera.updateMatrixWorld();

    for (const m of state.measurements) {
      if (!m.badgeEl || !m.anchor) continue;
      const pos = projectToScreen(m.anchor);
      if (!pos) {
        m.badgeEl.style.display = "none";
        continue;
      }
      m.badgeEl.style.display = "inline-flex";
      m.badgeEl.style.left = `${pos.x.toFixed(1)}px`;
      m.badgeEl.style.top = `${pos.y.toFixed(1)}px`;
    }

    if (liveBadgeEl) {
      if (state.active && liveBadgeAnchor && liveBadgeEl.textContent) {
        const pos = projectToScreen(liveBadgeAnchor);
        if (pos) {
          liveBadgeEl.style.display = "inline-flex";
          liveBadgeEl.style.left = `${pos.x.toFixed(1)}px`;
          liveBadgeEl.style.top = `${pos.y.toFixed(1)}px`;
        } else {
          liveBadgeEl.style.display = "none";
        }
      } else {
        liveBadgeEl.style.display = "none";
      }
    }
  }

  function startOverlaySyncLoop() {
    if (rafId !== null || typeof requestAnimationFrame === "undefined") return;
    const step = () => {
      if (disposed) {
        rafId = null;
        return;
      }
      if (!state.active && state.measurements.length === 0) {
        rafId = null;
        return;
      }
      updateOverlayLabels();
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  function createPointMarker(point, colorHex, radius = 0.03) {
    const geo = new THREE.SphereGeometry(radius, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: false,
      transparent: true,
      opacity: 0.98,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    return mesh;
  }

  function createLineSegment(a, b, colorHex, dashed = false) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = dashed
      ? new THREE.LineDashedMaterial({
          color: colorHex,
          dashSize: 0.14,
          gapSize: 0.08,
          depthTest: false,
          transparent: true,
          opacity: 0.72,
        })
      : new THREE.LineBasicMaterial({
          color: colorHex,
          depthTest: false,
          transparent: true,
          opacity: 0.96,
        });
    const line = new THREE.Line(geo, mat);
    if (dashed) line.computeLineDistances();
    return line;
  }

  function addDeltaHelperLines(group, a, b) {
    const c1 = new THREE.Vector3(b.x, a.y, a.z);
    const c2 = new THREE.Vector3(b.x, a.y, b.z);
    if (a.distanceToSquared(c1) > 1e-6) {
      group.add(createLineSegment(a, c1, "#ef4444", true));
    }
    if (c1.distanceToSquared(c2) > 1e-6) {
      group.add(createLineSegment(c1, c2, "#22c55e", true));
    }
    if (c2.distanceToSquared(b) > 1e-6) {
      group.add(createLineSegment(c2, b, "#3b82f6", true));
    }
  }

  function buildArcCurvePoints(a, vertex, c, radius) {
    const v1 = new THREE.Vector3().subVectors(a, vertex).normalize();
    const v2 = new THREE.Vector3().subVectors(c, vertex).normalize();
    const axis = new THREE.Vector3().crossVectors(v1, v2);
    const axisLen = axis.length();
    if (axisLen < 1e-6) return [vertex.clone().addScaledVector(v1, radius)];
    axis.divideScalar(axisLen);
    const totalAngle = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
    const pts = [];
    const steps = 24;
    const q = new THREE.Quaternion();
    for (let i = 0; i <= steps; i++) {
      const ang = (totalAngle * i) / steps;
      q.setFromAxisAngle(axis, ang);
      pts.push(v1.clone().applyQuaternion(q).multiplyScalar(radius).add(vertex));
    }
    return pts;
  }

  function buildMeasurementVisual(m) {
    const group = new THREE.Group();
    const color = m.clashing ? "#ef4444" : m.color;

    if (m.kind === "p2p" || m.kind === "laser" || m.kind === "min-distance") {
      const [a, b] = m.points;
      group.add(createPointMarker(a, color, 0.032));
      group.add(createPointMarker(b, color, 0.032));
      group.add(createLineSegment(a, b, color, false));
      if (m.kind === "p2p" && state.showDeltas) {
        addDeltaHelperLines(group, a, b);
      }
      m.anchor = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    } else if (m.kind === "elevation") {
      const a = m.points[0];
      group.add(createPointMarker(a, color, 0.036));
      if (m.points.length >= 2) {
        const b = m.points[1];
        const vertTarget = new THREE.Vector3(a.x, b.y, a.z);
        group.add(createPointMarker(vertTarget, color, 0.028));
        group.add(createLineSegment(a, vertTarget, color, false));
        if (Math.hypot(b.x - a.x, b.z - a.z) > 1e-4) {
          group.add(createLineSegment(vertTarget, b, color, true));
        }
        m.anchor = new THREE.Vector3().addVectors(a, vertTarget).multiplyScalar(0.5);
      } else {
        m.anchor = a.clone();
      }
    } else if (m.kind === "angle") {
      const [a, v, c] = m.points;
      group.add(createPointMarker(a, color, 0.03));
      group.add(createPointMarker(v, color, 0.036));
      group.add(createPointMarker(c, color, 0.03));
      group.add(createLineSegment(v, a, color, false));
      group.add(createLineSegment(v, c, color, false));
      const arcRadius = Math.max(0.15, Math.min(v.distanceTo(a), v.distanceTo(c)) * 0.35);
      const arcPts = buildArcCurvePoints(a, v, c, arcRadius);
      if (arcPts.length >= 2) {
        const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
        const arcMat = new THREE.LineBasicMaterial({
          color,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
        group.add(new THREE.Line(arcGeo, arcMat));
        m.anchor = arcPts[Math.floor(arcPts.length / 2)].clone();
      } else {
        m.anchor = v.clone();
      }
    }

    setOverlayOrder(group, 998);
    return group;
  }

  function commitMeasurement(partial) {
    const id = nextMeasurementId++;
    const record = {
      id,
      color: state.color,
      unit: state.unit,
      ...partial,
    };
    const texts = formatMeasurementTexts(record);
    record.label = texts.label;
    record.tooltip = texts.tooltip;
    record.group = buildMeasurementVisual(record);
    rootGroup.add(record.group);
    record.badgeEl = createBadgeElement(record);
    state.measurements.push(record);
    startOverlaySyncLoop();
    updateOverlayLabels();
    emit();
    return record;
  }

  function clearPreview() {
    while (previewGroup.children.length > 0) {
      const child = previewGroup.children.pop();
      previewGroup.remove(child);
      disposeObject3D(child);
    }
    if (liveBadgeEl) {
      liveBadgeEl.textContent = "";
      liveBadgeEl.style.display = "none";
    }
    liveBadgeAnchor = null;
  }

  function rebuildDraftPreview(cursorPoint = null) {
    clearPreview();
    if (!state.active) return;

    const pt = cursorPoint || lastPreviewPoint;
    if (state.mode === "p2p" && state.draftPoints.length === 1 && pt) {
      const a = state.draftPoints[0];
      previewGroup.add(createPointMarker(a, state.color, 0.03));
      previewGroup.add(createLineSegment(a, pt, state.color, false));
      if (state.showDeltas) addDeltaHelperLines(previewGroup, a, pt);
      setOverlayOrder(previewGroup, 998);

      const delta = computeIfcDelta(coordinates, a, pt);
      if (!liveBadgeEl) liveBadgeEl = createLivePreviewBadge();
      if (liveBadgeEl) {
        liveBadgeEl.style.setProperty("--ruler-color", state.color);
        liveBadgeEl.textContent = formatMeasurementLength(delta.totalDist, state.unit);
      }
      liveBadgeAnchor = new THREE.Vector3().addVectors(a, pt).multiplyScalar(0.5);
    } else if (state.mode === "elevation" && pt) {
      const elZ = coordinates?.toOriginal ? coordinates.toOriginal(pt).z : pt.y;
      if (!liveBadgeEl) liveBadgeEl = createLivePreviewBadge();
      if (liveBadgeEl) {
        liveBadgeEl.style.setProperty("--ruler-color", state.color);
        liveBadgeEl.textContent = `EL ${formatMeasurementLength(elZ, state.unit, { showPlus: true })}`;
      }
      liveBadgeAnchor = pt.clone();
    } else if (state.mode === "angle" && state.draftPoints.length >= 1) {
      for (const dp of state.draftPoints) {
        previewGroup.add(createPointMarker(dp, state.color, 0.03));
      }
      if (state.draftPoints.length === 1 && pt) {
        previewGroup.add(createLineSegment(state.draftPoints[0], pt, state.color, false));
      } else if (state.draftPoints.length === 2) {
        const [a, v] = state.draftPoints;
        previewGroup.add(createLineSegment(v, a, state.color, false));
        if (pt) {
          previewGroup.add(createLineSegment(v, pt, state.color, false));
          const deg = computeAngleDegrees(a, v, pt);
          const arcRadius = Math.max(0.12, Math.min(v.distanceTo(a), v.distanceTo(pt)) * 0.35);
          const arcPts = buildArcCurvePoints(a, v, pt, arcRadius);
          if (arcPts.length >= 2) {
            previewGroup.add(
              new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(arcPts),
                new THREE.LineBasicMaterial({ color: state.color, depthTest: false }),
              ),
            );
          }
          if (!liveBadgeEl) liveBadgeEl = createLivePreviewBadge();
          if (liveBadgeEl) {
            liveBadgeEl.style.setProperty("--ruler-color", state.color);
            liveBadgeEl.textContent = `∠ ${deg.toFixed(1)}°`;
          }
          liveBadgeAnchor = v.clone();
        }
      }
      setOverlayOrder(previewGroup, 998);
    }

    updateOverlayLabels();
  }

  function raycastExternalSources(raycaster) {
    if (externalPickSources.size === 0) return null;
    const objects = [];
    for (const entry of externalPickSources.values()) {
      if (entry.object3D && entry.object3D.visible) {
        objects.push(entry.object3D);
      }
    }
    if (objects.length === 0) return null;
    const planes = getActivePlanes();
    const hits = raycaster.intersectObjects(objects, true);
    for (const hit of hits) {
      if (!hit.object?.visible) continue;
      if (planes.length > 0 && isPointClippedByPlanes(hit.point, planes)) continue;
      let worldNormal = null;
      if (hit.face?.normal) {
        const normalMat = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        worldNormal = hit.face.normal.clone().applyMatrix3(normalMat).normalize();
      }
      // Resolve custom id (e.g. runId) up ancestor chain
      let customMeta = null;
      let cur = hit.object;
      while (cur) {
        if (cur.userData && (cur.userData.runId != null || cur.userData.externalId != null)) {
          customMeta = {
            kind: "external",
            id: cur.userData.externalId ?? `run:${cur.userData.runId}`,
            label: cur.userData.runName || `Run #${cur.userData.runId}`,
            object3D: cur,
          };
          break;
        }
        cur = cur.parent;
      }
      return {
        point: hit.point.clone(),
        normal: worldNormal,
        distance: hit.distance,
        object: hit.object,
        external: customMeta,
      };
    }
    return null;
  }

  function raycastAllScene(origin, direction) {
    const raycaster = new THREE.Raycaster(origin, direction.clone().normalize(), 0.015, 250);
    const targets = [];
    if (fragments?.list) {
      for (const model of fragments.list.values()) {
        if (model?.object?.visible) targets.push(model.object);
      }
    }
    for (const entry of externalPickSources.values()) {
      if (entry.object3D?.visible) targets.push(entry.object3D);
    }
    if (targets.length === 0) return null;
    const planes = getActivePlanes();
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      if (!hit.object?.visible) continue;
      if (planes.length > 0 && isPointClippedByPlanes(hit.point, planes)) continue;
      return hit;
    }
    return null;
  }

  async function pickUnified(ndc, { snap = state.snapEnabled } = {}) {
    if (!ndc || !camera) return null;
    const fragPickPromise = typeof pick === "function" ? pick(ndc, { snap }).catch(() => null) : Promise.resolve(null);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const extHit = raycastExternalSources(raycaster);
    const fragHit = await fragPickPromise;

    if (!fragHit && !extHit) return null;
    if (extHit && (!fragHit || extHit.distance < camera.position.distanceTo(fragHit.point))) {
      return {
        source: "external",
        point: extHit.point,
        normal: extHit.normal,
        external: extHit.external,
        object: extHit.object,
      };
    }

    let worldNormal = null;
    if (fragHit?.normal) {
      worldNormal = fragHit.normal.clone().normalize();
    } else if (fragHit?.face?.normal && fragHit?.object) {
      const normalMat = new THREE.Matrix3().getNormalMatrix(fragHit.object.matrixWorld);
      worldNormal = fragHit.face.normal.clone().applyMatrix3(normalMat).normalize();
    }
    return {
      source: "fragment",
      point: fragHit.point.clone(),
      normal: worldNormal,
      modelId: fragHit.model?.modelId || fragHit.modelId || null,
      localId: fragHit.localId ?? null,
    };
  }

  async function extractTrianglesForDescriptor(desc) {
    if (!desc) return [];
    if (desc.source === "external") {
      return collectWorldTrianglesFromObject(desc.object3D || desc.object);
    }
    if (desc.source === "fragment" && desc.modelId && desc.localId != null) {
      return extractItemWorldTriangles(fragments, desc.modelId, [desc.localId]);
    }
    return [];
  }

  async function handleLaserClick(hit) {
    if (!hit?.point) return false;
    let dir = hit.normal?.clone()?.normalize();
    if (!dir || dir.lengthSq() < 0.5) {
      // Fall back to camera-facing normal if pick didn't provide face normal
      if (camera) {
        dir = new THREE.Vector3().subVectors(camera.position, hit.point).normalize();
      } else {
        dir = new THREE.Vector3(0, 1, 0);
      }
    }
    const offsetOrigin = hit.point.clone().addScaledVector(dir, 0.015);
    let opposite = raycastAllScene(offsetOrigin, dir);
    if (!opposite) {
      // Try inward normal direction for enclosed cavities / reverse normals
      const revDir = dir.clone().negate();
      opposite = raycastAllScene(hit.point.clone().addScaledVector(revDir, 0.015), revDir);
    }
    if (!opposite || opposite.point.distanceTo(hit.point) < 0.004) {
      hoverStatusText = "Laser: no opposite surface hit within 250 m";
      emit();
      return false;
    }
    hoverStatusText = "";
    commitMeasurement({
      kind: "laser",
      points: [hit.point.clone(), opposite.point.clone()],
    });
    return true;
  }

  async function handleMinDistanceClick(hit) {
    const desc =
      hit.source === "external"
        ? {
            source: "external",
            key: hit.external?.id || `obj:${hit.object?.uuid}`,
            label: hit.external?.label || hit.object?.name || "Conduit",
            object3D: hit.external?.object3D || hit.object,
          }
        : hit.modelId && hit.localId != null
          ? {
              source: "fragment",
              key: `${hit.modelId}:${hit.localId}`,
              label: `Element #${hit.localId}`,
              modelId: hit.modelId,
              localId: hit.localId,
            }
          : null;

    if (!desc) return false;

    if (state.draftObjects.length === 0) {
      state.draftObjects = [desc];
      emit();
      return true;
    }

    const first = state.draftObjects[0];
    if (first.key === desc.key) {
      hoverStatusText = "Click a second distinct object";
      emit();
      return true;
    }

    hoverStatusText = "";
    isComputingAsync = true;
    emit();

    try {
      const [trisA, trisB] = await Promise.all([
        extractTrianglesForDescriptor(first),
        extractTrianglesForDescriptor(desc),
      ]);
      const result = computeMinDistance(trisA, trisB);
      state.draftObjects = [];
      isComputingAsync = false;

      if (!result) {
        hoverStatusText = "Unable to extract mesh triangles for selected object";
        emit();
        return false;
      }

      commitMeasurement({
        kind: "min-distance",
        points: [result.pointA, result.pointB],
        clashing: result.clashing,
        labelA: first.label,
        labelB: desc.label,
      });
      return true;
    } catch {
      state.draftObjects = [];
      isComputingAsync = false;
      emit();
      return false;
    }
  }

  function handleElevationClick(hit, { shiftKey = false } = {}) {
    const pt = hit.point.clone();
    const toZ = (v) => (coordinates?.toOriginal ? coordinates.toOriginal(v).z : v.y);

    if (state.draftPoints.length === 1) {
      const a = state.draftPoints[0];
      state.draftPoints = [];
      clearPreview();
      commitMeasurement({
        kind: "elevation",
        points: [a, pt],
        isDrop: false,
        ifcZ: toZ(a),
        ifcZ2: toZ(pt),
      });
      return true;
    }

    if (shiftKey) {
      state.draftPoints = [pt];
      rebuildDraftPreview(pt);
      emit();
      return true;
    }

    // Standard Revizto 1-click Spot Elevation + gravity drop to floor/slab below
    const downOrigin = pt.clone().add(new THREE.Vector3(0, -0.015, 0));
    const floorHit = raycastAllScene(downOrigin, new THREE.Vector3(0, -1, 0));
    if (floorHit && floorHit.distance >= 0.005 && floorHit.distance <= 150) {
      commitMeasurement({
        kind: "elevation",
        points: [pt, floorHit.point.clone()],
        isDrop: true,
        ifcZ: toZ(pt),
        ifcZ2: toZ(floorHit.point),
      });
      return true;
    }

    commitMeasurement({
      kind: "elevation",
      points: [pt],
      isDrop: false,
      ifcZ: toZ(pt),
    });
    return true;
  }

  // --- Public Pointer Hooks ---
  async function handlePointerMove(ndc) {
    if (!state.active || !ndc) return;
    lastPointerNdc = ndc.clone();
    const hit = await pickUnified(ndc, { snap: state.snapEnabled });
    if (!state.active) return;

    if (hit?.point) {
      lastPreviewPoint = hit.point.clone();
      reticleMesh.visible = true;
      reticleMesh.position.copy(hit.point);
      if (camera?.position) {
        const dist = camera.position.distanceTo(hit.point);
        const s = Math.max(0.5, Math.min(dist * 0.12, 8.0));
        reticleMesh.scale.setScalar(s);
      }
      reticleMat.color.set(state.color);
      rebuildDraftPreview(hit.point);
    } else {
      reticleMesh.visible = false;
      rebuildDraftPreview(null);
    }
  }

  async function handlePointerClick(ndc, { shiftKey = false } = {}) {
    if (!state.active || !ndc) return false;
    const hit = await pickUnified(ndc, { snap: state.snapEnabled });
    if (!hit?.point) return false;

    if (state.mode === "laser") {
      return handleLaserClick(hit);
    }

    if (state.mode === "min-distance") {
      return handleMinDistanceClick(hit);
    }

    if (state.mode === "elevation") {
      return handleElevationClick(hit, { shiftKey });
    }

    if (state.mode === "p2p") {
      const pt = hit.point.clone();
      if (state.draftPoints.length === 0) {
        state.draftPoints = [pt];
        rebuildDraftPreview(pt);
        emit();
        return true;
      }
      const start = state.draftPoints[0];
      commitMeasurement({
        kind: "p2p",
        points: [start, pt],
      });
      state.draftPoints = state.chain ? [pt.clone()] : [];
      rebuildDraftPreview(pt);
      emit();
      return true;
    }

    if (state.mode === "angle") {
      const pt = hit.point.clone();
      if (state.draftPoints.length < 2) {
        state.draftPoints.push(pt);
        rebuildDraftPreview(pt);
        emit();
        return true;
      }
      const [a, v] = state.draftPoints;
      const angleDeg = computeAngleDegrees(a, v, pt);
      state.draftPoints = [];
      clearPreview();
      commitMeasurement({
        kind: "angle",
        points: [a, v, pt],
        angleDeg,
      });
      return true;
    }

    return false;
  }

  // --- Public Controls ---
  function startNewMeasurement() {
    state.draftPoints = [];
    state.draftObjects = [];
    hoverStatusText = "";
    clearPreview();
    if (!state.active) {
      state.active = true;
      try { section?.setActive?.(false); } catch { /* noop */ }
    }
    startOverlaySyncLoop();
    emit();
  }

  function setActive(active) {
    const next = Boolean(active);
    if (state.active === next) return state.active;
    state.active = next;
    if (!next) {
      state.draftPoints = [];
      state.draftObjects = [];
      hoverStatusText = "";
      reticleMesh.visible = false;
      clearPreview();
    } else {
      try { section?.setActive?.(false); } catch { /* noop */ }
      startOverlaySyncLoop();
    }
    emit();
    return state.active;
  }

  function toggleActive() {
    return setActive(!state.active);
  }

  function setMode(mode) {
    if (!RULER_MODES.includes(mode)) return;
    state.mode = mode;
    state.draftPoints = [];
    state.draftObjects = [];
    hoverStatusText = "";
    clearPreview();
    if (!state.active) {
      state.active = true;
      try { section?.setActive?.(false); } catch { /* noop */ }
    }
    startOverlaySyncLoop();
    emit();
  }

  function setChain(enabled) {
    state.chain = Boolean(enabled);
    emit();
  }

  function toggleChain() {
    state.chain = !state.chain;
    emit();
    return state.chain;
  }

  function setUnit(unit) {
    if (!MEASUREMENT_UNITS.includes(unit)) return;
    state.unit = unit;
    for (const m of state.measurements) {
      m.unit = unit;
      const texts = formatMeasurementTexts(m);
      m.label = texts.label;
      m.tooltip = texts.tooltip;
      if (m.badgeEl) {
        const textSpan = m.badgeEl.querySelector(".rc-ruler-badge-text");
        if (textSpan) textSpan.textContent = m.label;
        m.badgeEl.title = m.tooltip;
      }
    }
    rebuildDraftPreview(lastPreviewPoint);
    emit();
  }

  function setColor(colorHex) {
    if (!colorHex) return;
    state.color = String(colorHex);
    reticleMat.color.set(state.color);
    rebuildDraftPreview(lastPreviewPoint);
    emit();
  }

  function setShowDeltas(enabled) {
    state.showDeltas = Boolean(enabled);
    for (const m of state.measurements) {
      if (m.kind !== "p2p") continue;
      if (m.group) {
        rootGroup.remove(m.group);
        disposeObject3D(m.group);
      }
      m.group = buildMeasurementVisual(m);
      rootGroup.add(m.group);
    }
    rebuildDraftPreview(lastPreviewPoint);
    emit();
  }

  function setSnapEnabled(enabled) {
    state.snapEnabled = Boolean(enabled);
    emit();
  }

  function removeMeasurement(id) {
    const idx = state.measurements.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    const [m] = state.measurements.splice(idx, 1);
    if (m.group) {
      rootGroup.remove(m.group);
      disposeObject3D(m.group);
    }
    if (m.badgeEl?.parentNode) m.badgeEl.parentNode.removeChild(m.badgeEl);
    emit();
    return true;
  }

  function clearAll() {
    state.draftPoints = [];
    state.draftObjects = [];
    hoverStatusText = "";
    clearPreview();
    while (state.measurements.length > 0) {
      const m = state.measurements.pop();
      if (m.group) {
        rootGroup.remove(m.group);
        disposeObject3D(m.group);
      }
      if (m.badgeEl?.parentNode) m.badgeEl.parentNode.removeChild(m.badgeEl);
    }
    emit();
  }

  /**
   * Cancels active draft point (first Esc), or closes Ruler tool (second Esc).
   * Matches Revizto Esc precedence cleanly without losing committed measurements unless Clear is pressed.
   */
  function cancelDraftOrDeactivate() {
    if (state.draftPoints.length > 0 || state.draftObjects.length > 0) {
      state.draftPoints = [];
      state.draftObjects = [];
      hoverStatusText = "";
      clearPreview();
      emit();
      return "draft-cleared";
    }
    if (state.active) {
      setActive(false);
      return "deactivated";
    }
    return "noop";
  }

  function registerPickSource(key, object3D) {
    if (!key || !object3D) return () => {};
    externalPickSources.set(key, { object3D });
    return () => {
      externalPickSources.delete(key);
    };
  }

  function onChange(cb) {
    listeners.add(cb);
    try {
      cb(snapshotState());
    } catch {
      // Ignore immediate listener errors.
    }
    return () => listeners.delete(cb);
  }

  function dispose() {
    disposed = true;
    if (rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    clearAll();
    reticleGeo.dispose();
    reticleMat.dispose();
    if (liveBadgeEl?.parentNode) liveBadgeEl.parentNode.removeChild(liveBadgeEl);
    if (overlayContainer?.parentNode) overlayContainer.parentNode.removeChild(overlayContainer);
    if (scene) scene.remove(rootGroup);
    listeners.clear();
    externalPickSources.clear();
  }

  return {
    get active() {
      return state.active;
    },
    get mode() {
      return state.mode;
    },
    get unit() {
      return state.unit;
    },
    get color() {
      return state.color;
    },
    get chain() {
      return state.chain;
    },
    getState: snapshotState,
    setActive,
    toggleActive,
    setMode,
    setChain,
    toggleChain,
    setUnit,
    setColor,
    setShowDeltas,
    setSnapEnabled,
    startNewMeasurement,
    removeMeasurement,
    clearAll,
    cancelDraftOrDeactivate,
    handlePointerMove,
    handlePointerClick,
    registerPickSource,
    updateOverlayLabels,
    onChange,
    dispose,
  };
}
