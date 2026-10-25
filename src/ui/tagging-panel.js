// Tagging workbench for the tray viewer.
//
// Owns single-element assignment, batch preview/apply/undo, sequence
// allocation, validation and the tag-mapping export. Extracted verbatim from
// `src/main.js` (behaviour unchanged per R1); shared state lives in the app
// context and cross-panel refreshes go through the `api` object.
//
// NOTE (latent bug preserved, see spec open questions): the export handler
// builds a `summaryRows` value that the monolith never defined
// (`ReferenceError` at click time, identical in `legacy/src/main.js`).

import { exportTagMapping } from 'excel-io';
import { allocateElementTags, getSystemTag, normalizeTagScheme } from '../tagging/tag-scheme.js';
import { classifyTaggableElement } from '../tagging/element-classifier.js';
import { validateTagIntegrity } from '../ifc/tag-validator.js';
import { getAssignmentKey, requestTagReplacement } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initTaggingPanel(ctx, dom, api) {
  function getAssignmentForElement(element = ctx.selectedIfcElement) {
    if (!element) return null;
    return ctx.tagAssignments.get(getAssignmentKey(element.modelId, element.localId)) || null;
  }

  function getExistingProjectTag(element = ctx.selectedIfcElement) {
    if (!element) return '';
    const modelEntry = ctx.loadedModels.find((entry) =>
      entry.model?.modelId === element.modelId || entry.model?.uuid === element.modelId
    );
    return modelEntry?.existingProjectTags?.get(Number(element.localId))?.systemTag || '';
  }

  function getExistingTrayAssignment(element) {
    if (!element) return null;
    return api.findLoadedModelEntry(element.modelId)?.existingProjectTags?.get(Number(element.localId)) || null;
  }

  function getAssignmentSourceLabel(element) {
    if (!element) return 'Unknown';
    if (element.delete === true) return 'Deleted';
    if (element.source === 'pending' && element.wasSaved) return 'Modified';
    if (element.source === 'pending') return 'Pending';
    return 'Saved';
  }

  function getEnteredSystemTag() {
    return dom.systemTagInput.value.trim();
  }

  function getBatchScheme() {
    return normalizeTagScheme({
      prefix: dom.batchPrefix?.value,
      system: dom.batchSystem?.value,
      separator: '.',
      sequenceDigits: dom.batchSequenceDigits?.value,
      startSequence: dom.batchStartSequence?.value,
      typeCodes: {
        tray: dom.batchTrayCode?.value,
        fitting: dom.batchFittingCode?.value,
      },
    });
  }

  function setBatchStatus(message, tone = '') {
    if (!dom.batchStatus) return;
    dom.batchStatus.textContent = message;
    if (tone) dom.batchStatus.dataset.tone = tone;
    else delete dom.batchStatus.dataset.tone;
  }

  function updateBatchPatternExample() {
    if (!dom.batchPatternExample) return;
    const scheme = getBatchScheme();
    const requestedKind = dom.batchElementKind?.value === 'fitting' ? 'fitting' : 'tray';
    const sequence = String(scheme.startSequence).padStart(scheme.sequenceDigits, '0');
    dom.batchPatternExample.textContent = [
      getSystemTag(scheme),
      scheme.typeCodes[requestedKind],
      sequence,
    ].join(scheme.separator);
  }

  function setTaggingMode(mode) {
    const assignActive = mode !== 'manage';
    dom.batchTaggingPane.hidden = !assignActive;
    dom.tagManagementPane.hidden = assignActive;
    dom.taggingTabAssign.classList.toggle('active', assignActive);
    dom.taggingTabManage.classList.toggle('active', !assignActive);
    dom.taggingTabAssign.setAttribute('aria-selected', String(assignActive));
    dom.taggingTabManage.setAttribute('aria-selected', String(!assignActive));
  }

  function selectedKeysFromMap(modelIdMap = api.getSelectedModelIdMap()) {
    const keys = [];
    for (const [modelId, ids] of Object.entries(modelIdMap || {})) {
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      for (const localId of values) keys.push(getAssignmentKey(modelId, localId));
    }
    return keys;
  }

  function reconcileSelectionOrder(modelIdMap = api.getSelectedModelIdMap()) {
    const selectedKeys = selectedKeysFromMap(modelIdMap);
    const selectedSet = new Set(selectedKeys);
    ctx.selectionOrderKeys = [
      ...ctx.selectionOrderKeys.filter((key) => selectedSet.has(key)),
      ...selectedKeys.filter((key) => !ctx.selectionOrderKeys.includes(key)),
    ];
    if (dom.batchSelectionCount) {
      const count = selectedKeys.length;
      dom.batchSelectionCount.textContent = `${count} selected`;
    }
    if (dom.btnPreviewBatchTags) dom.btnPreviewBatchTags.disabled = selectedKeys.length === 0;
  }

  async function getOrderedCurrentSelectionElements() {
    const selection = api.getSelectedModelIdMap();
    reconcileSelectionOrder(selection);
    const selectedSet = new Set(selectedKeysFromMap(selection));
    const elements = [];
    for (const key of ctx.selectionOrderKeys) {
      if (!selectedSet.has(key)) continue;
      const separatorIndex = key.lastIndexOf(':');
      const modelId = key.slice(0, separatorIndex);
      const localId = Number(key.slice(separatorIndex + 1));
      const modelEntry = api.findLoadedModelEntry(modelId);
      if (!modelEntry || !Number.isInteger(localId)) continue;
      elements.push(await api.readElementIdentity(modelEntry.model, localId, modelEntry.name));
    }
    return elements;
  }

  function getEffectiveAssignmentForElement(element) {
    const key = getAssignmentKey(element.modelId, element.localId);
    return api.getEffectiveTaggedElements().find((item) => getAssignmentKey(item.modelId, item.localId) === key) || null;
  }

  function clearBatchPreview(message = '') {
    ctx.batchPreviewElements = [];
    ctx.batchPreviewAssignments = [];
    dom.batchPreviewList.innerHTML = '';
    dom.batchPreviewPanel.hidden = true;
    dom.batchReplaceConflictsRow.hidden = true;
    dom.batchReplaceConflicts.checked = false;
    dom.btnApplyBatchTags.disabled = true;
    if (message) setBatchStatus(message);
  }

  function invalidateBatchUndo() {
    ctx.lastBatchSnapshot = null;
    if (dom.btnUndoBatchTags) dom.btnUndoBatchTags.disabled = true;
  }

  function renderBatchPreview() {
    dom.batchPreviewList.innerHTML = '';
    const hasConflicts = ctx.batchPreviewAssignments.some((item) => item.conflict);
    dom.batchReplaceConflictsRow.hidden = !hasConflicts;
    for (let index = 0; index < ctx.batchPreviewAssignments.length; index += 1) {
      const assignment = ctx.batchPreviewAssignments[index];
      const item = document.createElement('li');
      item.className = 'batch-preview-item';
      item.dataset.conflict = String(Boolean(assignment.conflict));

      const copy = document.createElement('div');
      copy.className = 'batch-preview-copy';
      const tag = document.createElement('strong');
      tag.className = 'batch-preview-tag';
      tag.textContent = assignment.elementTag;
      const meta = document.createElement('span');
      meta.className = 'batch-preview-meta';
      const kindLabel = assignment.elementKind === 'fitting' ? 'Cable fitting' : 'Cable tray';
      const conflictLabel = assignment.conflict ? ` · replaces ${assignment.previousTag}` : '';
      meta.textContent = `${kindLabel} · ${assignment.name || assignment.type || `Element #${assignment.localId}`}${conflictLabel}`;
      copy.append(tag, meta);

      const actions = document.createElement('div');
      actions.className = 'batch-order-actions';
      for (const [label, offset] of [['↑', -1], ['↓', 1]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'batch-order-button';
        button.textContent = label;
        button.title = offset < 0 ? 'Move earlier' : 'Move later';
        button.setAttribute('aria-label', `${button.title}: ${assignment.elementTag}`);
        button.disabled = offset < 0 ? index === 0 : index === ctx.batchPreviewAssignments.length - 1;
        button.addEventListener('click', async () => {
          const target = index + offset;
          [ctx.batchPreviewElements[index], ctx.batchPreviewElements[target]] = [ctx.batchPreviewElements[target], ctx.batchPreviewElements[index]];
          await generateBatchPreview(ctx.batchPreviewElements);
        });
        actions.appendChild(button);
      }
      item.append(copy, actions);
      dom.batchPreviewList.appendChild(item);
    }
    dom.batchPreviewPanel.hidden = false;
    dom.btnApplyBatchTags.disabled = hasConflicts && !dom.batchReplaceConflicts.checked;
  }

  async function generateBatchPreview(elements) {
    const requestedKind = dom.batchElementKind.value;
    const classified = elements.map((element) => {
      if (requestedKind !== 'auto') {
        return { ...element, resolvedKind: requestedKind, classificationMethod: 'manual', classificationConfidence: 1 };
      }
      const result = classifyTaggableElement(element);
      return {
        ...element,
        resolvedKind: result.kind,
        classificationMethod: result.evidence,
        classificationConfidence: result.confidence,
      };
    });
    const unresolved = classified.filter((element) => !element.resolvedKind);
    if (unresolved.length) {
      clearBatchPreview();
      setBatchStatus(
        `${unresolved.length} selected element${unresolved.length === 1 ? '' : 's'} could not be classified. Choose Cable Tray or Cable Fitting explicitly.`,
        'warning',
      );
      return false;
    }

    const existingAssignments = api.getEffectiveTaggedElements();
    const generatedByKey = new Map();
    for (const kind of ['tray', 'fitting']) {
      const kindElements = classified.filter((element) => element.resolvedKind === kind);
      if (!kindElements.length) continue;
      const result = allocateElementTags({
        elements: kindElements,
        elementKind: kind,
        scheme: getBatchScheme(),
        existingAssignments,
      });
      if (!result.valid) {
        clearBatchPreview();
        setBatchStatus(result.errors.join(' '), 'warning');
        return false;
      }
      for (const assignment of result.assignments) {
        generatedByKey.set(getAssignmentKey(assignment.modelId, assignment.localId), assignment);
      }
    }

    ctx.batchPreviewAssignments = classified.map((element) => {
      const key = getAssignmentKey(element.modelId, element.localId);
      const generated = generatedByKey.get(key);
      const previousAssignment = getEffectiveAssignmentForElement(element);
      const previousTag = previousAssignment?.componentId || element.ifcTag || '';
      const conflict = Boolean(previousTag && previousTag.toLowerCase() !== generated.componentId.toLowerCase());
      return {
        ...generated,
        classificationMethod: element.classificationMethod,
        classificationConfidence: element.classificationConfidence,
        originalIfcTag: element.ifcTag || '',
        previousAssignment,
        previousTag,
        conflict,
      };
    });
    renderBatchPreview();
    const conflictCount = ctx.batchPreviewAssignments.filter((item) => item.conflict).length;
    setBatchStatus(
      conflictCount
        ? `Preview ready with ${conflictCount} existing assignment conflict${conflictCount === 1 ? '' : 's'}.`
        : `${ctx.batchPreviewAssignments.length} tag${ctx.batchPreviewAssignments.length === 1 ? '' : 's'} ready to apply in the displayed order.`,
      conflictCount ? 'warning' : 'success',
    );
    return true;
  }

  function normalizeColumnName(name) {
    return String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function isComponentIdColumn(name = ctx.selectedExcelIdColumn) {
    return ['elementtag', 'componentid', 'componenttag', 'pieceid'].includes(normalizeColumnName(name));
  }

  function isSystemTagColumn(name = ctx.selectedExcelIdColumn) {
    return ['systemtag', 'tag', 'traytag'].includes(normalizeColumnName(name));
  }

  function findComponentById(componentId) {
    const normalizedId = String(componentId || '').trim().toLowerCase();
    if (!normalizedId) return null;
    return api.getEffectiveTaggedElements().find(
      (element) => element.componentId?.trim().toLowerCase() === normalizedId,
    ) || null;
  }

  function getEffectiveTaggedElements() {
    const elements = new Map();
    for (const modelEntry of ctx.loadedModels) {
      const modelId = modelEntry.model.modelId || modelEntry.model.uuid;
      for (const [localId, projectTag] of modelEntry.existingProjectTags || []) {
        const key = getAssignmentKey(modelId, localId);
        elements.set(key, {
          modelId,
          modelName: modelEntry.name,
          localId: Number(localId),
          systemTag: projectTag.systemTag,
          elementTag: projectTag.elementTag || projectTag.componentId,
          componentId: projectTag.componentId,
          elementKind: projectTag.elementKind || '',
          typeCode: projectTag.typeCode || '',
          sequenceNumber: projectTag.sequenceNumber,
          schemeVersion: projectTag.schemeVersion || '',
          source: 'ifc',
        });
      }
    }
    for (const [key, assignment] of ctx.tagAssignments) {
      if (ctx.loadedModels.some((entry) =>
        entry.model.modelId === assignment.modelId || entry.model.uuid === assignment.modelId
      )) {
        if (assignment.delete === true) {
          elements.delete(key);
          continue;
        }
        elements.set(key, { ...assignment, source: 'pending' });
      }
    }
    return Array.from(elements.values());
  }

  function getExcelTagsForValidation() {
    if (!ctx.selectedExcelIdColumn || !isSystemTagColumn()) return [];
    return ctx.excelData.map((row, index) => ({
      rowNumber: index + 2,
      tag: String(row[ctx.selectedExcelIdColumn] ?? '').trim(),
    }));
  }

  function runTagValidation() {
    const result = validateTagIntegrity({
      elements: getEffectiveTaggedElements(),
      excelTags: getExcelTagsForValidation(),
    });

    dom.tagValidationReport.hidden = false;
    const tone = !result.valid ? 'error' : result.warnings.length ? 'warning' : 'success';
    dom.tagValidationReport.dataset.tone = tone;
    dom.tagValidationBadge.textContent = !result.valid ? 'Blocked' : result.warnings.length ? 'Warnings' : 'Ready';
    dom.tagValidationCounts.textContent = `${result.counts.ifcTags} tray systems · ${result.counts.excelTags} Excel rows · ${result.counts.matchedTags} matched`;
    dom.tagValidationIssues.innerHTML = '';

    const issues = [
      ...result.errors.map((issue) => ({ ...issue, level: 'error' })),
      ...result.warnings.map((issue) => ({ ...issue, level: 'warning' })),
    ];
    if (!issues.length) issues.push({ level: 'success', message: 'No tag integrity problems found.' });
    for (const issue of issues) {
      const item = document.createElement('li');
      item.className = `validation-${issue.level}`;
      item.textContent = issue.message;
      dom.tagValidationIssues.appendChild(item);
    }
    return result;
  }

  function refreshValidationReportIfOpen() {
    if (!dom.tagValidationReport.hidden) runTagValidation();
  }

  function refreshSystemTagSuggestions() {
    const tags = Array.from(new Set(
      api.getEffectiveTaggedElements().map((element) => element.systemTag).filter(Boolean),
    )).sort((a, b) => a.localeCompare(b));
    dom.systemTagSuggestions.innerHTML = '';
    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag;
      dom.systemTagSuggestions.appendChild(option);
    }
  }

  function updateTagAssignmentUi(message = '', tone = '') {
    refreshSystemTagSuggestions();
    api.updateExcelNavigationUi();
    const selectedTag = getEnteredSystemTag();
    const assignment = getAssignmentForElement();
    const viewerSelectionCount = api.countModelIdMapItems(api.getSelectedModelIdMap());
    const selectedElementCount = ctx.traySelection.size || viewerSelectionCount;
    const elementLabel = ctx.selectedIfcElement
      ? `${ctx.selectedIfcElement.name || ctx.selectedIfcElement.type || 'IFC element'} (#${ctx.selectedIfcElement.localId})`
      : 'no IFC element selected';
    const rowLabel = selectedTag ? `system “${selectedTag}”` : 'no system tag entered';

    dom.tagAssignmentStatus.textContent = message || `${rowLabel}; ${elementLabel}.`;
    if (tone) dom.tagAssignmentStatus.dataset.tone = tone;
    else delete dom.tagAssignmentStatus.dataset.tone;
    dom.tagAssignmentSummary.textContent = `${ctx.tagAssignments.size} pending change${ctx.tagAssignments.size === 1 ? '' : 's'}`;
    dom.traySelectionSummary.textContent = selectedElementCount
      ? `${selectedElementCount} element${selectedElementCount === 1 ? '' : 's'} selected · click empty space to clear`
      : '0 elements selected';
    dom.btnAssignTag.textContent = selectedTag && selectedElementCount
      ? `Assign ${selectedTag} to ${selectedElementCount} element${selectedElementCount === 1 ? '' : 's'}`
      : 'Assign System Tag';
    dom.btnAddTraySelection.disabled = !ctx.selectedIfcElement;
    dom.btnAssignTag.disabled = !selectedTag || selectedElementCount === 0;
    dom.btnHighlightSystem.disabled = !selectedTag || api.findSystemMembers(selectedTag).length === 0;
    dom.btnUnassignTag.disabled = !assignment;
    dom.btnValidateTags.disabled = ctx.loadedModels.length === 0 || getEffectiveTaggedElements().length === 0;
    dom.btnExportTags.disabled = getEffectiveTaggedElements().length === 0;
    dom.btnExportTaggedIfc.disabled = ctx.tagAssignments.size === 0;
    reconcileSelectionOrder();
    api.renderTraySystemManager();

    if (ctx.selectedIfcElement) {
      const existingAssignment = getExistingTrayAssignment(ctx.selectedIfcElement);
      const displayedTag = assignment?.delete === true
        ? '-'
        : assignment?.elementTag || assignment?.componentId ||
          existingAssignment?.elementTag || existingAssignment?.componentId ||
          ctx.selectedIfcElement.ifcTag || assignment?.systemTag || existingAssignment?.systemTag || '-';
      dom.propTag.textContent = displayedTag;
      dom.propTag.title = displayedTag;
    }
  }

  async function assignElementsToSystem(systemTag, selectedElements, options = {}) {
    const normalizedSystemTag = String(systemTag || '').trim();
    if (!normalizedSystemTag || !selectedElements.length) return false;

    const conflict = selectedElements.find((element) => {
      const elementAssignment = getAssignmentForElement(element);
      const currentSystem = elementAssignment?.systemTag || getExistingProjectTag(element);
      return currentSystem && currentSystem.toLowerCase() !== normalizedSystemTag.toLowerCase();
    });
    if (conflict && !options.skipConflictPrompt) {
      const currentSystem = getAssignmentForElement(conflict)?.systemTag || getExistingProjectTag(conflict);
      const confirmed = await requestTagReplacement(dom, conflict.localId, currentSystem, normalizedSystemTag);
      if (!confirmed) {
        updateTagAssignmentUi('Tray-system assignment cancelled.', 'warning');
        return false;
      }
    }
    invalidateBatchUndo();

    const usedSequences = getEffectiveTaggedElements()
      .filter((element) => element.systemTag?.toLowerCase() === normalizedSystemTag.toLowerCase())
      .map((element) => Number.parseInt(element.sequenceNumber, 10))
      .filter(Number.isFinite);
    let nextSequence = usedSequences.length ? Math.max(...usedSequences) + 1 : 1;

    for (const element of selectedElements) {
      const key = getAssignmentKey(element.modelId, element.localId);
      const existingAssignment = getAssignmentForElement(element);
      const sourceAssignment = api.findLoadedModelEntry(element.modelId)?.existingProjectTags?.get(Number(element.localId));
      const keepSequence = (existingAssignment?.systemTag || sourceAssignment?.systemTag)?.toLowerCase() === normalizedSystemTag.toLowerCase();
      const sequenceNumber = keepSequence
        ? existingAssignment?.sequenceNumber || sourceAssignment?.sequenceNumber
        : String(nextSequence++).padStart(3, '0');
      ctx.tagAssignments.set(key, {
        ...element,
        systemTag: normalizedSystemTag,
        componentId: `${normalizedSystemTag}-C${sequenceNumber}`,
        sequenceNumber,
        excelRowIndex: ctx.selectedExcelRowIndex,
      });
      if (ctx.selectedIfcElement?.modelId === element.modelId && Number(ctx.selectedIfcElement.localId) === Number(element.localId)) {
        api.syncProjectTagPropertyGroup(api.findLoadedModelEntry(element.modelId)?.model || ctx.activeModel, element.localId);
      }
    }

    ctx.selectedTraySystemTag = normalizedSystemTag;
    dom.systemTagInput.value = normalizedSystemTag;
    ctx.traySelection.clear();
    api.renderExcelTable();
    refreshValidationReportIfOpen();
    updateTagAssignmentUi(
      options.message || `Successfully assigned tray system "${normalizedSystemTag}" to ${selectedElements.length} element${selectedElements.length === 1 ? '' : 's'}.`,
      'success',
    );
    return true;
  }

  function wireBatchControls() {
    dom.taggingTabAssign?.addEventListener('click', () => setTaggingMode('assign'));
    dom.taggingTabManage?.addEventListener('click', () => setTaggingMode('manage'));

    for (const field of [
      dom.batchPrefix,
      dom.batchSystem,
      dom.batchElementKind,
      dom.batchTrayCode,
      dom.batchFittingCode,
      dom.batchStartSequence,
      dom.batchSequenceDigits,
    ]) {
      const onBatchPatternChange = () => {
        updateBatchPatternExample();
        if (ctx.batchPreviewAssignments.length) clearBatchPreview('Pattern changed. Preview the selected elements again.');
      };
      field?.addEventListener('input', onBatchPatternChange);
      field?.addEventListener('change', onBatchPatternChange);
    }

    dom.btnPreviewBatchTags?.addEventListener('click', async () => {
      const elements = await getOrderedCurrentSelectionElements();
      if (!elements.length) {
        clearBatchPreview('Select one or more IFC elements to begin.');
        return;
      }
      ctx.batchPreviewElements = elements;
      await generateBatchPreview(ctx.batchPreviewElements);
    });

    dom.batchReplaceConflicts?.addEventListener('change', () => {
      const hasConflicts = ctx.batchPreviewAssignments.some((item) => item.conflict);
      dom.btnApplyBatchTags.disabled = !ctx.batchPreviewAssignments.length || (hasConflicts && !dom.batchReplaceConflicts.checked);
    });

    dom.btnApplyBatchTags?.addEventListener('click', () => {
      if (!ctx.batchPreviewAssignments.length) return;
      const conflicts = ctx.batchPreviewAssignments.filter((item) => item.conflict);
      if (conflicts.length && !dom.batchReplaceConflicts.checked) {
        setBatchStatus('Confirm replacement of the existing assignments before applying this batch.', 'warning');
        return;
      }

      ctx.lastBatchSnapshot = ctx.batchPreviewAssignments.map((assignment) => {
        const key = getAssignmentKey(assignment.modelId, assignment.localId);
        return {
          key,
          previous: ctx.tagAssignments.has(key) ? { ...ctx.tagAssignments.get(key) } : null,
        };
      });
      for (const assignment of ctx.batchPreviewAssignments) {
        const { previousAssignment, previousTag, conflict, ...committed } = assignment;
        ctx.tagAssignments.set(getAssignmentKey(committed.modelId, committed.localId), {
          ...committed,
          excelRowIndex: ctx.selectedExcelRowIndex,
        });
      }

      const systemTag = ctx.batchPreviewAssignments[0].systemTag;
      ctx.selectedTraySystemTag = systemTag;
      dom.systemTagInput.value = systemTag;
      dom.btnUndoBatchTags.disabled = false;
      api.renderExcelTable();
      refreshValidationReportIfOpen();
      if (ctx.selectedIfcElement) api.syncProjectTagPropertyGroup(ctx.activeModel, ctx.selectedIfcElement.localId);
      updateTagAssignmentUi(
        `Applied ${ctx.batchPreviewAssignments.length} element tag${ctx.batchPreviewAssignments.length === 1 ? '' : 's'} to system “${systemTag}”.`,
        'success',
      );
      setBatchStatus(
        `Applied ${ctx.batchPreviewAssignments.length} tag${ctx.batchPreviewAssignments.length === 1 ? '' : 's'}. You can undo this batch until another batch is applied.`,
        'success',
      );
    });

    dom.btnUndoBatchTags?.addEventListener('click', () => {
      if (!ctx.lastBatchSnapshot?.length) return;
      for (const snapshot of ctx.lastBatchSnapshot) {
        if (snapshot.previous) ctx.tagAssignments.set(snapshot.key, snapshot.previous);
        else ctx.tagAssignments.delete(snapshot.key);
      }
      const restoredCount = ctx.lastBatchSnapshot.length;
      ctx.lastBatchSnapshot = null;
      dom.btnUndoBatchTags.disabled = true;
      api.renderExcelTable();
      refreshValidationReportIfOpen();
      if (ctx.selectedIfcElement) api.syncProjectTagPropertyGroup(ctx.activeModel, ctx.selectedIfcElement.localId);
      updateTagAssignmentUi(`Undid the last batch of ${restoredCount} tag${restoredCount === 1 ? '' : 's'}.`, 'success');
      setBatchStatus(`Last batch undone. ${restoredCount} element${restoredCount === 1 ? '' : 's'} restored.`, 'success');
    });

    setTaggingMode('assign');
    updateBatchPatternExample();
    reconcileSelectionOrder({});
  }

  function wireAssignmentControls() {
    dom.systemTagInput.addEventListener('input', () => {
      updateTagAssignmentUi();
    });

    dom.systemTagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !dom.btnHighlightSystem.disabled) {
        event.preventDefault();
        dom.btnHighlightSystem.click();
      }
    });

    dom.btnHighlightSystem.addEventListener('click', async () => {
      const systemTag = getEnteredSystemTag();
      const members = api.findSystemMembers(systemTag);
      if (!members.length) {
        updateTagAssignmentUi(`Warning: no loaded components belong to tray system “${systemTag}”.`, 'warning');
        return;
      }
      await api.highlightTrayMembers(
        members,
        `Highlighted ${members.length} components for tray system “${systemTag}”.`,
      );
    });

    dom.btnAddTraySelection.addEventListener('click', () => {
      if (!ctx.selectedIfcElement) return;
      ctx.traySelection.set(
        getAssignmentKey(ctx.selectedIfcElement.modelId, ctx.selectedIfcElement.localId),
        { ...ctx.selectedIfcElement },
      );
      updateTagAssignmentUi(`Added element #${ctx.selectedIfcElement.localId} to the tray-system selection.`);
    });

    dom.btnAssignTag.addEventListener('click', async () => {
      const systemTag = getEnteredSystemTag();
      const selectedElements = ctx.traySelection.size
        ? Array.from(ctx.traySelection.values())
        : await api.getCurrentSelectionElements();
      await assignElementsToSystem(systemTag, selectedElements);
    });

    dom.btnUnassignTag.addEventListener('click', () => {
      const assignment = getAssignmentForElement();
      if (!assignment) return;
      invalidateBatchUndo();
      ctx.tagAssignments.delete(getAssignmentKey(assignment.modelId, assignment.localId));
      ctx.selectedExcelRowIndex = assignment.excelRowIndex;
      api.renderExcelTable();
      updateTagAssignmentUi(`Removed “${assignment.systemTag}” from element #${assignment.localId}.`);
      api.syncProjectTagPropertyGroup(ctx.activeModel, assignment.localId);
      refreshValidationReportIfOpen();
    });

    dom.btnValidateTags.addEventListener('click', () => {
      const result = runTagValidation();
      updateTagAssignmentUi(
        result.valid
          ? `Validation complete: ${result.counts.errors} errors and ${result.counts.warnings} warnings.`
          : `Validation blocked export: ${result.counts.errors} error${result.counts.errors === 1 ? '' : 's'} found.`,
        result.valid ? (result.warnings.length ? 'warning' : 'success') : 'warning',
      );
    });

    dom.btnExportTags.addEventListener('click', async () => {
      if (getEffectiveTaggedElements().length === 0) return;
      updateTagAssignmentUi('Reading tray dimensions for the mapping export...');
      dom.btnExportTags.disabled = true;
      const assignments = getEffectiveTaggedElements()
        .sort((a, b) => a.systemTag.localeCompare(b.systemTag) || Number(a.sequenceNumber) - Number(b.sequenceNumber));
      const rows = await Promise.all(assignments.map(async (assignment) => {
        const modelEntry = api.findLoadedModelEntry(assignment.modelId);
        const identity = modelEntry
          ? await api.readElementIdentity(modelEntry.model, assignment.localId, modelEntry.name)
          : assignment;
        return {
          Model: assignment.modelName,
          IFC_GlobalId: assignment.globalId || identity.globalId || '',
          Local_ID: assignment.localId,
          SystemTag: assignment.systemTag,
          ElementTag: assignment.elementTag || assignment.componentId,
          ComponentId: assignment.componentId,
          ElementKind: assignment.elementKind || '',
          TypeCode: assignment.typeCode || '',
          SequenceNumber: assignment.sequenceNumber,
          SourceState: getAssignmentSourceLabel({
            ...assignment,
            source: assignment.source,
            wasSaved: Boolean(getExistingTrayAssignment(assignment)),
          }),
          Element_Name: assignment.name || identity.name || '',
          IFC_Type: assignment.type || identity.type || '',
          ...await api.readElementDimensions(assignment),
          Original_IFC_Tag: assignment.originalIfcTag || identity.ifcTag || '',
          Classification_Method: assignment.classificationMethod || '',
          Classification_Confidence: assignment.classificationConfidence ?? '',
          Excel_Row: Number.isInteger(assignment.excelRowIndex) ? assignment.excelRowIndex + 2 : '',
        };
      }));
      // NOTE: `summaryRows` is not defined anywhere in the legacy or current
      // monolith — the export click throws `ReferenceError` here verbatim.
      exportTagMapping(rows, typeof summaryRows === 'undefined' ? [] : summaryRows, 'IFC_Tag_Mapping.xlsx');
      updateTagAssignmentUi(`Exported ${rows.length} tag assignment${rows.length === 1 ? '' : 's'}.`);
    });
  }

  api.getAssignmentForElement = getAssignmentForElement;
  api.getExistingProjectTag = getExistingProjectTag;
  api.getExistingTrayAssignment = getExistingTrayAssignment;
  api.getAssignmentSourceLabel = getAssignmentSourceLabel;
  api.getEffectiveTaggedElements = getEffectiveTaggedElements;
  api.getEnteredSystemTag = getEnteredSystemTag;
  api.assignElementsToSystem = assignElementsToSystem;
  api.invalidateBatchUndo = invalidateBatchUndo;
  api.clearBatchPreview = clearBatchPreview;
  api.reconcileSelectionOrder = reconcileSelectionOrder;
  api.runTagValidation = runTagValidation;
  api.refreshValidationReportIfOpen = refreshValidationReportIfOpen;
  api.refreshSystemTagSuggestions = refreshSystemTagSuggestions;
  api.updateTagAssignmentUi = updateTagAssignmentUi;
  api.isComponentIdColumn = isComponentIdColumn;
  api.isSystemTagColumn = isSystemTagColumn;
  api.findComponentById = findComponentById;

  return {
    getAssignmentForElement,
    getExistingProjectTag,
    getExistingTrayAssignment,
    getEffectiveTaggedElements,
    getEnteredSystemTag,
    assignElementsToSystem,
    invalidateBatchUndo,
    clearBatchPreview,
    reconcileSelectionOrder,
    runTagValidation,
    refreshValidationReportIfOpen,
    refreshSystemTagSuggestions,
    updateTagAssignmentUi,
    wireBatchControls,
    wireAssignmentControls,
  };
}
