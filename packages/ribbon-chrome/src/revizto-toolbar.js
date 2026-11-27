// Revizto 5-style Viewport Toolbar System for ribbon-chrome.
//
// Implements Revizto's 3-Zone Spatial UI Architecture (DOM-pure, zero BIM engine imports):
//   - Zone 1 (Top Main Strip `#rc-revizto-bar`): 4 clean Revizto buttons (Hide | Isolate | Section | Ruler)
//   - Zone 2 (Top Contextual Sub-Bar `.rc-revizto-subbar`): Exclusive Section OR Ruler sub-bar directly below
//   - Zone 3 (Bottom Visibility Restore Bar `#rc-revizto-bottom-bar`): Unhide All (N) / Unisolate / Ghost-Solid at bottom

const DEFAULT_UNITS = [
  { id: "m", label: "Meters", short: "Meters" },
  { id: "cm", label: "Centimeters", short: "Centimeters" },
  { id: "mm", label: "Millimeters", short: "Millimeters" },
  { id: "ft", label: "Feet", short: "Feet" },
  { id: "in", label: "Inches", short: "Inches" },
  { id: "ft-in", label: "Feet & Inches", short: "Ft & In" },
];

const DEFAULT_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
];

/**
 * Pure presentation helper so HUD states for Top Bar and Bottom Restore Bar can be tested cleanly without DOM.
 */
export function computeToolbarPresentationState({
  hiddenCount = 0,
  hasSelection = false,
  isolateMode = "none",
  preferredIsolateMode = "ghost",
  sectionState = {},
  rulerState = {},
  openDrawer = null,
} = {}) {
  const isolated = isolateMode !== "none";

  // Top bar Hide & Isolate are pure selection actions; Unhide/Unisolate live in the Bottom Bar
  const hideBtn = {
    label: "Hide",
    action: "hide",
    disabled: !hasSelection,
    highlighted: false,
    title: hasSelection
      ? "Hide Selected Elements (Ctrl+H)"
      : "Select elements in the viewport to hide (Ctrl+H)",
  };

  const isolateBtn = {
    label: "Isolate",
    action: "isolate",
    disabled: !hasSelection,
    active: false,
    title: hasSelection
      ? preferredIsolateMode === "ghost"
        ? "Isolate Selection in Transparency (Shift+I)"
        : "Isolate Selection (Ctrl+I)"
      : "Select elements in the viewport to isolate",
  };

  const hasCuts = Boolean(sectionState.hasCuts);
  const sectionOpen = Boolean(sectionState.open ?? openDrawer === "section");
  const rulerOpen = Boolean(rulerState.active || openDrawer === "ruler");

  const cutBadge =
    sectionState.mode === "box" && sectionState.boxActive
      ? "Box"
      : sectionState.planeCount > 0
        ? "Cut"
        : "";

  const sectionBtn = {
    label: "Section",
    badge: cutBadge,
    active: sectionOpen && !rulerOpen,
    hasCuts,
  };

  const count = Number(rulerState.count || 0);
  const rulerBtn = {
    label: "Ruler",
    badge: count > 0 ? String(count) : "",
    active: rulerOpen,
  };

  // Bottom bar state (Unhide / Unisolate / Ghost-Solid toggle)
  const bottomBar = {
    visible: hiddenCount > 0 || isolated,
    unhideVisible: hiddenCount > 0,
    unhideLabel: `Unhide (${hiddenCount})`,
    unisolateVisible: isolated,
    unisolateLabel: "Unisolate",
    isolateMode,
    preferredIsolateMode,
    showAllVisible: hiddenCount > 0 && isolated,
  };

  return {
    hideBtn,
    isolateBtn,
    sectionBtn,
    rulerBtn,
    bottomBar,
  };
}

const ICONS = {
  hide: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
  hideTagged: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/><line x1="2" y1="22" x2="22" y2="2"/></svg>`,
  unhide: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  isolate: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1.5" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>`,
  section: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l8-4 8 4v10l-8 4-8-4V7z"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`,
  ruler: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 8.7L8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><line x1="8" y1="10" x2="10.5" y2="12.5"/><line x1="11" y1="7" x2="13.5" y2="9.5"/><line x1="14" y1="4" x2="16.5" y2="6.5"/></svg>`,
  laser: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 19 7 12 17 12 21 19"/><circle cx="12" cy="15.5" r="2"/><line x1="10" y1="15.5" x2="14" y2="15.5"/><line x1="12" y1="15.5" x2="12" y2="3"/><polyline points="8.5 6.5 12 3 15.5 6.5"/></svg>`,
  p2p: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="2.4"/><circle cx="12" cy="13" r="0.6" fill="currentColor"/><line x1="12" y1="3" x2="12" y2="10.6"/><line x1="9.9" y1="14.2" x2="3.5" y2="18.5"/><line x1="14.1" y1="14.2" x2="20.5" y2="18.5"/></svg>`,
  minDistance: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="4" x2="3" y2="20"/><line x1="21" y1="4" x2="21" y2="20"/><text x="12" y="10" text-anchor="middle" font-size="7" font-weight="600" stroke="none" fill="currentColor" font-family="sans-serif">MIN</text><line x1="5" y1="15" x2="19" y2="15"/><polyline points="8 12.5 5 15 8 17.5"/><polyline points="16 12.5 19 15 16 17.5"/></svg>`,
  elevation: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="18.5" r="1.8"/><line x1="6.8" y1="18.5" x2="18.5" y2="18.5"/><line x1="11.5" y1="5" x2="16.5" y2="5"/><line x1="14" y1="5" x2="14" y2="16.5"/><polyline points="11 13 14 16.5 17 13"/></svg>`,
  angle: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="5" x2="4" y2="19"/><line x1="4" y1="19" x2="20" y2="19"/><path d="M12.5 19 A 8.5 8.5 0 0 0 10 13"/></svg>`,
  commentPlus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H8l-4 4V4z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>`,
  hollowCaret: `<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><polygon points="2,3.5 10,3.5 6,9"/></svg>`,
  flip: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
  close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="19" y1="5" x2="5" y2="19"/><line x1="5" y1="5" x2="19" y2="19"/></svg>`,
};

/**
 * Mounts the Revizto 5 3-zone viewport UI:
 *   1. Top Main Tool Strip (`#rc-revizto-bar`)
 *   2. Top Contextual Sub-Bar (`.rc-revizto-subbar-host`)
 *   3. Bottom Visibility Restore Bar (`#rc-revizto-bottom-bar`)
 */
export function createReviztoToolbar(
  container,
  {
    visibility,
    isolation,
    section,
    ruler,
    getSelectionMap = null,
    onToolFocus = null,
    hideTaggedAction = null,
  } = {},
) {
  if (!container || typeof document === "undefined") {
    return {
      update() {},
      openDrawer() {},
      closeDrawer() {},
      dispose() {},
    };
  }

  let openDrawer = null; // null | 'section' | 'ruler'
  let preferredIsolateMode = "ghost"; // 'ghost' | 'hard'
  let unitsMenuOpen = false;
  let colorMenuOpen = false;
  let unsubs = [];

  let visState = {
    hiddenCount: visibility?.getHiddenCount?.() ?? 0,
    hasSelection: visibility?.hasSelection ?? false,
  };
  let isoState = {
    mode: isolation?.mode ?? "none",
  };
  let secState = section?.getState?.() ?? {
    open: false,
    active: false,
    mode: "plane",
    planeCount: 0,
    boxActive: false,
    hasCuts: false,
    handlesVisible: true,
    surfacePickPending: false,
  };
  let rulState = ruler?.getState?.() ?? {
    active: false,
    mode: "p2p",
    chain: false,
    unit: "m",
    color: "#ef4444",
    showDeltas: true,
    count: 0,
    hintText: "",
  };

  // Zone 1 & Zone 2: Top dock (main 4-button strip + exclusive Section/Ruler sub-bar + hint)
  const root = document.createElement("div");
  root.id = "rc-revizto-dock";
  root.className = "rc-revizto-dock";

  const capsule = document.createElement("div");
  capsule.id = "rc-revizto-bar";
  capsule.className = "rc-revizto-bar";
  root.appendChild(capsule);

  const subbarHost = document.createElement("div");
  subbarHost.className = "rc-revizto-subbar-host";
  root.appendChild(subbarHost);

  const hintEl = document.createElement("div");
  hintEl.className = "rc-revizto-hint";
  hintEl.hidden = true;
  root.appendChild(hintEl);

  // Zone 3: Bottom Visibility Restore Bar (Unhide All / Unisolate / Ghost-Solid)
  const bottomDock = document.createElement("div");
  bottomDock.id = "rc-revizto-bottom-dock";
  bottomDock.className = "rc-revizto-bottom-dock";
  bottomDock.hidden = true;

  // Stop canvas pointer events from leaking through the HUD
  for (const hostNode of [root, bottomDock]) {
    hostNode.addEventListener("pointerdown", (e) => e.stopPropagation());
    hostNode.addEventListener("contextmenu", (e) => e.stopPropagation());
  }

  function el(tag, className, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, String(v));
    }
    return node;
  }

  function closePopovers() {
    unitsMenuOpen = false;
    colorMenuOpen = false;
  }

  async function resolveSelectionMap() {
    if (typeof getSelectionMap === "function") {
      try {
        return (await getSelectionMap()) || {};
      } catch {
        return {};
      }
    }
    return undefined;
  }

  function setDrawer(nextDrawer) {
    closePopovers();
    openDrawer = nextDrawer;
    // Strict mutual exclusion between Section and Ruler
    if (nextDrawer === "section") {
      ruler?.setActive?.(false);
      section?.setActive?.(true);
    } else if (nextDrawer === "ruler") {
      section?.setActive?.(false);
      ruler?.setActive?.(true);
    } else {
      section?.setActive?.(false);
      ruler?.setActive?.(false);
    }
    if (typeof onToolFocus === "function") {
      onToolFocus(nextDrawer);
    }
    render();
  }

  function renderHint() {
    const hint =
      openDrawer === "section"
        ? secState.hintText || ""
        : openDrawer === "ruler"
          ? rulState.hintText || ""
          : "";
    if (!hint) {
      hintEl.hidden = true;
      hintEl.textContent = "";
      return;
    }
    hintEl.hidden = false;
    hintEl.textContent = hint;
  }

  function renderSectionSubbar() {
    // Matches Revizto 5 Section bar: Section | [Plane | Box] | (New) (Clear) ... [💬+] ✕
    const bar = el("div", "rc-revizto-subbar rc-section-subbar");

    const title = el("span", "rc-subbar-title", { text: "Section" });
    bar.appendChild(title);

    // Plane | Box segmented stadium pill
    const seg = el("div", "rc-seg-pill");
    const planeBtn = el("button", `rc-seg-btn${secState.mode === "plane" ? " is-active" : ""}`, {
      type: "button",
      text: "Plane",
      title: "Section Plane — drag arrow to slide, drag rings to tilt",
    });
    planeBtn.addEventListener("click", () => section?.setMode?.("plane"));

    const boxBtn = el("button", `rc-seg-btn${secState.mode === "box" ? " is-active" : ""}`, {
      type: "button",
      text: "Box",
      title: "Section Box — hover any face or arrow and drag to crop",
    });
    boxBtn.addEventListener("click", () => section?.setMode?.("box"));
    seg.appendChild(planeBtn);
    seg.appendChild(boxBtn);
    bar.appendChild(seg);

    // New stadium pill
    const newBtn = el(
      "button",
      `rc-pill-btn${secState.surfacePickPending ? " is-active" : ""}`,
      {
        type: "button",
        text: "New",
        title:
          secState.mode === "plane"
            ? "Align cut plane to any model surface (click a wall, floor, or pipe)"
            : "Fit Section Box to current selection (or reset to full model)",
      },
    );
    newBtn.addEventListener("click", async () => {
      if (secState.mode === "box") {
        const sel = await resolveSelectionMap();
        const hasSel = sel && Object.keys(sel).length > 0;
        if (hasSel) await section?.setBoxToSelection?.(sel);
        else await section?.setBoxToModel?.();
      } else {
        section?.startSurfaceCut?.();
      }
    });
    bar.appendChild(newBtn);

    // Clear stadium pill
    const clearBtn = el("button", "rc-pill-btn", {
      type: "button",
      text: "Clear",
      title: "Clear active section cut",
    });
    clearBtn.disabled = !secState.hasCuts;
    clearBtn.addEventListener("click", () => section?.clearAll?.());
    bar.appendChild(clearBtn);

    if (secState.mode === "plane" && secState.planeCount > 0) {
      const flipBtn = el("button", "rc-icon-btn", {
        type: "button",
        title: "Flip section plane direction",
        html: ICONS.flip,
      });
      flipBtn.addEventListener("click", () => section?.flipActivePlane?.());
      bar.appendChild(flipBtn);
    } else if (secState.mode === "box") {
      bar.appendChild(el("span", "rc-subbar-divider"));
      const boxModeSeg = el("div", "rc-seg-pill rc-box-mode-seg");
      const activeBoxMode = secState.boxMode || "move-face";
      for (const [id, label, tip] of [
        ["move-face", "Move face", "Hover any face and drag to push/pull"],
        ["scale-box", "Scale box", "Resize box symmetrically along XYZ or uniformly"],
        ["move-box", "Move box", "Translate entire box in 3D"],
        ["rotate-box", "Rotate box", "Rotate box to align with angled geometry"],
      ]) {
        const mBtn = el(
          "button",
          `rc-seg-btn${activeBoxMode === id ? " is-active" : ""}`,
          {
            type: "button",
            text: label,
            title: tip,
            "data-box-mode": id,
          },
        );
        mBtn.addEventListener("click", () => section?.setBoxMode?.(id));
        boxModeSeg.appendChild(mBtn);
      }
      bar.appendChild(boxModeSeg);
    }

    bar.appendChild(el("span", "rc-subbar-spacer"));

    // Far-right Gizmo / Issue stamp button + thin × close
    const gizmoBtn = el(
      "button",
      `rc-icon-btn rc-subbar-stamp-btn${secState.handlesVisible !== false ? " is-active" : ""}`,
      {
        type: "button",
        title: "Toggle 3D section gizmo visibility",
        html: ICONS.commentPlus,
      },
    );
    gizmoBtn.addEventListener("click", () => section?.toggleHandlesVisible?.());
    bar.appendChild(gizmoBtn);

    const closeBtn = el("button", "rc-icon-btn rc-close-btn", {
      type: "button",
      title: "Close Section tool (keeps active cut on model)",
      html: ICONS.close,
    });
    closeBtn.addEventListener("click", () => setDrawer(null));
    bar.appendChild(closeBtn);

    return bar;
  }

  function renderRulerSubbar() {
    // Matches Revizto 5 Ruler bar: Ruler | (New) | [5 modes] | [Regular] i | [■▾] [💬+] (Meters ▾) ✕
    const bar = el("div", "rc-revizto-subbar rc-ruler-subbar");

    const title = el("span", "rc-subbar-title", { text: "Ruler" });
    bar.appendChild(title);

    // New stadium pill
    const newBtn = el("button", "rc-pill-btn", {
      type: "button",
      text: "New",
      title: "Start a new measurement (or clear measurements on double-clear)",
    });
    newBtn.addEventListener("click", () => ruler?.startNewMeasurement?.());
    bar.appendChild(newBtn);

    // 5 Revizto mode icons (active square is white with dark icon)
    const modeDefs = [
      { id: "laser", icon: ICONS.laser, title: "Laser (Perpendicular surface normal distance)" },
      { id: "p2p", icon: ICONS.p2p, title: "Point-to-Point distance (ΔX / ΔY / ΔZ)" },
      { id: "min-distance", icon: ICONS.minDistance, title: "Min Distance between 2 objects" },
      { id: "elevation", icon: ICONS.elevation, title: "Elevation (Spot Z & vertical drop; Shift+Click for ΔZ)" },
      { id: "angle", icon: ICONS.angle, title: "Angle (3 points: leg - vertex - leg)" },
    ];
    const modeGroup = el("div", "rc-ruler-modes");
    for (const m of modeDefs) {
      const mBtn = el(
        "button",
        `rc-mode-icon-btn${rulState.mode === m.id ? " is-selected" : ""}`,
        {
          type: "button",
          title: m.title,
          "data-mode": m.id,
          html: m.icon,
        },
      );
      mBtn.addEventListener("click", () => ruler?.setMode?.(m.id));
      modeGroup.appendChild(mBtn);
    }
    bar.appendChild(modeGroup);

    // Regular / Chain rectangular box + light-blue info circle
    const chainBtn = el(
      "button",
      `rc-regular-box rc-chain-btn${rulState.chain ? " is-active" : ""}`,
      {
        type: "button",
        text: rulState.chain ? "Chain" : "Regular",
        title: "Toggle Regular (2-click pairs) vs Chain (continuous linked segments)",
      },
    );
    chainBtn.addEventListener("click", () => ruler?.toggleChain?.());
    bar.appendChild(chainBtn);

    const infoDot = el("span", "rc-info-dot", {
      text: "i",
      title: "Regular measures pairs of points. Chain continues automatically from the last point.",
    });
    bar.appendChild(infoDot);

    bar.appendChild(el("span", "rc-subbar-spacer"));

    // Color square swatch button + dropdown palette
    const colorWrap = el("div", "rc-dropdown-wrap");
    const colorBtn = el("button", "rc-color-btn", {
      type: "button",
      title: "Measurement line color",
    });
    const swatch = el("span", "rc-color-swatch");
    swatch.style.background = rulState.color || "#ef4444";
    const caret = el("span", "rc-color-caret", { text: "▾" });
    colorBtn.appendChild(swatch);
    colorBtn.appendChild(caret);
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      unitsMenuOpen = false;
      colorMenuOpen = !colorMenuOpen;
      render();
    });
    colorWrap.appendChild(colorBtn);

    if (colorMenuOpen) {
      const pop = el("div", "rc-popover-menu rc-color-menu");
      for (const hex of DEFAULT_COLORS) {
        const cOpt = el(
          "button",
          `rc-swatch-opt${rulState.color === hex ? " is-active" : ""}`,
          { type: "button", title: hex },
        );
        cOpt.style.background = hex;
        cOpt.addEventListener("click", () => {
          ruler?.setColor?.(hex);
          colorMenuOpen = false;
          render();
        });
        pop.appendChild(cOpt);
      }
      colorWrap.appendChild(pop);
    }
    bar.appendChild(colorWrap);

    // Revizto speech-bubble [+] button (toggles ΔXYZ axis leg guides)
    const deltaBtn = el(
      "button",
      `rc-icon-btn rc-subbar-stamp-btn${rulState.showDeltas ? " is-active" : ""}`,
      {
        type: "button",
        title: "Toggle IFC ΔX / ΔY / ΔZ guide legs",
        html: ICONS.commentPlus,
      },
    );
    deltaBtn.addEventListener("click", () => ruler?.setShowDeltas?.(!rulState.showDeltas));
    bar.appendChild(deltaBtn);

    // Unit selector stadium pill dropdown with hollow caret
    const unitWrap = el("div", "rc-dropdown-wrap");
    const activeUnitDef = DEFAULT_UNITS.find((u) => u.id === rulState.unit) || DEFAULT_UNITS[0];
    const unitBtn = el("button", "rc-pill-btn rc-unit-btn", {
      type: "button",
      title: "Change measurement units",
    });
    unitBtn.appendChild(el("span", "", { text: activeUnitDef.label }));
    unitBtn.appendChild(el("span", "rc-unit-caret", { html: ICONS.hollowCaret }));
    unitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      colorMenuOpen = false;
      unitsMenuOpen = !unitsMenuOpen;
      render();
    });
    unitWrap.appendChild(unitBtn);

    if (unitsMenuOpen) {
      const menu = el("div", "rc-popover-menu rc-units-menu");
      for (const u of DEFAULT_UNITS) {
        const item = el(
          "button",
          `rc-popover-item${rulState.unit === u.id ? " is-active" : ""}`,
          {
            type: "button",
            text: `${u.label} (${u.id})`,
          },
        );
        item.addEventListener("click", () => {
          ruler?.setUnit?.(u.id);
          unitsMenuOpen = false;
          render();
        });
        menu.appendChild(item);
      }
      unitWrap.appendChild(menu);
    }
    bar.appendChild(unitWrap);

    if (rulState.count > 0) {
      const clearBtn = el("button", "rc-pill-btn", {
        type: "button",
        text: "Clear",
        title: "Clear all measurements",
      });
      clearBtn.addEventListener("click", () => ruler?.clearAll?.());
      bar.appendChild(clearBtn);
    }

    // Thin × close button
    const closeBtn = el("button", "rc-icon-btn rc-close-btn", {
      type: "button",
      title: "Exit Ruler (Esc)",
      html: ICONS.close,
    });
    closeBtn.addEventListener("click", () => setDrawer(null));
    bar.appendChild(closeBtn);

    return bar;
  }

  function renderBottomBar(bottomState) {
    bottomDock.innerHTML = "";
    if (!bottomState.visible) {
      bottomDock.hidden = true;
      return;
    }
    bottomDock.hidden = false;

    const bar = el("div", "rc-revizto-bottom-bar", { id: "rc-revizto-bottom-bar" });

    // 1. Unhide All (N) button at the bottom
    if (bottomState.unhideVisible) {
      const unhideBtn = el("button", "rc-bottom-action-btn is-unhide", {
        type: "button",
        title: "Unhide all hidden elements (Ctrl+Shift+H)",
        "data-action": "unhideAll",
      });
      unhideBtn.innerHTML = `${ICONS.unhide}<span>${bottomState.unhideLabel}</span>`;
      unhideBtn.addEventListener("click", () => visibility?.unhideAll?.());
      bar.appendChild(unhideBtn);
    }

    if (bottomState.unhideVisible && bottomState.unisolateVisible) {
      bar.appendChild(el("span", "rc-capsule-sep"));
    }

    // 2. Unisolate + Ghost/Solid toggle at the bottom
    if (bottomState.unisolateVisible) {
      const unisoBtn = el("button", "rc-bottom-action-btn is-unisolate", {
        type: "button",
        title: "Unisolate — restore surrounding elements",
        "data-action": "unisolate",
      });
      unisoBtn.innerHTML = `${ICONS.isolate}<span>${bottomState.unisolateLabel}</span>`;
      unisoBtn.addEventListener("click", () => isolation?.resetIsolation?.());
      bar.appendChild(unisoBtn);

      // Segmented Ghost | Hide mode toggle inside bottom isolation bar
      const modeSeg = el("div", "rc-seg-pill rc-bottom-seg");
      const ghostOpt = el(
        "button",
        `rc-seg-btn${preferredIsolateMode === "ghost" ? " is-active" : ""}`,
        {
          type: "button",
          text: "Ghost",
          title: "Show unselected context in ghost transparency",
        },
      );
      ghostOpt.addEventListener("click", async () => {
        preferredIsolateMode = "ghost";
        await isolation?.isolate?.(undefined, { mode: "ghost" });
        render();
      });

      const solidOpt = el(
        "button",
        `rc-seg-btn${preferredIsolateMode === "hard" ? " is-active" : ""}`,
        {
          type: "button",
          text: "Hide Rest",
          title: "Completely hide unselected elements",
        },
      );
      solidOpt.addEventListener("click", async () => {
        preferredIsolateMode = "hard";
        await isolation?.isolate?.(undefined, { mode: "hard" });
        render();
      });

      modeSeg.appendChild(ghostOpt);
      modeSeg.appendChild(solidOpt);
      bar.appendChild(modeSeg);
    }

    // 3. Show All when both hidden and isolated are active
    if (bottomState.showAllVisible) {
      bar.appendChild(el("span", "rc-capsule-sep"));
      const showAllBtn = el("button", "rc-pill-btn", {
        type: "button",
        text: "Show All",
        title: "Reset both isolation and hidden elements",
      });
      showAllBtn.addEventListener("click", async () => {
        await isolation?.resetIsolation?.();
        await visibility?.unhideAll?.();
      });
      bar.appendChild(showAllBtn);
    }

    bottomDock.appendChild(bar);
  }

  function render() {
    renderHint();
    subbarHost.innerHTML = "";
    if (openDrawer === "section") {
      subbarHost.appendChild(renderSectionSubbar());
    } else if (openDrawer === "ruler") {
      subbarHost.appendChild(renderRulerSubbar());
    }

    const pres = computeToolbarPresentationState({
      hiddenCount: visState.hiddenCount,
      hasSelection: visState.hasSelection,
      isolateMode: isoState.mode,
      preferredIsolateMode,
      sectionState: secState,
      rulerState: rulState,
      openDrawer,
    });

    // Zone 1: Top 4-button Revizto Strip (Hide | Isolate | Section | Ruler)
    capsule.innerHTML = "";

    // 1. Hide
    const hideBtn = el("button", "rc-revizto-btn", {
      type: "button",
      title: pres.hideBtn.title,
      "data-action": "hide",
    });
    hideBtn.disabled = pres.hideBtn.disabled;
    hideBtn.innerHTML = `${ICONS.hide}<span>${pres.hideBtn.label}</span>`;
    hideBtn.addEventListener("click", async () => {
      const map = await resolveSelectionMap();
      await visibility?.hideSelection?.(map);
    });
    capsule.appendChild(hideBtn);

    capsule.appendChild(el("span", "rc-capsule-sep"));

    // 1b. Optional Hide Tagged button (injected by Cable Tray Viewer between Hide and Isolate)
    if (hideTaggedAction && typeof hideTaggedAction.onToggle === "function") {
      const active = Boolean(hideTaggedAction.isActive?.());
      const taggedCount = Number(hideTaggedAction.getCount?.() || 0);
      const disabled = !active && taggedCount === 0;
      const hideTaggedBtn = el(
        "button",
        `rc-revizto-btn${active ? " is-active" : ""}`,
        {
          type: "button",
          title: active
            ? "Show Tagged Elements (currently hidden)"
            : taggedCount > 0
              ? `Hide ${taggedCount} Tagged Element${taggedCount === 1 ? "" : "s"}`
              : "No tagged elements to hide yet",
          "data-action": "hide-tagged",
        },
      );
      hideTaggedBtn.disabled = disabled;
      const labelText = active ? "Tagged Hidden" : "Hide Tagged";
      const badgeHtml = taggedCount > 0 ? `<span class="rc-revizto-badge">${taggedCount}</span>` : "";
      hideTaggedBtn.innerHTML = `${ICONS.hideTagged}<span>${labelText}</span>${badgeHtml}`;
      hideTaggedBtn.addEventListener("click", async () => {
        await hideTaggedAction.onToggle();
        render();
      });
      capsule.appendChild(hideTaggedBtn);
      capsule.appendChild(el("span", "rc-capsule-sep"));
    }

    // 2. Isolate
    const isoBtn = el("button", "rc-revizto-btn", {
      type: "button",
      title: pres.isolateBtn.title,
      "data-action": "isolate",
    });
    isoBtn.disabled = pres.isolateBtn.disabled;
    isoBtn.innerHTML = `${ICONS.isolate}<span>${pres.isolateBtn.label}</span>`;
    isoBtn.addEventListener("click", async () => {
      const map = await resolveSelectionMap();
      await isolation?.isolate?.(map, { mode: preferredIsolateMode });
    });
    capsule.appendChild(isoBtn);

    capsule.appendChild(el("span", "rc-capsule-sep"));

    // 3. Section
    const secBtn = el(
      "button",
      `rc-revizto-btn${pres.sectionBtn.active ? " is-active" : ""}`,
      {
        type: "button",
        title: "Toggle Section Plane / Box (Ctrl+X)",
        "data-action": "section",
      },
    );
    secBtn.innerHTML = `${ICONS.section}<span>${pres.sectionBtn.label}</span>${
      pres.sectionBtn.badge ? `<span class="rc-revizto-badge">${pres.sectionBtn.badge}</span>` : ""
    }`;
    secBtn.addEventListener("click", () => {
      setDrawer(openDrawer === "section" ? null : "section");
    });
    capsule.appendChild(secBtn);

    capsule.appendChild(el("span", "rc-capsule-sep"));

    // 4. Ruler
    const rulBtn = el(
      "button",
      `rc-revizto-btn${pres.rulerBtn.active ? " is-active" : ""}`,
      {
        type: "button",
        title: "Toggle 5-Mode Ruler (M)",
        "data-action": "ruler",
      },
    );
    rulBtn.innerHTML = `${ICONS.ruler}<span>${pres.rulerBtn.label}</span>${
      pres.rulerBtn.badge ? `<span class="rc-revizto-badge">${pres.rulerBtn.badge}</span>` : ""
    }`;
    rulBtn.addEventListener("click", () => {
      setDrawer(openDrawer === "ruler" ? null : "ruler");
    });
    capsule.appendChild(rulBtn);

    // Zone 3: Bottom Unhide / Unisolate Bar
    renderBottomBar(pres.bottomBar);
  }

  // Subscribe to controllers with strict mutual exclusion on openDrawer
  if (visibility?.onChange) {
    unsubs.push(
      visibility.onChange((s) => {
        visState = { hiddenCount: s.hiddenCount, hasSelection: s.hasSelection };
        isoState = { mode: s.isolateMode ?? isoState.mode };
        render();
      }),
    );
  } else if (visibility?.onVisibilityChange) {
    unsubs.push(
      visibility.onVisibilityChange((count) => {
        visState = { ...visState, hiddenCount: count };
        render();
      }),
    );
  }

  if (section?.onChange) {
    unsubs.push(
      section.onChange((s) => {
        secState = s;
        if (s.open && openDrawer !== "section") {
          openDrawer = "section";
          ruler?.setActive?.(false);
        } else if (!s.open && openDrawer === "section") {
          openDrawer = null;
        }
        render();
      }),
    );
  }

  if (ruler?.onChange) {
    unsubs.push(
      ruler.onChange((s) => {
        rulState = s;
        if (s.active && openDrawer !== "ruler") {
          openDrawer = "ruler";
          section?.setActive?.(false);
        } else if (!s.active && openDrawer === "ruler") {
          openDrawer = null;
        }
        render();
      }),
    );
  }

  const onDocClick = () => {
    if (unitsMenuOpen || colorMenuOpen) {
      closePopovers();
      render();
    }
  };
  document.addEventListener("click", onDocClick);

  const dockHost = container.parentElement || container;
  dockHost.appendChild(root);
  dockHost.appendChild(bottomDock);
  render();

  return {
    element: root,
    bottomElement: bottomDock,
    update(patch = {}) {
      if ("hiddenCount" in patch) visState.hiddenCount = patch.hiddenCount;
      if ("hasSelection" in patch) visState.hasSelection = patch.hasSelection;
      if ("isolateMode" in patch) isoState.mode = patch.isolateMode;
      render();
    },
    openDrawer(name) {
      setDrawer(name);
    },
    closeDrawer() {
      setDrawer(null);
    },
    getOpenDrawer() {
      return openDrawer;
    },
    dispose() {
      document.removeEventListener("click", onDocClick);
      while (unsubs.length > 0) {
        const fn = unsubs.pop();
        try { fn?.(); } catch { /* noop */ }
      }
      if (root.parentNode) root.parentNode.removeChild(root);
      if (bottomDock.parentNode) bottomDock.parentNode.removeChild(bottomDock);
    },
  };
}
