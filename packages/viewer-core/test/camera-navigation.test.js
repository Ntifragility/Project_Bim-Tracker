import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  computeAdaptiveFrustum,
  computeSurfaceZoomStep,
  createCameraNavigationController,
} from "../src/index.js";

describe("Revizto Camera Navigation & Adaptive Frustum", () => {
  it("drops near plane to 15 mm (0.015 m) for close-up detail inspection even when target is far away", () => {
    const res = computeAdaptiveFrustum({
      cameraDistance: 50,
      nearestSurfaceDistance: 0.2,
      modelRadius: 120,
    });
    assert.equal(res.near, 0.015);
    assert.ok(res.far >= 2000);
    assert.ok(res.far / res.near <= 150000);
  });

  it("scales near and far cleanly for multi-kilometer site overviews without Z-fighting", () => {
    const res = computeAdaptiveFrustum({
      cameraDistance: 600,
      nearestSurfaceDistance: null,
      modelRadius: 2000,
    });
    assert.equal(res.near, 1);
    assert.equal(res.far, 2000 * 8 + 600 * 2);
  });

  it("shrinks wheel zoom steps proportionally when approaching a close surface", () => {
    const step = computeSurfaceZoomStep({
      surfaceDistance: 0.3,
      targetDistance: 100,
      wheelDeltaY: -100,
    });
    assert.equal(step.direction, 1);
    assert.equal(step.shouldReanchorTarget, true);
    assert.ok(step.stepDistance < 0.06, `expected fine close-up step, got ${step.stepDistance}`);
  });

  it("tunes camera-controls minDistance to 0.05m and enforces adaptive near/far on updates", () => {
    const camera = new THREE.PerspectiveCamera(60, 1.5, 1, 1000);
    camera.position.set(0, 0, 2);
    const target = new THREE.Vector3(0, 0, 0);
    const listeners = new Map();
    const controls = {
      minDistance: 6,
      maxDistance: 1000,
      dollyToCursor: true,
      infinityDolly: true,
      dollySpeed: 1,
      smoothTime: 0.2,
      getTarget(out) {
        out.copy(target);
      },
      addEventListener(type, fn) {
        listeners.set(type, fn);
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
    };

    const nav = createCameraNavigationController({
      world: { camera: { three: camera, controls } },
    });

    assert.equal(controls.minDistance, 0.05);
    assert.equal(controls.maxDistance, 50000);
    assert.equal(camera.near, 0.015);
    assert.ok(camera.far >= 2000);

    // Simulate zooming out to 400m
    camera.position.set(0, 0, 400);
    listeners.get("update")?.();
    assert.equal(camera.near, 1);

    nav.dispose();
  });
});
