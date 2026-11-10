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
    api.showLoading('Reading IFC file…', 10, file.name);
    const buffer = await file.arrayBuffer();

    api.showLoading('Calculating SHA-256 integrity hash…', 30);
    const sha256 = await computeSha256(buffer);
    const schema = detectIfcSchema(buffer);

    api.showLoading('Parsing IFC geometry in Web Worker…', 50);
    const model = await engine.loadIfc(new Uint8Array(buffer), file.name, (progress) => {
      api.showLoading('Loading fragments…', 50 + progress * 0.45);
    });

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
    state.sourceModel.buffer = buffer;

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

  function wireModelControls() {
    // IFC File Loading
    els.btnOpenIfc.addEventListener('click', () => els.fileInput.click());

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
  api.fitCameraToModel = (model) => fitCameraToModel(engine, model);
  api.getLoadedModel = getModel;

  return { loadIfcFile, fitCameraToModel: api.fitCameraToModel, getLoadedModel: getModel, wireModelControls };
}
