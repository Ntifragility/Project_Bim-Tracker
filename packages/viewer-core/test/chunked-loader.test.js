import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLocalFolderTransport,
  createChunkedModelManager,
  selectChunksForCamera,
  isPrincipalChunk,
} from "../src/chunked-loader.js";

describe("SVF2-Lite Chunked .frag Bundle Loader", () => {
  function makeFakeFile(name, content) {
    const buf = typeof content === "string" ? new TextEncoder().encode(content) : content;
    return {
      name,
      webkitRelativePath: `Hospital.fragbundle/${name}`,
      async text() {
        return new TextDecoder().decode(buf);
      },
      async arrayBuffer() {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
    };
  }

  it("reads manifest lazily, loads only requested chunks, and disposes cleanly on unload", async () => {
    const manifest = {
      version: 1,
      format: "fragbundle",
      sourceName: "Hospital.ifc",
      splitMode: "storey",
      chunks: [
        {
          id: "storey-1",
          name: "Level 01",
          file: "00_Level_01.frag",
          elements: 120,
          compressedBytes: 25000000,
          bbox: { min: [0, 0, 0], max: [10, 4, 10] },
        },
        {
          id: "storey-2",
          name: "Level 02",
          file: "01_Level_02.frag",
          elements: 95,
          compressedBytes: 20000000,
          bbox: { min: [0, 4, 0], max: [10, 8, 10] },
        },
      ],
    };

    const transport = createLocalFolderTransport([
      makeFakeFile("manifest.json", JSON.stringify(manifest)),
      makeFakeFile("00_Level_01.frag", new Uint8Array([0x78, 0x9c, 1, 2, 3])),
      makeFakeFile("01_Level_02.frag", new Uint8Array([0x78, 0x9c, 4, 5, 6])),
    ]);

    const sceneChildren = [];
    const disposedIds = [];
    const focusedBoxes = [];
    const loadedCalls = [];

    const fakeEngine = {
      world: {
        scene: {
          three: {
            children: sceneChildren,
            add(obj) { sceneChildren.push(obj); },
            remove(obj) {
              const i = sceneChildren.indexOf(obj);
              if (i >= 0) sceneChildren.splice(i, 1);
            },
          },
        },
      },
      fragments: {
        core: {
          async disposeModel(id) { disposedIds.push(id); },
        },
      },
      focusOnBox(box) { focusedBoxes.push(box); },
      async loadFrag(bytes, modelId) {
        loadedCalls.push({ bytes, modelId });
        return { object: { name: modelId } };
      },
    };

    const mgr = createChunkedModelManager({ engine: fakeEngine });
    await mgr.openBundle(transport);

    // Initially 0 chunks loaded, union bbox focused
    let st = mgr.getState();
    assert.equal(st.active, true);
    assert.equal(st.totalCount, 2);
    assert.equal(st.loadedCount, 0);
    assert.equal(st.loadedCompressedBytes, 0);
    assert.equal(loadedCalls.length, 0);
    assert.equal(focusedBoxes.length, 1);

    // Load Level 01 only
    await mgr.toggleChunk("storey-1");
    st = mgr.getState();
    assert.equal(st.loadedCount, 1);
    assert.equal(st.loadedCompressedBytes, 25000000);
    assert.equal(sceneChildren.length, 1);
    assert.equal(loadedCalls.length, 1);

    // Unload Level 01 -> freed from scene and fragments.core.disposeModel called
    await mgr.toggleChunk("storey-1");
    st = mgr.getState();
    assert.equal(st.loadedCount, 0);
    assert.equal(sceneChildren.length, 0);
    assert.equal(disposedIds.length, 1);
    assert.ok(disposedIds[0].includes("storey-1"));
  });

  it("selectChunksForCamera picks nearest detail zones when zoomed in and returns empty when zoomed out", () => {
    const manifest = {
      format: "fragbundle",
      splitMode: "spatial",
      chunks: [
        { id: "principal-structure", name: "Principal Structure", bbox: { min: [0, 0, 0], max: [90, 20, 90] } },
        { id: "zone-a1", name: "Zone A1", bbox: { min: [0, 0, 0], max: [30, 20, 30] } },
        { id: "zone-a2", name: "Zone A2", bbox: { min: [30, 0, 0], max: [60, 20, 30] } },
        { id: "zone-a3", name: "Zone A3", bbox: { min: [60, 0, 0], max: [90, 20, 30] } },
      ],
    };

    assert.equal(isPrincipalChunk(manifest.chunks[0], 0, manifest), true);
    assert.equal(isPrincipalChunk(manifest.chunks[1], 1, manifest), false);

    // 1. Zoomed in inside Zone A1 -> picks Zone A1 + adjacent Zone A2 (never includes Principal)
    const closeRes = selectChunksForCamera(
      manifest.chunks,
      { x: 12, y: 8, z: 12 },
      { x: 18, y: 5, z: 15 },
      { manifest, maxActiveDetailChunks: 2 },
    );
    assert.equal(closeRes.zoomedOut, false);
    assert.equal(closeRes.desiredIds.has("principal-structure"), false);
    assert.equal(closeRes.desiredIds.has("zone-a1"), true);
    assert.equal(closeRes.desiredIds.has("zone-a2"), true);
    assert.equal(closeRes.desiredIds.has("zone-a3"), false);

    // 2. Normal working distance (~50 m away from Zone A1) -> still streams nearest zones
    const midRes = selectChunksForCamera(
      manifest.chunks,
      { x: 15, y: 35, z: 65 },
      { x: 15, y: 10, z: 15 },
      { manifest, maxActiveDetailChunks: 2 },
    );
    assert.equal(midRes.zoomedOut, false);
    assert.equal(midRes.desiredIds.has("zone-a1"), true);

    // 3. Zoomed far out overlooking the whole plant -> 0 detail chunks (Principal only)
    const farRes = selectChunksForCamera(
      manifest.chunks,
      { x: 45, y: 220, z: 260 },
      { x: 45, y: 10, z: 45 },
      { manifest, maxActiveDetailChunks: 2 },
    );
    assert.equal(farRes.zoomedOut, true);
    assert.equal(farRes.desiredIds.size, 0);
  });

  it("Auto-Stream loads nearest zone, preserves manually pinned zones, and unloads auto zones when turned OFF", async () => {
    const manifest = {
      version: 1,
      format: "fragbundle",
      sourceName: "Plant.ifc",
      splitMode: "spatial",
      chunks: [
        { id: "principal-structure", name: "Principal Structure", file: "00_Principal.frag", elements: 500, compressedBytes: 30000000, bbox: { min: [0, 0, 0], max: [90, 20, 30] } },
        { id: "zone-a1", name: "Zone A1", file: "01_Zone_A1.frag", elements: 200, compressedBytes: 15000000, bbox: { min: [0, 0, 0], max: [30, 20, 30] } },
        { id: "zone-a3", name: "Zone A3", file: "02_Zone_A3.frag", elements: 200, compressedBytes: 15000000, bbox: { min: [60, 0, 0], max: [90, 20, 30] } },
      ],
    };

    const transport = createLocalFolderTransport([
      makeFakeFile("manifest.json", JSON.stringify(manifest)),
      makeFakeFile("00_Principal.frag", new Uint8Array([1, 2])),
      makeFakeFile("01_Zone_A1.frag", new Uint8Array([3, 4])),
      makeFakeFile("02_Zone_A3.frag", new Uint8Array([5, 6])),
    ]);

    const cameraPos = { x: 10, y: 5, z: 10 };
    const cameraTarget = { x: 15, y: 5, z: 15 };
    const disposedIds = [];
    const fakeEngine = {
      world: {
        scene: { three: { children: [], add() {}, remove() {} } },
        camera: {
          three: { position: cameraPos },
          controls: {
            addEventListener() {},
            removeEventListener() {},
            getTarget(v) { v.set(cameraTarget.x, cameraTarget.y, cameraTarget.z); return v; },
          },
        },
      },
      fragments: { core: { async disposeModel(id) { disposedIds.push(id); } } },
      focusOnBox() {},
      async loadFrag(_bytes, modelId) { return { object: { name: modelId } }; },
    };

    const mgr = createChunkedModelManager({ engine: fakeEngine, maxActiveDetailChunks: 1, autoStreamDebounceMs: 10 });
    await mgr.openBundle(transport);
    await mgr.loadChunk("principal-structure");

    // Default is OFF
    assert.equal(mgr.getState().autoStreamEnabled, false);

    // Turn ON near Zone A1 -> Principal + Zone A1 loaded
    await mgr.setAutoStream(true);
    let st = mgr.getState();
    assert.equal(st.autoStreamEnabled, true);
    assert.equal(st.chunks.find((c) => c.id === "principal-structure").loaded, true);
    assert.equal(st.chunks.find((c) => c.id === "zone-a1").loaded, true);
    assert.equal(st.chunks.find((c) => c.id === "zone-a1").autoLoaded, true);
    assert.equal(st.chunks.find((c) => c.id === "zone-a3").loaded, false);

    // Fly camera over to Zone A3 -> Zone A1 unloads, Zone A3 loads, Principal stays
    cameraPos.x = 75;
    cameraTarget.x = 78;
    await mgr.reconcileCameraChunks();
    st = mgr.getState();
    assert.equal(st.chunks.find((c) => c.id === "principal-structure").loaded, true);
    assert.equal(st.chunks.find((c) => c.id === "zone-a1").loaded, false);
    assert.equal(st.chunks.find((c) => c.id === "zone-a3").loaded, true);
    assert.ok(disposedIds.some((id) => id.includes("zone-a1")));

    // Turn OFF -> auto-loaded Zone A3 unloads cleanly, Principal stays
    await mgr.setAutoStream(false);
    st = mgr.getState();
    assert.equal(st.autoStreamEnabled, false);
    assert.equal(st.chunks.find((c) => c.id === "principal-structure").loaded, true);
    assert.equal(st.chunks.find((c) => c.id === "zone-a3").loaded, false);
  });
});
