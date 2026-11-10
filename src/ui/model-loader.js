// Model loading for the tray viewer.
//
// Handles file inputs, drag-and-drop sample loading, the `?ifc=` deep link,
// the loaded-models sidebar list, camera fit, and wireframe toggles.
// Extracted verbatim from `src/main.js` (behaviour unchanged per R1); the
// module receives the app context and calls back into `hooks` for panel
// refreshes owned by other feature modules.

import * as THREE from 'three';
import { extractTraySystemAssignmentsFromIfc } from '../ifc/ifc-tag-exporter.js';
import { formatBytes, showLoader, updateLoader, hideLoader } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} hooks cross-panel callbacks:
 *   renderExcelTable, renderTraySystemManager, refreshValidationReportIfOpen,
 *   refreshLoadedModelsList (bound by the caller), clearElementProperties,
 *   invalidateBatchUndo, renderPendingTrayDeletions-free `onUnloadModel`
 */
export function initModelLoader(ctx, dom, hooks) {
  // Helper: Fit camera to all visible models or a single model
  function fitModelsToView(modelsToFit = null) {
    const { world } = ctx;
    const targets = modelsToFit || ctx.loadedModels.filter((m) => m.visible).map((m) => m.model);
    if (targets.length === 0) {
      world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0, true);
      return;
    }
    const combinedBox = new THREE.Box3();
    let hasBox = false;
    for (const model of targets) {
      // FragmentsModel.box contains the complete IFC bounds even when its
      // distant tiles have not yet been rendered by the current camera view.
      const storedBox = model?.box;
      const box = storedBox && !storedBox.isEmpty()
        // FragmentsModel.box is already returned in world coordinates.
        ? storedBox
        : new THREE.Box3().setFromObject(model?.object || model);
      if (!box || box.isEmpty()) continue;
      if (!hasBox) combinedBox.copy(box);
      else combinedBox.union(box);
      hasBox = true;
    }

    if (!hasBox) {
      console.warn('[Camera Focus] No valid model bounds were available.');
      return;
    }

    const sphere = new THREE.Sphere();
    combinedBox.getBoundingSphere(sphere);
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) sphere.radius = 1;
    world.camera.controls.fitToSphere(sphere, true);
  }

  // Helper: Fit camera to a single model
  function fitModelToView(model) {
    fitModelsToView([model]);
  }

  // Helper: Refresh the loaded models UI sidebar list
  function refreshLoadedModelsList() {
    const { loadedModelsList, modelsPlaceholder } = dom;
    if (!loadedModelsList) return;
    loadedModelsList.innerHTML = '';

    if (ctx.loadedModels.length === 0) {
      if (modelsPlaceholder) modelsPlaceholder.style.display = 'block';
      loadedModelsList.style.display = 'none';
      return;
    }

    if (modelsPlaceholder) modelsPlaceholder.style.display = 'none';
    loadedModelsList.style.display = 'flex';

    ctx.loadedModels.forEach((modelEntry) => {
      const li = document.createElement('li');
      li.className = 'model-item';
      if (ctx.activeModel === modelEntry.model) {
        li.classList.add('active');
      }

      // Model info container
      const infoDiv = document.createElement('div');
      infoDiv.className = 'model-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'model-name';
      nameSpan.textContent = modelEntry.name;
      nameSpan.title = modelEntry.name;

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'model-size';
      sizeSpan.textContent = modelEntry.size;

      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(sizeSpan);

      // Model actions container
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'model-actions';

      // Visibility button
      const visBtn = document.createElement('button');
      visBtn.className = 'model-btn visible-toggle';
      if (!modelEntry.visible) {
        visBtn.classList.add('hidden-model');
      }
      visBtn.title = modelEntry.visible ? 'Hide model' : 'Show model';
      visBtn.textContent = '👁️';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelEntry.visible = !modelEntry.visible;
        const modelObject = modelEntry.model.object || modelEntry.model;
        if (modelObject) {
          modelObject.visible = modelEntry.visible;
        }

        // If we hid the active model, clear select highlighter highlight
        if (!modelEntry.visible) {
          try {
            ctx.highlighter.clear('select');
          } catch (err) {
            console.warn(err);
          }
        }

        refreshLoadedModelsList();
      });

      // Zoom button
      const zoomBtn = document.createElement('button');
      zoomBtn.className = 'model-btn zoom';
      zoomBtn.title = 'Focus on model';
      zoomBtn.setAttribute('aria-label', `Focus on ${modelEntry.name}`);
      zoomBtn.textContent = '🔍';
      zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fitModelToView(modelEntry.model);
      });

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'model-btn delete';
      deleteBtn.title = 'Delete model';
      deleteBtn.textContent = '🗑️';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unloadModel(modelEntry);
      });

      actionsDiv.appendChild(visBtn);
      actionsDiv.appendChild(zoomBtn);
      actionsDiv.appendChild(deleteBtn);

      li.appendChild(infoDiv);
      li.appendChild(actionsDiv);

      // Clicking the item selects/deselects the active model, showing properties, highlighting, and auto-orbiting
      li.addEventListener('click', async () => {
        if (ctx.activeModel === modelEntry.model) {
          // Deselect active model (toggle off)
          ctx.activeModel = null;
          ctx.autoRotateActive = false;
          if (dom.orbitIndicator) {
            dom.orbitIndicator.style.display = 'none';
          }
          try {
            ctx.highlighter.clear('select');
          } catch (err) {
            console.warn(err);
          }

          // Reset element properties panel
          hooks.clearElementProperties();

          refreshLoadedModelsList();
          return;
        }

        // Select the clicked model
        ctx.activeModel = modelEntry.model;
        hooks.clearElementProperties();

        // 1. Highlight all elements of this model
        if (modelEntry.model.expressIDToFragmentMap) {
          const allExpressIds = Object.keys(modelEntry.model.expressIDToFragmentMap).map(Number);
          const selectedFragmentMap = modelEntry.model.getFragmentMap(allExpressIds);
          ctx.highlighter.isProgrammaticSelect = true;
          try {
            await ctx.highlighter.highlightByID('select', selectedFragmentMap, true);
          } catch (err) {
            console.warn('[Highlighter] Failed to select all elements of model:', err);
          } finally {
            ctx.highlighter.isProgrammaticSelect = false;
          }
        }

        // 2. Zoom to the selected model
        fitModelToView(modelEntry.model);

        // 3. Trigger Auto-Orbit
        ctx.engine.autoOrbit.start();
        console.log(`[Auto-Orbit] Activated for model: ${modelEntry.name}`);

        refreshLoadedModelsList();
      });

      dom.loadedModelsList.appendChild(li);
    });
  }

  // Loader function
  async function loadModel(buffer, name, sizeFormatted) {
    showLoader(dom, 'Loading Model', `Parsing '${name}'...`, 30);
    const sourceIfcBytes = buffer.slice();

    // Check if the model with the same name is already loaded to avoid collisions
    if (ctx.loadedModels.some((m) => m.name === name)) {
      let baseName = name;
      let extension = '';
      const dotIndex = name.lastIndexOf('.');
      if (dotIndex !== -1) {
        baseName = name.substring(0, dotIndex);
        extension = name.substring(dotIndex);
      }
      let counter = 1;
      while (ctx.loadedModels.some((m) => m.name === `${baseName} (${counter})${extension}`)) {
        counter++;
      }
      name = `${baseName} (${counter})${extension}`;
    }

    try {
      const model = await ctx.engine.loadIfc(buffer, name, (progress) => {
        const pct = Math.round(progress * 100);
        updateLoader(dom, `Parsing IFC geometries... (${pct}%)`, 30 + pct * 0.6);
      });

      if (!model) {
        throw new Error('Parsed model is empty or invalid.');
      }

      ctx.activeModel = model;
      const modelObject = model.object || model;

      // Add to scene
      ctx.world.scene.three.add(modelObject);

      // Index model relations for property queries
      if (ctx.indexer) {
        try {
          await ctx.indexer.process(model);
          console.log(`[IfcRelationsIndexer] Indexed relations for '${name}'.`);
        } catch (e) {
          console.warn('[IfcRelationsIndexer] Failed to process model:', e);
        }
      }

      // Create model entry
      const modelEntry = {
        uuid: model.uuid || Math.random().toString(36).substring(7),
        name,
        size: sizeFormatted,
        model,
        sourceIfcBytes,
        existingProjectTags: extractTraySystemAssignmentsFromIfc(sourceIfcBytes),
        visible: true,
      };

      ctx.loadedModels.push(modelEntry);
      hooks.renderExcelTable();
      hooks.renderTraySystemManager();
      hooks.refreshValidationReportIfOpen();

      // Fit camera to model
      fitModelToView(model);

      // Apply current wireframe setting
      setWireframeForModel(model, ctx.isWireframe);

      // Refresh loaded models UI
      refreshLoadedModelsList();

      // Reset element properties (no element selected yet)
      hooks.clearElementProperties();

      hideLoader(dom);
      console.log(`Model '${name}' loaded successfully.`);
    } catch (err) {
      console.error('Error loading IFC model:', err);
      updateLoader(dom, `Error loading model: ${err.message}`, 0);
      setTimeout(() => hideLoader(dom), 3000);
    }
  }

  // Helper: Unload a single model
  function unloadModel(modelEntry) {
    const model = modelEntry.model;
    const modelObject = model.object || model;

    // Stop auto-rotate if the model being deleted was the active model
    if (ctx.activeModel === model) {
      ctx.autoRotateActive = false;
      if (dom.orbitIndicator) {
        dom.orbitIndicator.style.display = 'none';
      }
    }

    ctx.world.scene.three.remove(modelObject);
    try {
      if (ctx.fragments.disposeGroup) {
        ctx.fragments.disposeGroup(model);
      } else if (ctx.fragments.dispose) {
        if (model.uuid) {
          ctx.fragments.dispose(model.uuid);
        } else {
          ctx.fragments.dispose();
        }
      }
    } catch (e) {
      console.warn('Error disposing model in FragmentsManager:', e);
    }

    // Remove from loadedModels
    hooks.invalidateBatchUndo();
    for (const [key, assignment] of ctx.tagAssignments) {
      if (assignment.modelId === model.modelId || assignment.modelId === model.uuid) ctx.tagAssignments.delete(key);
    }
    ctx.loadedModels = ctx.loadedModels.filter((m) => m.uuid !== modelEntry.uuid);
    hooks.renderExcelTable();
    hooks.refreshValidationReportIfOpen();

    // If the unloaded model was the active model, update activeModel reference
    if (ctx.activeModel === model) {
      if (ctx.loadedModels.length > 0) {
        const nextActive = ctx.loadedModels[ctx.loadedModels.length - 1];
        ctx.activeModel = nextActive.model;
      } else {
        ctx.activeModel = null;
      }
      // Reset element properties panel
      hooks.clearElementProperties();
    }

    // Clear highlights on unload to prevent stale highlight references
    try {
      ctx.highlighter.clear('select');
    } catch (err) {
      console.warn(err);
    }

    refreshLoadedModelsList();
  }

  // Helper: Clear active model (for backwards compatibility/reset)
  function clearActiveModel() {
    if (ctx.activeModel) {
      const entry = ctx.loadedModels.find((m) => m.model === ctx.activeModel);
      if (entry) {
        unloadModel(entry);
      } else {
        const modelObject = ctx.activeModel.object || ctx.activeModel;
        ctx.world.scene.three.remove(modelObject);
        ctx.activeModel = null;
      }
    }
  }

  // Toggle helpers
  function setWireframeForModel(model, wireframeState) {
    const modelObject = model.object || model;
    if (!modelObject) return;
    modelObject.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => { mat.wireframe = wireframeState; });
          } else if (child.material) {
            child.material.wireframe = wireframeState;
          }
        }
      }
    });
  }

  function setWireframe(value) {
    ctx.isWireframe = value;
    ctx.engine.setWireframe(ctx.isWireframe);
  }

  function wireFileInputs() {
    // Listeners: Sidebar controls
    dom.btnLoadSample.addEventListener('click', async () => {
      const url = 'https://raw.githubusercontent.com/andrewisen/bim-whale-ifc-samples/main/BasicHouse/IFC/BasicHouse.ifc';
      showLoader(dom, 'Downloading Sample', 'Fetching BasicHouse.ifc from remote repository...', 10);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download sample: HTTP ${response.status}`);
        }

        updateLoader(dom, 'Reading sample data...', 20);
        const data = await response.arrayBuffer();
        const buffer = new Uint8Array(data);

        await loadModel(buffer, 'BasicHouse.ifc', formatBytes(data.byteLength));
      } catch (err) {
        console.error(err);
        updateLoader(dom, `Download failed: ${err.message}`, 0);
        setTimeout(() => hideLoader(dom), 3000);
      }
    });

    dom.btnUpload.addEventListener('click', () => {
      dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files);
      if (files.length === 0) return;

      dom.fileInput.value = ''; // Reset file input

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progressLabel = files.length > 1 ? ` (${i + 1}/${files.length})` : '';

        showLoader(dom, `Uploading File${progressLabel}`, `Reading ${file.name}...`, 10);

        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = async (e) => {
            updateLoader(dom, `File ${file.name} loaded, parsing...`, 25);
            const data = e.target.result;
            const buffer = new Uint8Array(data);
            try {
              await loadModel(buffer, file.name, formatBytes(file.size));
            } catch (err) {
              console.error(`Failed to load ${file.name}:`, err);
            }
            resolve();
          };
          reader.onerror = () => {
            console.error(`Failed to read file ${file.name}`);
            resolve();
          };
          reader.readAsArrayBuffer(file);
        });
      }
    });

    // Optional deep link for local review and automated validation:
    // ?ifc=/path/to/model.ifc
    const linkedIfcUrl = new URLSearchParams(window.location.search).get('ifc');
    if (linkedIfcUrl) {
      const linkedName = decodeURIComponent(linkedIfcUrl.split('/').pop() || 'LinkedModel.ifc');
      showLoader(dom, 'Loading Linked IFC', `Fetching ${linkedName}...`, 10);
      (async () => {
        try {
          const response = await fetch(linkedIfcUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.arrayBuffer();
          await loadModel(new Uint8Array(data), linkedName, formatBytes(data.byteLength));
        } catch (error) {
          console.error('[Linked IFC] Load failed:', error);
          updateLoader(dom, `Linked IFC failed: ${error.message}`, 0);
          setTimeout(() => hideLoader(dom), 3000);
        }
      })();
    }

    dom.btnResetCamera.addEventListener('click', () => {
      fitModelsToView();
    });
  }

  return {
    loadModel,
    unloadModel,
    clearActiveModel,
    fitModelsToView,
    fitModelToView,
    refreshLoadedModelsList,
    setWireframe,
    setWireframeForModel,
    wireFileInputs,
  };
}
