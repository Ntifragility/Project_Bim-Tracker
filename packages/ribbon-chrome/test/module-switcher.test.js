import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveModuleSwitchUrl } from "../src/ribbon.js";

describe("Ribbon Chrome Module Switcher (Conduit Takeoff <-> Cable Tray)", () => {
  it("switches between / (Conduit) and /tray/ (Cable Tray) in production", () => {
    const prodLoc = { protocol: "https:", hostname: "bim.example.com", port: "", search: "" };
    assert.equal(resolveModuleSwitchUrl("conduit", prodLoc), "/");
    assert.equal(resolveModuleSwitchUrl("tray", prodLoc), "/tray/");
  });

  it("carries active ?bundle= cloud URL across module switch for instant IndexedDB cache hit", () => {
    const prodLoc = { protocol: "https:", hostname: "bim.example.com", port: "", search: "" };
    const url = resolveModuleSwitchUrl("tray", prodLoc, {
      bundleUrl: "https://cdn.example.com/PlantA.fragbundle",
    });
    assert.equal(
      url,
      "/tray/?bundle=https%3A%2F%2Fcdn.example.com%2FPlantA.fragbundle",
    );

    const fromSearchLoc = {
      protocol: "https:",
      hostname: "bim.example.com",
      port: "",
      search: "?bundle=https%3A%2F%2Fcdn.example.com%2FPlantB.fragbundle",
    };
    assert.equal(
      resolveModuleSwitchUrl("conduit", fromSearchLoc),
      "/?bundle=https%3A%2F%2Fcdn.example.com%2FPlantB.fragbundle",
    );
  });

  it("maps sibling ports cleanly in localhost dev mode", () => {
    const devConduit = { protocol: "http:", hostname: "localhost", port: "5175", search: "" };
    assert.equal(resolveModuleSwitchUrl("tray", devConduit), "http://localhost:5176/");
    assert.equal(resolveModuleSwitchUrl("conduit", devConduit), "http://localhost:5175/");

    const previewLoc = { protocol: "http:", hostname: "localhost", port: "4173", search: "" };
    assert.equal(resolveModuleSwitchUrl("tray", previewLoc), "/tray/");
    assert.equal(resolveModuleSwitchUrl("conduit", previewLoc), "/");
  });
});
