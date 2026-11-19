# Architecture Note: Revizto-Style Camera Navigation & Adaptive Frustum

**Branch:** `viewer/revizto-camera-navigation`  
**Primary Modules:**
- `packages/viewer-core/src/camera-navigation.js`
- `packages/viewer-core/src/engine.js`
- `packages/viewer-core/src/index.js`
- `packages/viewer-core/test/camera-navigation.test.js`

---

## 1. Problem Statement: Why the Model Sliced Open During Close-Up Inspection

In large BIM / MEP coordination models (plants, hospitals, substations, multi-building sites), users frequently zoom from a 500 m site overview down to a 20 mm conduit coupling or cable tray rung. Before this change, approaching an IFC element caused two severe visual and ergonomic failures:

1. **Premature Near-Plane Clipping ("Ghost Sectioning"):** Geometry within `1.0 m` of the camera eye disappeared cleanly along a flat plane perpendicular to the view direction, mimicking an unintended section cut.
2. **Multi-Meter "Dolly Jumps" Through Geometry:** A single mouse-wheel notch when inspecting an exterior rack or wall jumped the camera `0.5 m`–`15 m` forward, blasting the camera lens *inside* the solid and clipping it open.

Inspection of the underlying `@thatopen/components` (`OBC.SimpleCamera`), `camera-controls`, and `@thatopen/fragments` runtime internals revealed four root causes.

---

## 2. Root-Cause Analysis of Upstream Defaults

### 2.1 Hardcoded `1.0 m` Near Plane in `OBC.SimpleCamera`
`OBC.SimpleCamera.setupCamera()` initializes Three.js's perspective camera with static frustum bounds:
```js
const camera = new THREE.PerspectiveCamera(60, aspect, 1, 1e3);
```
- `near = 1.0` meter (`1,000 mm`) is never adjusted dynamically. Anything closer than 1 meter to the camera eye lies in front of the near clipping plane ($z_{\text{view}} > -n$) and is discarded by the GPU rasterizer.
- `far = 1000` meters clips any industrial plant or civil corridor larger than 1 km.

### 2.2 Hardcoded `minDistance = 6` + `infinityDolly = true` in `camera-controls`
`OBC.SimpleCamera.newCameraControls()` configures `yomotsu/camera-controls` with:
```js
controls.smoothTime = 0.2;
controls.dollyToCursor = true;
controls.infinityDolly = true;
controls.minDistance = 6;
```
In `camera-controls`, mouse-wheel dollying scales proportionally to the current spherical radius $r = \|\mathbf{p}_{\text{cam}} - \mathbf{p}_{\text{target}}\|$:
$$\Delta r = r \cdot \left(1 - 0.95^{\,\delta \cdot s_{\text{dolly}}}\right)$$
Because `minDistance` was clamped at `6.0 m` while `infinityDolly = true`:
- Once the camera came within `6.0 m` of `_target`, `camera-controls` kept $r \ge 6.0\text{ m}$ and pushed `_target` forward instead.
- Consequently, even when the camera lens was `0.10 m` from a conduit, each scroll tick computed $\Delta r$ using $r = 6.0\text{ m}$ (~`0.30 m` to `1.5 m` per tick), pushing the camera straight through the pipe.
- Orbiting around `_target` rotated around a pivot `6.0 m` behind the inspected object, swinging the object out of the viewport.

### 2.3 Whole-Model `fitToSphere` Centroid Bias
Loading a model calls `controls.fitToSphere(sphere, true)`, placing `_target` at the bounding sphere center of the entire site. When inspecting a peripheral pipe rack `150 m` away from the site center, $r \approx 150\text{ m}$ even if the rack is `2 m` from the camera—causing `7–10 m` scroll jumps.

---

## 3. Depth-Buffer Precision & Why `logarithmicDepthBuffer` Alone Was Rejected

### 3.1 Hyperbolic Depth Quantization in Standard Perspective Projection
In a standard OpenGL/WebGL perspective projection matrix with near plane $n$ and far plane $f$, view-space depth $z \in [n, f]$ maps to Normalized Device Coordinates $z_{\text{ndc}} \in [-1, 1]$ via:
$$z_{\text{ndc}}(z) = \frac{f + n}{f - n} - \frac{2 f n}{(f - n)\, z}$$
Mapped to a 24-bit fixed-point depth buffer ($2^{24} = 16{,}777{,}216$ discrete levels), the hyperbolic $1/z$ term concentrates **~90% of all depth precision between $n$ and $10n$**. Expanding the ratio $f / n$ naively (e.g., setting $n = 0.001\text{ m}$ and $f = 50{,}000\text{ m}$ simultaneously, $f/n = 5 \times 10^7$) starves distant geometry of depth bits and produces severe **Z-fighting** (coplanar surface flickering).

### 3.2 Compatibility Constraint with `@thatopen/fragments` (`LodMaterial`)
The classic workaround for huge $f/n$ ratios is a **Logarithmic Depth Buffer** (`new THREE.WebGLRenderer({ logarithmicDepthBuffer: true })`), where fragment depth is written as:
$$z_{\text{log}} = \frac{\ln(C \cdot w + 1)}{\ln(C \cdot f + 1)}$$
However, inspecting `@thatopen/fragments` showed that distant LOD tiles render with:
```js
class LodMaterial extends THREE.ShaderMaterial { ... }
```
Because `LodMaterial` is a raw `THREE.ShaderMaterial` (not a built-in `MeshStandardMaterial` / `MeshLambertMaterial`), Three.js does **not** automatically inject `#include <logdepthbuf_vertex>` or `#include <logdepthbuf_fragment>` into its custom GLSL program. Enabling `logarithmicDepthBuffer: true` without modifying That Open's compiled library (prohibited by `AGENTS.md` rule 4) would cause depth-buffer mismatches between `LodMaterial` tiles and standard meshes/overlays (grids, conduit runs, ruler lines).

### 3.3 Solution: Distance-Adaptive Frustum (`computeAdaptiveFrustum`)
Instead of changing the depth-buffer encoding, we keep standard hardware 24-bit depth and **dynamically bound $f / n \le 150{,}000$** around the camera's actual working distance $d_{\text{ref}}$:

```
d_ref = min(cameraDistance, nearestSurfaceDistance)

if d_ref <= 5.0 m:
    near = 0.015 m (15 mm)
else:
    near = clamp(d_ref * 0.003, 0.015, 1.0)

far = min(
    max(2000, modelRadius * 8 + cameraDistance * 2),
    near * 150000
)
```

- **Close-up inspection (`d_ref = 0.2 m`):** `near = 0.015 m` (`15 mm`), `far = 2000 m` $\implies f/n \approx 133{,}333$. Sub-millimetre depth precision at `0.5 m`, zero slicing down to `1.5 cm` from the lens, and `100%` compatible with `LodMaterial`.
- **Site overview (`d_ref = 500 m`, `modelRadius = 2000 m`):** `near = 1.0 m`, `far = 17{,}000 m` $\implies f/n = 17{,}000$. Zero Z-fighting and zero far-plane clipping across multi-kilometer plants.
- **Zero idle overhead:** `camera.updateProjectionMatrix()` is only called when `near` or `far` shifts by more than `5%`.

---

## 4. Surface-Aware Zoom & Cursor-Centered Orbit Pivot

To match Revizto 5's navigation feel, `createCameraNavigationController` in `packages/viewer-core/src/camera-navigation.js` pairs the adaptive frustum with three runtime behaviors:

```
Pointer Move (throttled 85 ms) ──▶ engine.pick(ndc, { snap: false }) ──▶ lastHit { point, distance }
                                                                              │
Wheel Scroll (capture phase) ────▶ surfaceDistance < targetDistance * 0.85? ──┼──▶ controls.setOrbitPoint(hit.point)
                                                                              │
Pointer Down (left/right drag) ──▶ cursorOrbitPivot && !shiftKey? ────────────┘──▶ controls.setOrbitPoint(hit.point)
```

1. **Controls Tuning:**
   - `controls.minDistance = 0.05` (`5 cm`, replacing OBC's `6 m`)
   - `controls.maxDistance = 50000` (`50 km`)
   - `controls.dollyToCursor = true`
   - `controls.infinityDolly = true`
   - `controls.dollySpeed = 0.85`
   - `controls.smoothTime = 0.12`
2. **Non-Jarring Target Re-Anchoring via `setOrbitPoint`:**
   `camera-controls`'s `setOrbitPoint(x, y, z)` updates `_target` and `_spherical.radius` while keeping the camera's world position and orientation **unchanged**. When zooming in (`deltaY < 0`) over a hovered surface closer than `85%` of the current target distance, re-anchoring `_target` to `lastHit.point` right before `camera-controls` handles the `wheel` event makes the native dolly step scale smoothly by `surfaceDistance` down to centimetre increments—preserving `dollyToCursor` and smooth damping with zero camera jump.
3. **Section-Cut Respect:**
   Because `engine.pick()` calls `isPointClippedByPlanes()` (`packages/viewer-core/src/engine.js`), clipped geometry is ignored by navigation raycasts—so zooming and orbiting inside an active Section Box or Section Plane anchors cleanly to the *visible* interior surfaces.

---

## 5. Verification

Unit tests in `packages/viewer-core/test/camera-navigation.test.js` verify:
1. `computeAdaptiveFrustum` drops `near` to `0.015 m` during close-up surface inspection even when the orbit target is `50 m` away.
2. `computeAdaptiveFrustum` scales `near` (`1 m`) and `far` (`17,200 m`) cleanly on multi-kilometer sites while preserving `far / near <= 150,000`.
3. `computeSurfaceZoomStep` shrinks dolly steps proportionally (`< 0.06 m`) when approaching a close surface (`0.3 m`) despite a `100 m` target distance.
4. `createCameraNavigationController` overrides `minDistance = 0.05` and dynamically updates `camera.near` / `camera.far` on `controls` `"update"` events.

---

## 6. Further Reading & Technical References

1. **Tomas Akenine-Möller, Eric Haines, Naty Hoffman** — *Real-Time Rendering* (4th ed., A K Peters / CRC Press, 2018), Chapter 23 ("Graphics Hardware" — Depth Buffer precision & perspective $1/z$ non-linearity).
2. **Nathan Reed** — *"Depth Precision Visualized"* (NVIDIA Developer Blog, 2015) — quantitative analysis of 24-bit integer vs. floating-point depth buffers, $f/n$ ratios, and Z-fighting thresholds: https://developer.nvidia.com/content/depth-precision-visualized
3. **Brano Kemen** — *"Maximizing Depth Buffer Range and Precision"* (Outerra Dev Blog, 2012) — mathematical derivation of logarithmic depth buffers (`logdepthbuf`) and why custom shaders must opt into explicit `gl_FragDepth` / vertex scaling: https://outerra.blogspot.com/2012/11/maximizing-depth-buffer-range-and.html
4. **yomotsu/camera-controls** — Official API documentation for `setOrbitPoint`, `dollyToCursor`, `infinityDolly`, and `minDistance` spherical clamping: https://github.com/yomotsu/camera-controls
