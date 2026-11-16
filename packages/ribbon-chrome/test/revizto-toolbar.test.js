import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeToolbarPresentationState } from "../src/revizto-toolbar.js";

describe("Revizto Toolbar Presentation State", () => {
  it("disables Hide when no selection and no hidden items", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 0,
      hasSelection: false,
      isolateMode: "none",
    });
    assert.equal(state.hideBtn.label, "Hide");
    assert.equal(state.hideBtn.disabled, true);
    assert.equal(state.unhideChipVisible, false);
    assert.equal(state.isolateBtn.disabled, true);
  });

  it("morphs Hide button to Unhide (N) when items are hidden and selection is cleared", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 4,
      hasSelection: false,
      isolateMode: "none",
    });
    assert.equal(state.hideBtn.label, "Unhide (4)");
    assert.equal(state.hideBtn.action, "unhideAll");
    assert.equal(state.hideBtn.disabled, false);
    assert.equal(state.hideBtn.highlighted, true);
    assert.equal(state.unhideChipVisible, false);
  });

  it("keeps Hide primary and surfaces companion Unhide chip when selection + hidden items coexist", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 3,
      hasSelection: true,
      isolateMode: "none",
    });
    assert.equal(state.hideBtn.label, "Hide");
    assert.equal(state.hideBtn.action, "hide");
    assert.equal(state.unhideChipVisible, true);
    assert.equal(state.unhideChipLabel, "Unhide (3)");
  });

  it("morphs Isolate button to Unisolate when isolated without active selection", () => {
    const state = computeToolbarPresentationState({
      hiddenCount: 0,
      hasSelection: false,
      isolateMode: "ghost",
    });
    assert.equal(state.isolateBtn.label, "Unisolate");
    assert.equal(state.isolateBtn.action, "unisolate");
    assert.equal(state.isolateBtn.disabled, false);
    assert.equal(state.isolateBtn.active, true);
  });

  it("surfaces active Section badge + Uncut chip when cuts exist", () => {
    const planeCut = computeToolbarPresentationState({
      sectionState: { active: true, mode: "plane", planeCount: 2, hasCuts: true },
      openDrawer: "section",
    });
    assert.equal(planeCut.sectionBtn.badge, "2");
    assert.equal(planeCut.sectionBtn.uncutVisible, true);
    assert.equal(planeCut.sectionBtn.active, true);

    const boxCut = computeToolbarPresentationState({
      sectionState: { active: true, mode: "box", boxActive: true, hasCuts: true },
    });
    assert.equal(boxCut.sectionBtn.badge, "Box");
    assert.equal(boxCut.sectionBtn.uncutVisible, true);
  });

  it("surfaces measurement count badge on Ruler button", () => {
    const state = computeToolbarPresentationState({
      rulerState: { active: true, count: 5 },
      openDrawer: "ruler",
    });
    assert.equal(state.rulerBtn.active, true);
    assert.equal(state.rulerBtn.badge, "5");
  });
});
