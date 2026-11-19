# Architectural Study: Revizto 5 Section Plane & Section Box (OBB) Parity

**Status:** Design & Mathematical Specification (Pre-Implementation)  
**Target Module:** `packages/viewer-core/src/section-controller.js`, `packages/ribbon-chrome/src/revizto-toolbar.js`

---

## 1. Gap Analysis: Current `7/10` Implementation vs. Revizto 5

| Area | Current Implementation | Revizto 5 Behavior |
|---|---|---|
| **Section Plane Surface Alignment** | Requires clicking `New` in the sub-bar to arm a one-shot `surfacePickPending` click mode. | **Suction-Cup Base Drag:** The Section Plane gizmo has a **circular base pad ("suction cup")** sitting on the cut plane + a **normal arrow stem**. Dragging the **base pad** across the 3D scene raycasts every face under the cursor in real time and **snaps/rotates the cut plane parallel to any hovered wall, floor, sloped roof, or pipe**. Dragging the **stem/arrow** slides depth along the normal. |
| **Section Box Math Model** | Axis-aligned `THREE.Box3` (`min`, `max`). Cannot rotate to match angled buildings or diagonal MEP racks. | **Oriented Bounding Box (OBB):** Defined by `(center, halfExtents, quaternion)`, enabling arbitrary 3D rotation, translation, uniform/axis scaling, and single-face push/pull. |
| **Section Box Sub-Modes** | Only face push/pull (`box-face`). Missing `Scale box`, `Move box`, and `Rotate box`. | Explicit **4-mode box manipulation**: **Move face**, **Scale box**, **Move box**, **Rotate box**. |
| **3D Gizmo Visual Cleanliness** | Renders **6 large bidirectional arrows simultaneously** on all 6 faces of the box, cluttering the interior view. | Thin, crisp wireframe edges with ultra-low idle face opacity (`0.03`). In **Move face**, only the **hovered face** illuminates and shows a clean push/pull arrow (unhovered faces show only a minimal center dot). In **Move / Scale / Rotate box**, a single centered 3D triad/ring gizmo renders at `center`. |

---

## 2. Section Plane Architecture: The "Suction-Cup" Dual-Handle Gizmo

### 2.1 Visual Anatomy
```
         ▲  Normal Push/Pull Arrow (Drag to slide along current normal)
         │
    ─────┼─────  Translucent Plane Frame (Subtle border, clipped to model bounds)
    (  ( ● )  )  Base Pad / "Suction Cup" (Drag across model to align parallel to ANY face)
```

1. **Base Pad (`sectionPlaneAction: "align-base"`):**
   - Rendered as a crisp **concentric ring + flat disc** resting at the gizmo origin on the plane.
   - **On `pointerdown` + `pointermove`:**
     - Temporarily excludes the gizmo from raycasting and calls `engine.pick(ndc, { snap: false })`.
     - If `hit.point` and `hit.normal` are returned:
       - Sets `activePlaneOrigin.copy(hit.point)`.
       - Aligns `activePlaneNormal` to `hit.normal` (oriented into the surface away from the camera so the front side remains visible and the interior is sliced open, or preserving the user's current flip sign).
       - Updates the clipping plane + gizmo orientation **live on every pointer move** so the user sees the plane snap seamlessly onto walls, ceilings, columns, or angled pipes as they drag!
2. **Normal Arrow / Stem (`sectionPlaneAction: "slide"`):**
   - Projects pointer movement onto the camera-facing plane containing `activePlaneNormal`, sliding `activePlaneOrigin` purely along `activePlaneNormal` without changing orientation.
3. **Tilt Arcs (`tiltU` / `tiltV`) + Double-Click:**
   - Retained as secondary precision controls; double-clicking any surface when Section Plane is open also snaps the plane parallel to that surface.

---

## 3. Section Box Architecture: Oriented Bounding Box (OBB) & 4 Modes

### 3.1 OBB State Representation
Replace the axis-aligned `activeBox: THREE.Box3` with an **Oriented Bounding Box**:

```js
const obb = {
  center: new THREE.Vector3(0, 2, 0),
  halfExtents: new THREE.Vector3(5, 3, 5), // strictly >= MIN_HALF_EXTENT (0.04 m)
  quaternion: new THREE.Quaternion(),      // identity = world-aligned
};
```

From `(center, halfExtents, quaternion)`, the 6 inward-facing `THREE.Plane` definitions are computed via `computeObbPlaneSpecs(obb)`:
- Extract orthonormal local basis vectors from `quaternion`:
  $$\mathbf{u}_x = \mathbf{R}\begin{bmatrix}1\\0\\0\end{bmatrix}, \quad \mathbf{u}_y = \mathbf{R}\begin{bmatrix}0\\1\\0\end{bmatrix}, \quad \mathbf{u}_z = \mathbf{R}\begin{bmatrix}0\\0\\1\end{bmatrix}$$
- For each face `(axis, sign)` where `axis` $\in \{x, y, z\}$ and `sign` $\in \{+1, -1\}$:
  - **Face center:** $\mathbf{p}_{\text{face}} = \mathbf{c} + \text{sign} \cdot h_{\text{axis}} \cdot \mathbf{u}_{\text{axis}}$
  - **Inward clipping normal:** $\mathbf{n}_{\text{in}} = -\text{sign} \cdot \mathbf{u}_{\text{axis}}$

Because `OBC.Clipper` planes are simply `normal` + `coplanarPoint`, rotating or moving the OBB updates all 6 clipping planes in $O(1)$ without recreating them.

### 3.2 Mathematical Behavior of the 4 Box Modes

| Mode | Sub-Bar / Gizmo | Drag Math (in OBB Local Space) |
|---|---|---|
| **1. Move face** *(default)* | Thin wireframe + subtle face dot; hovered face highlights (`0.12` opacity) + shows a single clean normal arrow. | Moving face `(axis, sign)` by signed local delta $\Delta$ along $\mathbf{u}_{\text{axis}}$:<br>• $\Delta h = \frac{1}{2}(\text{sign} \cdot \Delta)$ (clamped so $h'_{\text{axis}} \ge h_{\min}$)<br>• $h'_{\text{axis}} = h_{\text{axis}} + \Delta h$<br>• $\mathbf{c}' = \mathbf{c} + (\text{sign} \cdot \Delta h) \cdot \mathbf{u}_{\text{axis}}$<br>*(The opposite face stays pinned in world space!)* |
| **2. Scale box** | Centered 3-axis scale handles (Red `X`, Green `Y`, Blue `Z`) + uniform corner/center handle. | Dragging axis $i$ scales $h_i$ symmetrically around fixed `center` ($\mathbf{c}' = \mathbf{c}$, opposite faces expand/contract equally). Uniform handle scales `(hx, hy, hz)` by the same factor. |
| **3. Move box** | Centered 3-axis translation arrows (Red `X`, Green `Y`, Blue `Z`). | Translates `center` along $\mathbf{u}_i$ ($\mathbf{c}' = \mathbf{c} + \Delta \cdot \mathbf{u}_i$); `halfExtents` and `quaternion` remain constant. |
| **4. Rotate box** | Centered 3-axis orthogonal rotation rings (Red `X`, Green `Y`, Blue `Z`). | Left-multiplies `quaternion` by $\Delta \mathbf{q} = \text{quat}(\mathbf{u}_i, \Delta \theta)$, rotating the entire cropping volume around `center` to align with angled walls or diagonal conduit racks. |

### 3.3 Clean Sub-Bar Integration (`revizto-toolbar.js`)
When `Section` is in **`Box`** mode, the `Section` sub-bar cleanly displays the 4 compact box-action toggles right after `Clear`:

```
Section  ( Plane | [Box] )  ( New )  ( Clear )  |  [ Move face | Scale box | Move box | Rotate box ]        [💬+]  ✕
```

When `Plane` is active, those 4 box buttons hide automatically, keeping the `Plane` sub-bar minimal:
```
Section  ( [Plane] | Box )  ( New )  ( Clear )  [⇄ Flip]                                                  [💬+]  ✕
```

---

## 4. Visual Polish Checklist (Fixing the Cluttered Box/Faces)
1. **No 6-arrow clutter:** In `Move face`, unhovered faces render **only** a small `3px`-equivalent crisp handle dot (or nothing until hovered); the bidirectional arrow renders **only** on the single `hoveredFaceKey` / `draggingFaceKey`.
2. **Crisp edge hierarchy:** Idle box edges use thin `#22c55e` (or `#d4d4d8`) lines (`opacity: 0.75`), while the hovered face's 4 border edges highlight brightly (`#38bdf8` / `#facc15` during drag) with a soft `0.10`–`0.16` face fill.
3. **Depth-sorted / `depthTest: false` center gizmos:** `Move box`, `Scale box`, and `Rotate box` gizmos scale dynamically with camera distance (`dist * 0.04`) so they stay the exact same comfortable screen size whether zoomed out or 15 cm inside a mechanical room.
