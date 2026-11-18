// conduit-takeoff/src/ui/model-load.js — IFC model loading + camera views.
//
// Owns (conduit-ui-split module 3): file/`?ifc=` loading, SHA-256 integrity,
// schema detect, progress overlay, `fitCameraToModel`, view presets
// (fit/top/front/right). Registers `api.loadIfcFile` + `api.fitCameraToModel`
// on the coordinator for cross-module use.

import * as THREE from 'three';
import { computeSha256, formatFileSize } from '@conduit-core';

function detectIfcSchema(buf) {
  try {
    const headerChunk = new TextDecoder().decode(new Uint8Array(buf.slice(0, 4096)));
    const match = headerChunk.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
    if (match && match[1]) return match[1].toUpperCase();
  } catch {}
  return 'IFC4';
}

function fitCameraToModel(engine, model) {
  if (!model || !engine.world?.camera?.controls) return;
  const modelObject = model.object || model;
  const storedBox = model.box;
  const box = storedBox && !storedBox.isEmpty()
    ? storedBox
    : new THREE.Box3().setFromObject(modelObject);

  if (box && !box.isEmpty()) {
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) sphere.radius = 1;
    engine.world.camera.controls.fitToSphere(sphere, true);
  } else {
    engine.world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
  }
}

export function createModelLoad({ state, els, engine, api }) {
  let activeLoadedModel = null;
  const getModel = () => activeLoadedModel;

  async function loadIfcFile(file) {
    const STREAM_TO_SERVER_BYTES = 200 * 1024 * 1024;
    const headerBuf = await file.slice(0, 4096).arrayBuffer();
    const schema = detectIfcSchema(headerBuf);

    let sha256 = '';
    let model = null;
    let retainedBuffer = null;

    if (file.size > STREAM_TO_SERVER_BYTES && typeof engine.convertAndLoadLargeIfc === 'function') {
      api.showLoading(`Streaming large IFC (${formatFileSize(file.size)}) to 64-bit .frag compiler…`, 15, file.name);
      const tailSlice = await file.slice(Math.max(0, file.size - 65536)).arrayBuffer();
      const headSlice = await file.slice(0, Math.min(file.size, 65536)).arrayBuffer();
      const fpBytes = new Uint8Array(headSlice.byteLength + tailSlice.byteLength + 8);
      fpBytes.set(new Uint8Array(headSlice), 0);
      fpBytes.set(new Uint8Array(tailSlice), headSlice.byteLength);
      sha256 = await computeSha256(fpBytes.buffer);

      const res = await engine.convertAndLoadLargeIfc(file, (p, detail) => {
        api.showLoading(detail || 'Compiling .frag cache…', 15 + p * 80);
      });
      model = res.model;
    } else {
      api.showLoading('Reading IFC file…', 10, file.name);
      const buffer = await file.arrayBuffer();

      api.showLoading('Calculating SHA-256 integrity hash…', 30);
      sha256 = await computeSha256(buffer);

      api.showLoading('Parsing IFC geometry in Web Worker…', 50);
      model = await engine.loadIfc(new Uint8Array(buffer), file.name, (progress) => {
        api.showLoading('Loading fragments…', 50 + progress * 0.45);
      });
      retainedBuffer = file.size <= 150 * 1024 * 1024 ? buffer : null;
    }

    if (!model) {
      throw new Error('Parsed IFC model is empty or invalid.');
    }

    activeLoadedModel = model;
    const modelObject = model.object || model;
    if (modelObject && !engine.world.scene.three.children.includes(modelObject)) {
      engine.world.scene.three.add(modelObject);
    }

    // Safely fit camera to model
    fitCameraToModel(engine, model);

    // Update state
    state.sourceModel.name = file.name;
    state.sourceModel.size = file.size;
    state.sourceModel.sha256 = sha256;
    state.sourceModel.schema = schema;
    state.sourceModel.buffer = retainedBuffer;

    // Populate UI
    els.modelInfo.hidden = false;
    els.modelName.textContent = file.name;
    els.modelSize.textContent = formatFileSize(file.size);
    els.modelUnit.textContent = state.sourceModel.unit;
    els.modelSchema.textContent = state.sourceModel.schema;

    els.statusText.textContent = `Loaded ${file.name} successfully. Ready for tracing.`;
    api.hideLoading();

    api.updateProjectBrowserTree?.();

    // Automatically switch to Draw tab
    document.querySelector('[data-tab-target="draw"]')?.click();
  }

  async function loadFragFile(file) {
    api.showLoading('Reading .frag cache…', 20, file.name);
    const buffer = await file.arrayBuffer();
    api.showLoading('Streaming binary fragments to GPU…', 60);
    const t0 = performance.now();
    const model = await engine.loadFrag(buffer, file.name);
    const elapsed = Math.round(performance.now() - t0);

    if (!model) {
      throw new Error('Could not load .frag cache file.');
    }

    activeLoadedModel = model;
    const modelObject = model.object || model;
    if (modelObject && !engine.world.scene.three.children.includes(modelObject)) {
      engine.world.scene.three.add(modelObject);
    }

    fitCameraToModel(engine, model);

    state.sourceModel.name = file.name;
    state.sourceModel.size = file.size;
    state.sourceModel.buffer = buffer;
    state.sourceModel.schema = 'FRAG-BINARY';

    els.modelInfo.hidden = false;
    els.modelName.textContent = file.name;
    els.modelSize.textContent = formatFileSize(file.size);
    els.modelUnit.textContent = state.sourceModel.unit;
    els.modelSchema.textContent = 'Optimized Cache (.frag)';

    els.statusText.textContent = `Loaded .frag cache in ${elapsed} ms! Instant rendering ready.`;
    api.hideLoading();
    api.updateProjectBrowserTree?.();
    document.querySelector('[data-tab-target="draw"]')?.click();
  }

  async function saveFragFile() {
    if (!activeLoadedModel) {
      alert('Please load a model first before saving as .frag cache.');
      return;
    }
    api.showLoading('Generating optimized .frag binary cache…', 30);
    try {
      const buffer = await engine.exportFrag(activeLoadedModel);
      const base = (state.sourceModel.name || 'model').replace(/\.(ifc|frag)$/i, '');
      const filename = `${base}.frag`;
      api.downloadFile(buffer, filename, 'application/octet-stream');
      const sizeKb = Math.round(buffer.byteLength / 1024);
      els.statusText.textContent = `Saved optimized cache to ${filename} (${sizeKb} KB, ~90% smaller).`;
    } catch (err) {
      console.error('[Conduit Takeoff] Error exporting .frag cache:', err);
      alert(`Could not export .frag cache: ${err.message}`);
    } finally {
      api.hideLoading();
    }
  }

  function openFragFile() {
    const input = els.fragFileInput || document.getElementById('frag-file-input');
    input?.click();
  }

  async function loadSampleModel(samplePath = '/BasicHouse.ifc') {
    try {
      api.showLoading('Fetching sample IFC model…', 15, 'BasicHouse.ifc');
      const resp = await fetch(samplePath);
      if (!resp.ok) throw new Error(`Could not fetch sample model: ${resp.status}`);
      const blob = await resp.blob();
      const file = new File([blob], 'BasicHouse.ifc', { type: 'application/x-step' });
      if (file.name.toLowerCase().endsWith('.frag')) {
          await loadFragFile(file);
        } else {
          await loadIfcFile(file);
        }
    } catch (err) {
      console.error('[Conduit Takeoff] Error loading sample:', err);
      api.hideLoading();
      alert(`Failed to load sample model: ${err.message}`);
    }
  }

  function wireModelControls() {
    // IFC File Loading
    els.btnOpenIfc.addEventListener('click', () => els.fileInput.click());

    els.fragFileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await loadFragFile(file);
      } catch (err) {
        console.error('[Conduit Takeoff] Error loading .frag:', err);
        api.hideLoading();
        alert(`Failed to load .frag cache: ${err.message}`);
      }
    });

    els.fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        await loadIfcFile(file);
      } catch (err) {
        console.error('[Conduit Takeoff] Error loading IFC:', err);
        api.hideLoading();
        alert(`Failed to load IFC file: ${err.message}`);
      }
    });

    // Camera Controls
    els.btnFitView.addEventListener('click', () => {
      if (activeLoadedModel) {
        fitCameraToModel(engine, activeLoadedModel);
      } else {
        engine.world?.camera?.controls?.setLookAt(12, 12, 12, 0, 2, 0, true);
      }
    });

    els.btnViewTop.addEventListener('click', () => {
      engine.world?.camera?.controls?.setLookAt(0, 30, 0, 0, 0, 0, true);
    });

    els.btnViewFront.addEventListener('click', () => {
      engine.world?.camera?.controls?.setLookAt(0, 2, 30, 0, 2, 0, true);
    });

    els.btnViewRight.addEventListener('click', () => {
      engine.world?.camera?.controls?.setLookAt(30, 2, 0, 0, 2, 0, true);
    });
  }

  api.loadIfcFile = loadIfcFile;
  api.loadFragFile = loadFragFile;
  api.saveFragFile = saveFragFile;
  api.openFragFile = openFragFile;
  api.loadSampleModel = loadSampleModel;
  api.fitCameraToModel = (model) => fitCameraToModel(engine, model);
  api.getLoadedModel = getModel;

  return { loadIfcFile, fitCameraToModel: api.fitCameraToModel, getLoadedModel: getModel, wireModelControls };
}
