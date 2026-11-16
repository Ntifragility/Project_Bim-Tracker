// Revizto-style Bottom Floating Viewport Toolbar + Section & 5-Mode Ruler Sub-bars.
//
// Designed for ribbon-chrome (DOM-pure, zero BIM engine imports):
//   - Capsule: Hide <-> Unhide (N), Isolate <-> Unisolate (+ Solid/Ghost toggle), Section / Uncut, Ruler
//   - Section Sub-bar: Plane | Box, New (surface pick), Top / Front / Side presets, Flip, Clear, Gizmo toggle, ×
//   - Ruler Sub-bar: New, 5 Revizto modes (Laser, P2P, MIN, Elevation, Angle), Regular/Chain ⓘ, Units ▾, Color ■ ▾, ΔXYZ, Clear, ×

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
 * Pure presentation helper so HUD morph states can be tested cleanly without DOM.
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
  let hideBtn;
  if (hasSelection) {
    hideBtn = {
      label: "Hide",
      action: "hide",
      disabled: false,
      highlighted: false,
      title: "Hide Selected Elements (Ctrl+H)",
    };
  } else if (hiddenCount > 0) {
    hideBtn = {
      label: `Unhide (${hiddenCount})`,
      action: "unhideAll",
      disabled: false,
      highlighted: true,
      title: "Unhide All Hidden Elements (Ctrl+Shift+H)",
    };
  } else {
    hideBtn = {
      label: "Hide",
      action: "hide",
      disabled: true,
      highlighted: false,
      title: "Select elements to hide (Ctrl+H)",
    };
  }

  const unhideChipVisible = Boolean(hasSelection && hiddenCount > 0);
  const isolated = isolateMode !== "none";

  let isolateBtn;
  if (hasSelection) {
    isolateBtn = {
      label: "Isolate",
      action: "isolate",
      disabled: false,
      active: isolated,
      title:
        preferredIsolateMode === "ghost"
          ? "Isolate in Transparency (Shift+I)"
          : "Isolate Solid (Ctrl+I)",
    };
  } else if (isolated) {
    isolateBtn = {
      label: "Unisolate",
      action: "unisolate",
      disabled: false,
      active: true,
      title: "Unisolate — restore surrounding elements",
    };
  } else {
    isolateBtn = {
      label: "Isolate",
      action: "isolate",
      disabled: true,
      active: false,
      title: "Select elements to isolate",
    };
  }

  const hasCuts = Boolean(sectionState.hasCuts);
  const cutBadge =
    sectionState.mode === "box" && sectionState.boxActive
      ? "Box"
      : sectionState.planeCount > 0
        ? String(sectionState.planeCount)
        : "";

  const sectionBtn = {
    label: "Section",
    badge: cutBadge,
    active: Boolean(sectionState.active || openDrawer === "section" || hasCuts),
    hasCuts,
    uncutVisible: hasCuts,
  };

  const count = Number(rulerState.count || 0);
  const rulerBtn = {
    label: "Ruler",
    badge: count > 0 ? String(count) : "",
    active: Boolean(rulerState.active || openDrawer === "ruler"),
  };

  return {
    hideBtn,
    unhideChipVisible,
    unhideChipLabel: `Unhide (${hiddenCount})`,
    isolateBtn,
    unisolateChipVisible: Boolean(hasSelection && isolated),
    sectionBtn,
    rulerBtn,
  };
}

const ICONS = {
  hide: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
  unhide: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
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
 * Mounts the sleek Revizto-style bottom floating capsule + collapsible Section & Ruler sub-bars.
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

  // Wrapper anchored bottom-center inside viewport container
  const root = document.createElement("div");
  root.id = "rc-revizto-dock";
  root.className = "rc-revizto-dock";

  const hintEl = document.createElement("div");
  hintEl.className = "rc-revizto-hint";
  hintEl.hidden = true;
  root.appendChild(hintEl);

  const subbarHost = document.createElement("div");
  subbarHost.className = "rc-revizto-subbar-host";
  root.appendChild(subbarHost);

  const capsule = document.createElement("div");
  capsule.id = "rc-revizto-bar";
  capsule.className = "rc-revizto-bar";
  root.appendChild(capsule);

  // Stop canvas pointer events from leaking through the HUD
  root.addEventListener("pointerdown", (e) => e.stopPropagation());
  root.addEventListener("contextmenu", (e) => e.stopPropagation());

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
    if (nextDrawer === "section") {
      section?.setActive?.(true);
      ruler?.setActive?.(false);
    } else if (nextDrawer === "ruler") {
      ruler?.setActive?.(true);
      section?.setActive?.(false);
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
    const hint = secState.hintText || rulState.hintText || "";
    if (!hint) {
      hintEl.hidden = true;
      hintEl.textContent = "";
      return;
    }
    hintEl.hidden = false;
    hintEl.textContent = hint;
  }

  function renderSectionSubbar() {
    const bar = el("div", "rc-revizto-subbar rc-section-subbar");

    const title = el("span", "rc-subbar-title", { text: "Section" });
    bar.appendChild(title);

    // Plane | Box segmented stadium pill (mirrors Revizto screenshot #1)
    const seg = el("div", "rc-seg-pill");
    const planeBtn = el("button", `rc-seg-btn${secState.mode === "plane" ? " is-active" : ""}`, {
      type: "button",
      text: "Plane",
      title: "Cut with oriented clipping planes",
    });
    planeBtn.addEventListener("click", () => section?.setMode?.("plane"));

    const boxBtn = el("button", `rc-seg-btn${secState.mode === "box" ? " is-active" : ""}`, {
      type: "button",
      text: "Box",
      title: "6-face interactive Section Box",
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
            ? "Click any model surface to slice at its plane"
            : "Fit new Section Box around model or selection",
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
      title: "Clear all section cuts (Uncut)",
    });
    clearBtn.disabled = !secState.hasCuts;
    clearBtn.addEventListener("click", () => section?.clearAll?.());
    bar.appendChild(clearBtn);

    if (secState.mode === "plane") {
      for (const [preset, label, titleText] of [
        ["top", "Top", "Horizontal cut slicing top-to-bottom"],
        ["front", "Front", "Vertical cut slicing front-to-back"],
        ["right", "Side", "Vertical cut slicing side-to-side"],
      ]) {
        const pBtn = el("button", "rc-subbar-chip", {
          type: "button",
          text: label,
          title: titleText,
        });
        pBtn.addEventListener("click", () => section?.createPresetCut?.(preset));
        bar.appendChild(pBtn);
      }

      const flipBtn = el("button", "rc-icon-btn", {
        type: "button",
        title: "Flip active cut plane direction",
        html: ICONS.flip,
      });
      flipBtn.disabled = !secState.planeCount;
      flipBtn.addEventListener("click", () => section?.flipActivePlane?.());
      bar.appendChild(flipBtn);
    } else {
      const fitSelBtn = el("button", "rc-subbar-chip", {
        type: "button",
        text: "Selection",
        title: "Fit Section Box tightly around current selection",
      });
      fitSelBtn.addEventListener("click", async () => {
        const sel = await resolveSelectionMap();
        await section?.setBoxToSelection?.(sel);
      });
      bar.appendChild(fitSelBtn);

      const fitModelBtn = el("button", "rc-subbar-chip", {
        type: "button",
        text: "Reset Box",
        title: "Reset Section Box to full model bounds",
      });
      fitModelBtn.addEventListener("click", () => section?.setBoxToModel?.());
      bar.appendChild(fitModelBtn);
    }

    bar.appendChild(el("span", "rc-subbar-spacer"));

    // Far-right Gizmo / Handles toggle with Revizto speech-bubble+ icon + thin × close
    const gizmoBtn = el(
      "button",
      `rc-icon-btn${secState.handlesVisible !== false ? " is-active" : ""}`,
      {
        type: "button",
        title: "Toggle section box / plane handles",
        html: ICONS.commentPlus,
      },
    );
    gizmoBtn.addEventListener("click", () => section?.toggleHandlesVisible?.());
    bar.appendChild(gizmoBtn);

    const closeBtn = el("button", "rc-icon-btn rc-close-btn", {
      type: "button",
      title: "Close Section Bar (keeps active cuts)",
      html: ICONS.close,
    });
    closeBtn.addEventListener("click", () => setDrawer(null));
    bar.appendChild(closeBtn);

    return bar;
  }

  function renderRulerSubbar() {
    const bar = el("div", "rc-revizto-subbar rc-ruler-subbar");

    const title = el("span", "rc-subbar-title", { text: "Ruler" });
    bar.appendChild(title);

    // New stadium pill
    const newBtn = el("button", "rc-pill-btn", {
      type: "button",
      text: "New",
      title: "Start a new measurement",
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

    // Unit selector stadium pill dropdown with hollow caret (mirrors Revizto screenshot #2)
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
      `rc-icon-btn${rulState.showDeltas ? " is-active" : ""}`,
      {
        type: "button",
        title: "Toggle IFC ΔX / ΔY / ΔZ guide legs",
        html: ICONS.commentPlus,
      },
    );
    deltaBtn.addEventListener("click", () => ruler?.setShowDeltas?.(!rulState.showDeltas));
    bar.appendChild(deltaBtn);

    // Clear all measurements button when measurements > 0
    if (rulState.count > 0) {
      const clearBtn = el("button", "rc-pill-btn rc-danger-subtle", {
        type: "button",
        text: "Clear",
        title: "Clear all measurements",
      });
      clearBtn.addEventListener("click", () => ruler?.clearAll?.());
      bar.appendChild(clearBtn);
    }

    bar.appendChild(el("span", "rc-subbar-spacer"));

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

    capsule.innerHTML = "";

    // 1. Hide / Unhide
    const hideBtn = el(
      "button",
      `rc-revizto-btn${pres.hideBtn.highlighted ? " is-unhide" : ""}`,
      {
        type: "button",
        title: pres.hideBtn.title,
        "data-action": pres.hideBtn.action,
      },
    );
    hideBtn.disabled = pres.hideBtn.disabled;
    hideBtn.innerHTML = `${pres.hideBtn.action === "unhideAll" ? ICONS.unhide : ICONS.hide}<span>${pres.hideBtn.label}</span>`;
    hideBtn.addEventListener("click", async () => {
      if (pres.hideBtn.action === "hide") {
        const map = await resolveSelectionMap();
        await visibility?.hideSelection?.(map);
      } else {
        await visibility?.unhideAll?.();
      }
    });
    capsule.appendChild(hideBtn);

    if (pres.unhideChipVisible) {
      const chip = el("button", "rc-revizto-btn rc-revizto-chip is-unhide", {
        type: "button",
        title: "Unhide all hidden elements (Ctrl+Shift+H)",
      });
      chip.innerHTML = `${ICONS.unhide}<span>${pres.unhideChipLabel}</span>`;
      chip.addEventListener("click", () => visibility?.unhideAll?.());
      capsule.appendChild(chip);
    }

    capsule.appendChild(el("span", "rc-capsule-sep"));

    // 2. Isolate / Unisolate + Solid/Ghost split toggle
    const isoWrap = el("div", "rc-iso-group");
    const isoBtn = el(
      "button",
      `rc-revizto-btn${pres.isolateBtn.active ? " is-active" : ""}`,
      {
        type: "button",
        title: pres.isolateBtn.title,
        "data-action": pres.isolateBtn.action,
      },
    );
    isoBtn.disabled = pres.isolateBtn.disabled;
    isoBtn.innerHTML = `${ICONS.isolate}<span>${pres.isolateBtn.label}</span>`;
    isoBtn.addEventListener("click", async () => {
      if (pres.isolateBtn.action === "isolate") {
        const map = await resolveSelectionMap();
        await isolation?.isolate?.(map, { mode: preferredIsolateMode });
      } else {
        await isolation?.resetIsolation?.();
      }
    });
    isoWrap.appendChild(isoBtn);

    const modeBtn = el(
      "button",
      `rc-iso-style-pill${preferredIsolateMode === "ghost" ? " is-ghost" : ""}`,
      {
        type: "button",
        text: preferredIsolateMode === "ghost" ? "Ghost" : "Solid",
        title: "Switch Isolate mode between Ghost (transparent context) and Solid (hide others)",
      },
    );
    modeBtn.addEventListener("click", async () => {
      preferredIsolateMode = preferredIsolateMode === "ghost" ? "hard" : "ghost";
      if (isoState.mode !== "none") {
        await isolation?.isolate?.(undefined, { mode: preferredIsolateMode });
      }
      render();
    });
    isoWrap.appendChild(modeBtn);

    if (pres.unisolateChipVisible) {
      const resetChip = el("button", "rc-revizto-btn rc-revizto-chip is-active", {
        type: "button",
        text: "Unisolate",
        title: "Restore isolated elements",
      });
      resetChip.addEventListener("click", () => isolation?.resetIsolation?.());
      isoWrap.appendChild(resetChip);
    }
    capsule.appendChild(isoWrap);

    capsule.appendChild(el("span", "rc-capsule-sep"));

    // 3. Section / Uncut
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

    if (pres.sectionBtn.uncutVisible) {
      const uncutBtn = el("button", "rc-revizto-btn rc-revizto-chip is-danger-chip", {
        type: "button",
        text: "Uncut",
        title: "Clear all section cuts",
      });
      uncutBtn.addEventListener("click", () => section?.clearAll?.());
      capsule.appendChild(uncutBtn);
    }

    capsule.appendChild(el("span", "rc-capsule-sep"));

    // 4. Ruler
    const rulBtn = el(
      "button",
      `rc-revizto-btn${pres.rulerBtn.active ? " is-active" : ""}`,
      {
        type: "button",
        title: "Toggle 5-Mode Ruler (Ctrl+M)",
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
  }

  // Subscribe to controllers
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
        if (s.active && openDrawer !== "section") {
          openDrawer = "section";
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

  container.appendChild(root);
  render();

  return {
    element: root,
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
    },
  };
}
