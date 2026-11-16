import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeToolbarPresentationState } from "../src/revizto-toolbar.js";

describe("Revizto Toolbar Presentation State", () => {
  it("disables Hide and Isolate in top bar when no selection and hides bottom bar when nothing hidden/isolated", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 0,
      hasSelection: false,
      isolateMode: "none",
    });
    assert.equal(state.hideBtn.label, "Hide");
    assert.equal(state.hideBtn.disabled, true);
    assert.equal(state.isolateBtn.label, "Isolate");
    assert.equal(state.isolateBtn.disabled, true);
    assert.equal(state.bottomBar.visible, false);
    assert.equal(state.bottomBar.unhideVisible, false);
    assert.equal(state.bottomBar.unisolateVisible, false);
  });

  it("surfaces Unhide (N) in the bottom bar while keeping top Hide button fixed when items are hidden", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 4,
      hasSelection: false,
      isolateMode: "none",
    });
    assert.equal(state.hideBtn.label, "Hide");
    assert.equal(state.hideBtn.action, "hide");
    assert.equal(state.hideBtn.disabled, true);
    assert.equal(state.bottomBar.visible, true);
    assert.equal(state.bottomBar.unhideVisible, true);
    assert.equal(state.bottomBar.unhideLabel, "Unhide (4)");
  });

  it("enables top Hide & Isolate when selection is active alongside bottom Unhide (N)", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 3,
      hasSelection: true,
      isolateMode: "none",
    });
    assert.equal(state.hideBtn.label, "Hide");
    assert.equal(state.hideBtn.disabled, false);
    assert.equal(state.isolateBtn.label, "Isolate");
    assert.equal(state.isolateBtn.disabled, false);
    assert.equal(state.bottomBar.visible, true);
    assert.equal(state.bottomBar.unhideVisible, true);
    assert.equal(state.bottomBar.unhideLabel, "Unhide (3)");
  });

  it("surfaces Unisolate and Show All in the bottom bar when isolated", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 2,
      hasSelection: false,
      isolateMode: "ghost",
    });
    assert.equal(state.isolateBtn.label, "Isolate");
    assert.equal(state.bottomBar.visible, true);
    assert.equal(state.bottomBar.unisolateVisible, true);
    assert.equal(state.bottomBar.unisolateLabel, "Unisolate");
    assert.equal(state.bottomBar.showAllVisible, true);
  });

  it("enforces mutual exclusion between Section and Ruler active states on top bar", () => {
    const planeCut = computeToolbarPresentationState({
      sectionState: { open: true, active: true, mode: "plane", planeCount: 1, hasCuts: true },
      openDrawer: "section",
    });
    assert.equal(planeCut.sectionBtn.badge, "Cut");
    assert.equal(planeCut.sectionBtn.active, true);
    assert.equal(planeCut.rulerBtn.active, false);

    // When Ruler opens while Section still has active scene cuts, Section button is not active-tool highlighted
    const rulerOverSectionCut = computeToolbarPresentationState({
      sectionState: { open: false, active: true, mode: "box", boxActive: true, hasCuts: true },
      rulerState: { active: true, count: 5 },
      openDrawer: "ruler",
    });
    assert.equal(rulerOverSectionCut.sectionBtn.badge, "Box");
    assert.equal(rulerOverSectionCut.sectionBtn.active, false);
    assert.equal(rulerOverSectionCut.rulerBtn.active, true);
    assert.equal(rulerOverSectionCut.rulerBtn.badge, "5");
  });
});
