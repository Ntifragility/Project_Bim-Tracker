import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLocalFolderTransport,
  createChunkedModelManager,
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
});
