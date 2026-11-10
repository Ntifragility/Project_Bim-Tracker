// Tray system manager for the tray viewer.
//
// Owns the system list, component inspection, sequence diagnostics,
// continuity reporting, pending-deletion restore and manager actions
// (highlight/isolate/add/remove/continuity/regenerate/rename). Extracted
// verbatim from `src/main.js` (behaviour unchanged per R1); shared lookups
// arrive through the `api` object.

import { getAssignmentKey } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initSystemManager(ctx, dom, api) {
  function findSystemMembers(tag) {
    const normalizedTag = String(tag || '').trim().toLowerCase();
    if (!normalizedTag) return [];
    const members = [];

    for (const [key, assignment] of ctx.tagAssignments) {
      if (assignment.delete === true) continue;
      if (assignment.systemTag.toLowerCase() === normalizedTag) {
        const existing = api.getExistingTrayAssignment(assignment);
        members.push({
          ...assignment,
          source: 'pending',
          wasSaved: Boolean(existing),
        });
      }
    }

    for (const modelEntry of ctx.loadedModels) {
      const modelId = modelEntry.model.modelId || modelEntry.model.uuid;
      for (const [localId, projectTag] of modelEntry.existingProjectTags || []) {
        const key = getAssignmentKey(modelId, localId);
        if (ctx.tagAssignments.has(key)) continue;
        if (projectTag.systemTag.toLowerCase() === normalizedTag) {
          members.push({
            modelId,
            modelName: modelEntry.name,
            localId: Number(localId),
            globalId: '',
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
    }
    return members;
  }

  function getTraySystemSummaries() {
    const systems = new Map();
    for (const element of api.getEffectiveTaggedElements()) {
      const tag = String(element.systemTag || '').trim();
      if (!tag) continue;
      const normalized = tag.toLowerCase();
      if (!systems.has(normalized)) {
        systems.set(normalized, {
          tag,
          members: [],
          modelNames: new Set(),
          modifiedCount: 0,
          pendingCount: 0,
          ifcCount: 0,
          deletedCount: 0,
        });
      }
      const system = systems.get(normalized);
      system.members.push(element);
      if (element.modelName) system.modelNames.add(element.modelName);
      if (element.source === 'pending' && element.wasSaved) system.modifiedCount += 1;
      else if (element.source === 'pending') system.pendingCount += 1;
      else system.ifcCount += 1;
    }

    for (const assignment of ctx.tagAssignments.values()) {
      if (assignment.delete !== true) continue;
      const tag = String(assignment.systemTag || '').trim();
      if (!tag) continue;
      const normalized = tag.toLowerCase();
      if (!systems.has(normalized)) {
        systems.set(normalized, {
          tag,
          members: [],
          modelNames: new Set(),
          modifiedCount: 0,
          pendingCount: 0,
          ifcCount: 0,
          deletedCount: 0,
        });
      }
      const system = systems.get(normalized);
      system.deletedCount += 1;
      if (assignment.modelName) system.modelNames.add(assignment.modelName);
    }

    return Array.from(systems.values())
      .map((system) => ({
        ...system,
        count: system.members.length,
        models: Array.from(system.modelNames).sort((a, b) => a.localeCompare(b)),
        status: system.deletedCount && !system.modifiedCount && !system.pendingCount && !system.ifcCount
          ? 'Deleted'
          : system.deletedCount
          ? 'Mixed'
          : system.modifiedCount && !system.pendingCount && !system.ifcCount
          ? 'Modified'
          : (system.pendingCount || system.modifiedCount) && system.ifcCount
          ? 'Mixed'
          : system.pendingCount ? 'Pending'
          : system.modifiedCount ? 'Modified'
          : 'Saved',
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  function parseSequenceNumber(value) {
    const parsed = Number.parseInt(String(value || '').replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sortSystemMembers(members = []) {
    return [...members].sort((a, b) => {
      const aSeq = parseSequenceNumber(a.sequenceNumber);
      const bSeq = parseSequenceNumber(b.sequenceNumber);
      if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq;
      if (aSeq !== null && bSeq === null) return -1;
      if (aSeq === null && bSeq !== null) return 1;
      return Number(a.localId) - Number(b.localId);
    });
  }

  function getSequenceDiagnostics(members = []) {
    if (!members.length) return { tone: '', message: 'Select a system' };
    const sequenceCounts = new Map();
    let missing = 0;
    for (const member of members) {
      const sequence = parseSequenceNumber(member.sequenceNumber);
      if (sequence === null) {
        missing += 1;
        continue;
      }
      sequenceCounts.set(sequence, (sequenceCounts.get(sequence) || 0) + 1);
    }
    const duplicates = Array.from(sequenceCounts.values()).filter((count) => count > 1).length;
    const sequenceValues = Array.from(sequenceCounts.keys()).sort((a, b) => a - b);
    let gaps = 0;
    for (let expected = 1; expected <= sequenceValues.length; expected++) {
      if (!sequenceCounts.has(expected)) gaps += 1;
    }
    if (missing || duplicates || gaps) {
      const parts = [];
      if (missing) parts.push(`${missing} missing`);
      if (duplicates) parts.push(`${duplicates} duplicate`);
      if (gaps) parts.push(`${gaps} gap${gaps === 1 ? '' : 's'}`);
      return { tone: 'warning', message: parts.join(' | ') };
      return { tone: 'warning', message: parts.join(' · ') };
    }
    return { tone: 'success', message: 'Sequence OK' };
  }

  async function highlightSingleTrayComponent(member) {
    const modelEntry = api.findLoadedModelEntry(member.modelId);
    if (!modelEntry) {
      api.updateTagAssignmentUi(`Warning: model for component #${member.localId} is not loaded.`, 'warning');
      return;
    }
    const modelId = modelEntry.model.modelId || modelEntry.model.uuid || member.modelId;
    ctx.highlighter.isProgrammaticSelect = true;
    try {
      const fragmentMap = { [modelId]: new Set([Number(member.localId)]) };
      await ctx.highlighter.highlightByID('select', fragmentMap, true, true);
      ctx.currentSelectionMap = api.cloneModelIdMap(fragmentMap);
      ctx.activeModel = modelEntry.model;
      await api.displayElementProperties(modelEntry.model, member.localId, modelEntry.name);
      ctx.selectedIfcElement = await api.readElementIdentity(modelEntry.model, member.localId, modelEntry.name);
      ctx.routingController.setSelectedElement(modelEntry.model, member.localId);
      api.updateTagAssignmentUi(`Highlighted component "${member.componentId || `#${member.localId}`}".`);
    } catch (error) {
      console.warn('[Tray Systems] Component highlight failed:', error);
      api.updateTagAssignmentUi(`Warning: component #${member.localId} could not be highlighted.`, 'warning');
    } finally {
      ctx.highlighter.isProgrammaticSelect = false;
    }
  }

  async function checkSelectedTraySystemContinuity() {
    if (!ctx.selectedTraySystemTag) return;
    const graph = ctx.routingController.getGraph?.();
    const diagnostics = ctx.routingController.getDiagnostics?.();
    if (!graph || !diagnostics) {
      ctx.traySystemContinuityReport = null;
      renderTraySystemContinuityReport();
      api.updateTagAssignmentUi('Warning: build the routing graph before checking tray-system continuity.', 'warning');
      return;
    }

    const members = findSystemMembers(ctx.selectedTraySystemTag);
    if (!members.length) {
      ctx.traySystemContinuityReport = null;
      renderTraySystemContinuityReport();
      api.updateTagAssignmentUi(`Warning: tray system "${ctx.selectedTraySystemTag}" has no loaded components.`, 'warning');
      return;
    }

    const memberEntries = members.map((member) => ({
      member,
      edgeId: `${member.modelId}:${member.localId}`,
      componentIndex: null,
    }));
    const missingEntries = memberEntries.filter((entry) => !graph.edges.has(entry.edgeId));
    const groupMap = new Map();
    diagnostics.components.forEach((component, index) => {
      for (const entry of memberEntries) {
        if (!component.edgeIds.has(entry.edgeId)) continue;
        entry.componentIndex = index;
        if (!groupMap.has(index)) groupMap.set(index, []);
        groupMap.get(index).push(entry.member);
      }
    });
    const groups = Array.from(groupMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, groupMembers]) => ({
        number: index + 1,
        color: ctx.continuityGroupColors[index % ctx.continuityGroupColors.length],
        members: groupMembers,
        components: groupMembers.map(formatContinuityComponent),
      }));
    const representedCount = memberEntries.length - missingEntries.length;
    const missingComponents = missingEntries.map((entry) => formatContinuityComponent(entry.member));
    const isContinuous = groups.length === 1 && !missingComponents.length;
    const tone = isContinuous ? 'success' : 'warning';
    const statusLabel = groups.length === 1
      ? missingComponents.length ? 'Partial' : 'Continuous'
      : groups.length > 1 ? 'Split' : 'Not represented';

    ctx.traySystemContinuityReport = {
      systemTag: ctx.selectedTraySystemTag,
      statusLabel,
      tone,
      totalComponents: members.length,
      representedComponents: representedCount,
      missingComponents,
      groups,
    };
    renderTraySystemContinuityReport();
    await api.applyContinuityGroupHighlights(groups);

    if (!groups.length) {
      api.updateTagAssignmentUi(
        `Warning: tray system "${ctx.selectedTraySystemTag}" has no components represented in the routing graph.`,
        'warning',
      );
      return;
    }

    const missingSuffix = missingComponents.length
      ? ` ${missingComponents.length} component${missingComponents.length === 1 ? '' : 's'} are not represented in the graph.`
      : '';
    if (groups.length === 1) {
      api.updateTagAssignmentUi(
        `Tray system "${ctx.selectedTraySystemTag}" is graph-continuous across ${representedCount}/${members.length} component${members.length === 1 ? '' : 's'}.${missingSuffix}`,
        missingComponents.length ? 'warning' : 'success',
      );
      return;
    }

    api.updateTagAssignmentUi(
      `Warning: tray system "${ctx.selectedTraySystemTag}" is split across ${groups.length} disconnected graph components.${missingSuffix}`,
      'warning',
    );
  }

  function formatContinuityComponent(member) {
    return member.componentId || `#${member.localId}`;
  }

  function renderTraySystemContinuityReport() {
    if (!dom.traySystemContinuityPanel || !dom.traySystemContinuityStatus || !dom.traySystemContinuityBody) return;
    const report = ctx.traySystemContinuityReport;
    const reportMatchesSelection = report?.systemTag?.toLowerCase() === ctx.selectedTraySystemTag.toLowerCase();
    dom.traySystemContinuityPanel.hidden = !report || !reportMatchesSelection;
    dom.traySystemContinuityBody.innerHTML = '';
    delete dom.traySystemContinuityStatus.dataset.tone;
    if (!report || !reportMatchesSelection) {
      dom.traySystemContinuityStatus.textContent = 'Not checked';
      return;
    }

    dom.traySystemContinuityStatus.textContent = report.statusLabel;
    dom.traySystemContinuityStatus.dataset.tone = report.tone;

    const stats = document.createElement('div');
    stats.className = 'tray-system-continuity-stats';
    const statItems = [
      ['Total', report.totalComponents],
      ['In graph', report.representedComponents],
      ['Missing', report.missingComponents.length],
      ['Groups', report.groups.length],
    ];
    for (const [label, value] of statItems) {
      const item = document.createElement('span');
      item.className = 'tray-system-continuity-stat';
      const valueElement = document.createElement('strong');
      valueElement.textContent = value;
      const labelElement = document.createElement('small');
      labelElement.textContent = label;
      item.append(valueElement, labelElement);
      stats.appendChild(item);
    }
    dom.traySystemContinuityBody.appendChild(stats);

    if (report.groups.length) {
      const groups = document.createElement('div');
      groups.className = 'tray-system-continuity-section';
      const heading = document.createElement('span');
      heading.className = 'tray-system-continuity-section-title';
      heading.textContent = 'Connected graph groups';
      groups.appendChild(heading);
      for (const group of report.groups) {
        const item = document.createElement('div');
        item.className = 'tray-system-continuity-group';
        const chip = document.createElement('span');
        chip.className = 'tray-system-continuity-color';
        chip.style.background = group.color;
        const text = document.createElement('span');
        text.textContent = `Group ${group.number}: ${group.components.join(', ')}`;
        item.append(chip, text);
        groups.appendChild(item);
      }
      dom.traySystemContinuityBody.appendChild(groups);
    }

    if (report.missingComponents.length) {
      const missing = document.createElement('div');
      missing.className = 'tray-system-continuity-section';
      const heading = document.createElement('span');
      heading.className = 'tray-system-continuity-section-title';
      heading.textContent = 'Missing from graph';
      const body = document.createElement('div');
      body.className = 'tray-system-continuity-group warning';
      body.textContent = report.missingComponents.join(', ');
      missing.append(heading, body);
      dom.traySystemContinuityBody.appendChild(missing);
    }
  }

  function renderTraySystemComponents(system) {
    if (!dom.traySystemComponentList || !dom.traySystemSequenceStatus) return;
    dom.traySystemComponentList.innerHTML = '';
    if (!system) {
      dom.traySystemSequenceStatus.textContent = 'Select a system';
      delete dom.traySystemSequenceStatus.dataset.tone;
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'Select a tray system to inspect its components.';
      dom.traySystemComponentList.appendChild(empty);
      return;
    }

    const members = sortSystemMembers(system.members);
    const diagnostics = getSequenceDiagnostics(members);
    dom.traySystemSequenceStatus.textContent = diagnostics.message;
    if (diagnostics.tone) dom.traySystemSequenceStatus.dataset.tone = diagnostics.tone;
    else delete dom.traySystemSequenceStatus.dataset.tone;

    if (!members.length) {
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'This tray system has no components.';
      dom.traySystemComponentList.appendChild(empty);
      return;
    }

    for (const member of members) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tray-system-component-item';
      item.title = 'Click to highlight this component in the viewer.';

      const componentId = document.createElement('span');
      componentId.className = 'tray-system-component-id';
      componentId.textContent = member.componentId || '(missing component ID)';

      const meta = document.createElement('span');
      meta.className = 'tray-system-component-meta';
      meta.textContent = `Seq ${member.sequenceNumber || '-'} · #${member.localId} · ${member.source === 'pending' ? 'Pending' : 'Saved'}`;

      item.append(componentId, meta);
      meta.textContent = `Seq ${member.sequenceNumber || '-'} | #${member.localId} | ${api.getAssignmentSourceLabel(member)}`;
      item.addEventListener('click', () => highlightSingleTrayComponent(member));
      dom.traySystemComponentList.appendChild(item);
    }
  }

  function getPendingTrayDeletions() {
    return Array.from(ctx.tagAssignments.values())
      .filter((assignment) => assignment.delete === true)
      .sort((a, b) =>
        String(a.systemTag || '').localeCompare(String(b.systemTag || '')) ||
        Number(a.localId) - Number(b.localId)
      );
  }

  function restorePendingTrayDeletion(assignment) {
    if (!assignment) return;
    api.invalidateBatchUndo();
    ctx.tagAssignments.delete(getAssignmentKey(assignment.modelId, assignment.localId));
    const model = api.findLoadedModelEntry(assignment.modelId)?.model || ctx.activeModel;
    api.syncProjectTagPropertyGroup(model, assignment.localId);
    api.renderExcelTable();
    api.refreshValidationReportIfOpen();
    api.updateTagAssignmentUi(`Restored saved IFC tag for element #${assignment.localId}.`, 'success');
  }

  function restoreAllPendingTrayDeletions() {
    const deletions = getPendingTrayDeletions();
    if (!deletions.length) return;
    api.invalidateBatchUndo();
    for (const deletion of deletions) {
      ctx.tagAssignments.delete(getAssignmentKey(deletion.modelId, deletion.localId));
      const model = api.findLoadedModelEntry(deletion.modelId)?.model || ctx.activeModel;
      api.syncProjectTagPropertyGroup(model, deletion.localId);
    }
    api.renderExcelTable();
    api.refreshValidationReportIfOpen();
    api.updateTagAssignmentUi(`Restored ${deletions.length} pending deletion${deletions.length === 1 ? '' : 's'}.`, 'success');
  }

  function renderPendingTrayDeletions() {
    if (!dom.traySystemDeletionsPanel || !dom.traySystemDeletionList) return;
    const deletions = getPendingTrayDeletions();
    dom.traySystemDeletionsPanel.hidden = deletions.length === 0;
    dom.traySystemDeletionList.innerHTML = '';
    if (!deletions.length) return;

    for (const deletion of deletions) {
      const item = document.createElement('div');
      item.className = 'tray-system-deletion-item';

      const details = document.createElement('span');
      details.className = 'tray-system-deletion-details';
      details.textContent = `${deletion.systemTag || '(no system)'} | #${deletion.localId} | ${deletion.componentId || 'no component'}`;

      const showButton = document.createElement('button');
      showButton.type = 'button';
      showButton.className = 'tray-system-deletion-action';
      showButton.textContent = 'Show';
      showButton.addEventListener('click', () => highlightSingleTrayComponent(deletion));

      const restoreButton = document.createElement('button');
      restoreButton.type = 'button';
      restoreButton.className = 'tray-system-deletion-action tray-system-deletion-restore';
      restoreButton.textContent = 'Restore';
      restoreButton.addEventListener('click', () => restorePendingTrayDeletion(deletion));

      item.append(details, showButton, restoreButton);
      dom.traySystemDeletionList.appendChild(item);
    }
  }

  function getVisibleTraySystems(systems = []) {
    const normalizedFilter = ctx.traySystemFilterText.trim().toLowerCase();
    const filtered = normalizedFilter
      ? systems.filter((system) =>
          system.tag.toLowerCase().includes(normalizedFilter) ||
          system.models.some((modelName) => modelName.toLowerCase().includes(normalizedFilter)) ||
          system.status.toLowerCase().includes(normalizedFilter)
        )
      : [...systems];

    return filtered.sort((a, b) => {
      if (ctx.traySystemSortMode === 'count-desc') {
        if (b.count !== a.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag);
      }
      if (ctx.traySystemSortMode === 'status') {
        const statusCompare = a.status.localeCompare(b.status);
        return statusCompare || a.tag.localeCompare(b.tag);
      }
      return a.tag.localeCompare(b.tag);
    });
  }

  function createTraySystemBadge(label, state = label) {
    const badge = document.createElement('span');
    badge.className = 'tray-system-badge';
    badge.dataset.state = String(state || label).toLowerCase();
    badge.textContent = label;
    return badge;
  }

  function renderTraySystemManager() {
    if (!dom.traySystemList) return;
    const systems = getTraySystemSummaries();
    const visibleSystems = getVisibleTraySystems(systems);
    const selectedStillExists = systems.some((system) => system.tag.toLowerCase() === ctx.selectedTraySystemTag.toLowerCase());
    if (!selectedStillExists) ctx.selectedTraySystemTag = '';

    if (dom.traySystemManagerSummary) {
      const pendingDeletions = Array.from(ctx.tagAssignments.values()).filter((assignment) => assignment.delete === true).length;
      const filterSuffix = visibleSystems.length !== systems.length
        ? ` | ${visibleSystems.length}/${systems.length} shown`
        : '';
      dom.traySystemManagerSummary.textContent = systems.length
        ? `${systems.length} system${systems.length === 1 ? '' : 's'} loaded${filterSuffix}${pendingDeletions ? ` · ${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}` : ''}.`
        : pendingDeletions
          ? `${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}.`
          : 'No tray systems loaded.';
      const deletionSuffix = pendingDeletions
        ? ` | ${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}`
        : '';
      dom.traySystemManagerSummary.textContent = systems.length
        ? `${systems.length} system${systems.length === 1 ? '' : 's'} loaded${filterSuffix}${deletionSuffix}.`
        : pendingDeletions
          ? `${pendingDeletions} pending deletion${pendingDeletions === 1 ? '' : 's'}.`
          : 'No tray systems loaded.';
    }
    dom.traySystemList.innerHTML = '';

    if (!systems.length) {
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'Assign or load tray-system tags to manage them here.';
      dom.traySystemList.appendChild(empty);
    } else if (!visibleSystems.length) {
      const empty = document.createElement('div');
      empty.className = 'tray-system-empty';
      empty.textContent = 'No tray systems match the current search.';
      dom.traySystemList.appendChild(empty);
    } else {
      for (const system of visibleSystems) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tray-system-item';
        if (system.tag.toLowerCase() === ctx.selectedTraySystemTag.toLowerCase()) button.classList.add('active');
        button.innerHTML = `
          <span class="tray-system-tag">${system.tag}</span>
          <span class="tray-system-meta">
            <span>${system.count} component${system.count === 1 ? '' : 's'}</span>
            <span>${system.status}</span>
          </span>
          <span class="tray-system-state-counts">
            <span>${system.ifcCount} saved · ${system.pendingCount} pending · ${system.modifiedCount} modified</span>
            <span>${system.models.join(', ') || 'Loaded model'}</span>
          </span>
        `;
        button.textContent = '';

        const tag = document.createElement('span');
        tag.className = 'tray-system-tag';
        tag.textContent = system.tag;

        const meta = document.createElement('span');
        meta.className = 'tray-system-meta';

        const count = document.createElement('span');
        count.textContent = `${system.count} component${system.count === 1 ? '' : 's'}`;
        meta.append(count, createTraySystemBadge(system.status));

        const stateCounts = document.createElement('span');
        stateCounts.className = 'tray-system-state-counts';
        stateCounts.append(
          createTraySystemBadge(`${system.ifcCount} saved`, 'saved'),
          createTraySystemBadge(`${system.pendingCount} pending`, 'pending'),
          createTraySystemBadge(`${system.modifiedCount} modified`, 'modified'),
        );
        if (system.deletedCount) {
          stateCounts.append(createTraySystemBadge(`${system.deletedCount} deleted`, 'deleted'));
        }

        const models = document.createElement('span');
        models.className = 'tray-system-models';
        models.textContent = system.models.join(', ') || 'Loaded model';

        button.append(tag, meta, stateCounts, models);

        button.addEventListener('click', () => {
          ctx.selectedTraySystemTag = system.tag;
          dom.systemTagInput.value = system.tag;
          api.updateTagAssignmentUi(`Selected tray system "${system.tag}".`);
        });
        dom.traySystemList.appendChild(button);
      }
    }

    const selectedSystem = systems.find((system) => system.tag.toLowerCase() === ctx.selectedTraySystemTag.toLowerCase()) || null;
    renderTraySystemComponents(selectedSystem);
    renderTraySystemContinuityReport();
    renderPendingTrayDeletions();

    const hasSelectedSystem = Boolean(selectedSystem);
    const selectedElementCount = api.countModelIdMapItems(api.getSelectedModelIdMap());
    if (dom.btnManagerHighlight) dom.btnManagerHighlight.disabled = !hasSelectedSystem;
    if (dom.btnManagerIsolate) dom.btnManagerIsolate.disabled = !hasSelectedSystem;
    if (dom.btnManagerAddSelection) dom.btnManagerAddSelection.disabled = !hasSelectedSystem || selectedElementCount === 0;
    if (dom.btnManagerRemoveSelection) dom.btnManagerRemoveSelection.disabled = !hasSelectedSystem || selectedElementCount === 0;
    if (dom.btnManagerCheckContinuity) dom.btnManagerCheckContinuity.disabled = !hasSelectedSystem;
    if (dom.btnManagerRegenerateSequence) dom.btnManagerRegenerateSequence.disabled = !hasSelectedSystem;
    if (dom.btnManagerRename) {
      dom.btnManagerRename.disabled = !hasSelectedSystem ||
        !api.getEnteredSystemTag() ||
        api.getEnteredSystemTag().toLowerCase() === ctx.selectedTraySystemTag.toLowerCase();
    }
    api.refreshTaggedTrayHighlights();
  }

  async function regenerateSelectedSystemSequence() {
    if (!ctx.selectedTraySystemTag) return false;
    const members = sortSystemMembers(findSystemMembers(ctx.selectedTraySystemTag));
    if (!members.length) {
      api.updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${ctx.selectedTraySystemTag}".`, 'warning');
      return false;
    }
    api.invalidateBatchUndo();

    let sequenceIndex = 1;
    const sequenceByType = new Map();
    for (const member of members) {
      const modelEntry = api.findLoadedModelEntry(member.modelId);
      if (!modelEntry) continue;
      const identity = await api.readElementIdentity(modelEntry.model, member.localId, modelEntry.name);
      const usesPatternV2 = Boolean(member.typeCode);
      const typeSequence = usesPatternV2 ? (sequenceByType.get(member.typeCode) || 1) : sequenceIndex++;
      if (usesPatternV2) sequenceByType.set(member.typeCode, typeSequence + 1);
      const sequenceDigits = usesPatternV2
        ? Math.max(2, String(member.sequenceNumber || '').length)
        : 3;
      const sequenceNumber = String(typeSequence).padStart(sequenceDigits, '0');
      const componentId = usesPatternV2
        ? `${ctx.selectedTraySystemTag}.${member.typeCode}.${sequenceNumber}`
        : `${ctx.selectedTraySystemTag}-C${sequenceNumber}`;
      ctx.tagAssignments.set(getAssignmentKey(member.modelId, member.localId), {
        ...identity,
        systemTag: ctx.selectedTraySystemTag,
        elementTag: componentId,
        componentId,
        elementKind: member.elementKind || '',
        typeCode: member.typeCode || '',
        sequenceNumber,
        schemeVersion: member.schemeVersion || (usesPatternV2 ? '2' : ''),
        originalIfcTag: member.originalIfcTag || identity.ifcTag || '',
        classificationMethod: member.classificationMethod || '',
        classificationConfidence: member.classificationConfidence ?? '',
        excelRowIndex: member.excelRowIndex ?? ctx.selectedExcelRowIndex,
      });
      if (ctx.selectedIfcElement?.modelId === member.modelId && Number(ctx.selectedIfcElement.localId) === Number(member.localId)) {
        api.syncProjectTagPropertyGroup(modelEntry.model, member.localId);
      }
    }

    api.renderExcelTable();
    api.refreshValidationReportIfOpen();
    api.updateTagAssignmentUi(
      `Regenerated ${members.length} element tag${members.length === 1 ? '' : 's'} for tray system "${ctx.selectedTraySystemTag}".`,
      'success',
    );
    return true;
  }

  function wireManagerControls() {
    dom.traySystemFilter?.addEventListener('input', () => {
      ctx.traySystemFilterText = dom.traySystemFilter.value;
      renderTraySystemManager();
    });

    dom.traySystemSort?.addEventListener('change', () => {
      ctx.traySystemSortMode = dom.traySystemSort.value || 'tag';
      renderTraySystemManager();
    });

    dom.btnRefreshTraySystems?.addEventListener('click', () => {
      renderTraySystemManager();
      api.updateTagAssignmentUi('Tray System Manager refreshed.');
    });

    dom.btnRestoreAllDeletions?.addEventListener('click', () => {
      restoreAllPendingTrayDeletions();
    });

    dom.btnManagerCheckContinuity?.addEventListener('click', async () => {
      await checkSelectedTraySystemContinuity();
    });

    dom.btnClearContinuityColors?.addEventListener('click', async () => {
      await api.clearContinuityGroupHighlights();
      api.updateTagAssignmentUi('Continuity group colors cleared.');
    });

    dom.btnManagerHighlight?.addEventListener('click', async () => {
      if (!ctx.selectedTraySystemTag) return;
      const members = findSystemMembers(ctx.selectedTraySystemTag);
      if (!members.length) {
        api.updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${ctx.selectedTraySystemTag}".`, 'warning');
        return;
      }
      await api.highlightTrayMembers(
        members,
        `Highlighted ${members.length} components for tray system "${ctx.selectedTraySystemTag}".`,
      );
    });

    dom.btnManagerIsolate?.addEventListener('click', async () => {
      if (!ctx.selectedTraySystemTag) return;
      const members = findSystemMembers(ctx.selectedTraySystemTag);
      if (!members.length) {
        api.updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${ctx.selectedTraySystemTag}".`, 'warning');
        return;
      }
      await api.isolateTrayMembers(
        members,
        `Isolated ${members.length} components for tray system "${ctx.selectedTraySystemTag}".`,
      );
    });

    dom.btnManagerAddSelection?.addEventListener('click', async () => {
      if (!ctx.selectedTraySystemTag) return;
      const selectedElements = await api.getCurrentSelectionElements();
      if (!selectedElements.length) {
        api.updateTagAssignmentUi('Warning: select one or more IFC elements before adding to a tray system.', 'warning');
        return;
      }
      await api.assignElementsToSystem(ctx.selectedTraySystemTag, selectedElements, {
        message: `Added ${selectedElements.length} selected element${selectedElements.length === 1 ? '' : 's'} to tray system "${ctx.selectedTraySystemTag}".`,
      });
    });

    dom.btnManagerRemoveSelection?.addEventListener('click', async () => {
      if (!ctx.selectedTraySystemTag) return;
      const selectedElements = await api.getCurrentSelectionElements();
      if (!selectedElements.length) {
        api.updateTagAssignmentUi('Warning: select one or more IFC elements before removing from a tray system.', 'warning');
        return;
      }
      api.invalidateBatchUndo();

      let removed = 0;
      let markedDeleted = 0;
      for (const element of selectedElements) {
        const key = getAssignmentKey(element.modelId, element.localId);
        const pending = ctx.tagAssignments.get(key);
        if (pending?.systemTag?.toLowerCase() === ctx.selectedTraySystemTag.toLowerCase()) {
          ctx.tagAssignments.delete(key);
          api.syncProjectTagPropertyGroup(api.findLoadedModelEntry(element.modelId)?.model || ctx.activeModel, element.localId);
          removed += 1;
        } else if (api.getExistingProjectTag(element).toLowerCase() === ctx.selectedTraySystemTag.toLowerCase()) {
          const existing = api.getExistingTrayAssignment(element);
          ctx.tagAssignments.set(key, {
            ...element,
            systemTag: existing?.systemTag || ctx.selectedTraySystemTag,
            componentId: existing?.componentId || '',
            sequenceNumber: existing?.sequenceNumber || '',
            delete: true,
            wasSaved: true,
            excelRowIndex: ctx.selectedExcelRowIndex,
          });
          api.syncProjectTagPropertyGroup(api.findLoadedModelEntry(element.modelId)?.model || ctx.activeModel, element.localId);
          markedDeleted += 1;
        }
      }

      api.renderExcelTable();
      api.refreshValidationReportIfOpen();
      api.updateTagAssignmentUi(
        removed || markedDeleted
          ? `Removed ${removed + markedDeleted} element${removed + markedDeleted === 1 ? '' : 's'} from "${ctx.selectedTraySystemTag}"${markedDeleted ? `; ${markedDeleted} saved IFC tag${markedDeleted === 1 ? '' : 's'} marked for export deletion` : ''}.`
          : `No selected pending elements belonged to "${ctx.selectedTraySystemTag}".`,
        removed || markedDeleted ? 'success' : 'warning',
      );
    });

    dom.btnManagerRegenerateSequence?.addEventListener('click', async () => {
      await regenerateSelectedSystemSequence();
    });

    dom.btnManagerRename?.addEventListener('click', async () => {
      const oldTag = ctx.selectedTraySystemTag;
      const newTag = api.getEnteredSystemTag();
      if (!oldTag || !newTag || oldTag.toLowerCase() === newTag.toLowerCase()) return;
      api.invalidateBatchUndo();

      const members = findSystemMembers(oldTag);
      if (!members.length) {
        api.updateTagAssignmentUi(`Warning: no loaded components belong to tray system "${oldTag}".`, 'warning');
        return;
      }

      for (const member of members) {
        const modelEntry = api.findLoadedModelEntry(member.modelId);
        if (!modelEntry) continue;
        const identity = await api.readElementIdentity(modelEntry.model, member.localId, modelEntry.name);
        const sequenceNumber = member.sequenceNumber || '001';
        const componentId = member.typeCode
          ? `${newTag}.${member.typeCode}.${sequenceNumber}`
          : `${newTag}-C${sequenceNumber}`;
        ctx.tagAssignments.set(getAssignmentKey(member.modelId, member.localId), {
          ...identity,
          systemTag: newTag,
          elementTag: componentId,
          componentId,
          elementKind: member.elementKind || '',
          typeCode: member.typeCode || '',
          sequenceNumber,
          schemeVersion: member.schemeVersion || (member.typeCode ? '2' : ''),
          originalIfcTag: member.originalIfcTag || identity.ifcTag || '',
          classificationMethod: member.classificationMethod || '',
          classificationConfidence: member.classificationConfidence ?? '',
          excelRowIndex: member.excelRowIndex ?? ctx.selectedExcelRowIndex,
        });
        if (ctx.selectedIfcElement?.modelId === member.modelId && Number(ctx.selectedIfcElement.localId) === Number(member.localId)) {
          api.syncProjectTagPropertyGroup(modelEntry.model, member.localId);
        }
      }

      ctx.selectedTraySystemTag = newTag;
      api.renderExcelTable();
      api.refreshValidationReportIfOpen();
      api.updateTagAssignmentUi(`Renamed tray system "${oldTag}" to "${newTag}" for ${members.length} component${members.length === 1 ? '' : 's'}.`, 'success');
    });
  }

  api.findSystemMembers = findSystemMembers;
  api.getTraySystemSummaries = getTraySystemSummaries;
  api.renderTraySystemManager = renderTraySystemManager;
  api.renderTraySystemContinuityReport = renderTraySystemContinuityReport;
  api.checkSelectedTraySystemContinuity = checkSelectedTraySystemContinuity;
  api.regenerateSelectedSystemSequence = regenerateSelectedSystemSequence;

  return {
    findSystemMembers,
    getTraySystemSummaries,
    renderTraySystemManager,
    checkSelectedTraySystemContinuity,
    regenerateSelectedSystemSequence,
    wireManagerControls,
  };
}
