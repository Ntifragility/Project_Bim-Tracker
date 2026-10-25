// IFC element properties inspector for the tray viewer.
//
// Renders the identity header, property sets and quantities of the selected
// element(s), plus the `CCP_TRAY_SYSTEM` tag group synced from the
// assignment state. Extracted verbatim from `src/main.js` (behaviour
// unchanged per R1); assignment lookups arrive via the shared `api` object
// so this module never imports the tagging panel.

import { IFC_TYPE_MAP, getModernIfcTypeName, IFCELEMENTQUANTITY, IFCRELDEFINESBYPROPERTIES } from './ifc-types.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API populated by feature modules:
 *   getAssignmentForElement(element)
 */
export function initPropertiesPanel(ctx, dom, api) {
  // Format a property value for display
  function formatPropValue(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(3);
    }
    if (value === '.T.') return 'Yes';
    if (value === '.F.') return 'No';
    if (value === '.U.') return 'Unknown';
    return String(value);
  }

  // Render a single property set group (collapsible <details>)
  function renderPsetGroup(name, entries, isQuantity = false) {
    const entryKeys = Object.keys(entries);
    if (entryKeys.length === 0) return;

    const normalizedName = name.trim().toUpperCase();
    if (normalizedName === 'CCP_TRAY_SYSTEM') {
      dom.propPsetsContainer.querySelector(`[data-pset-name="${normalizedName}"]`)?.remove();
    }

    const details = document.createElement('details');
    details.className = `pset-group${isQuantity ? ' quantity-group' : ''}`;
    details.dataset.psetName = normalizedName;

    const summary = document.createElement('summary');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    const countSpan = document.createElement('span');
    countSpan.className = 'pset-count';
    countSpan.textContent = `${entryKeys.length}`;
    summary.appendChild(nameSpan);
    summary.appendChild(countSpan);

    const propsDiv = document.createElement('div');
    propsDiv.className = 'pset-properties';

    for (const [key, value] of Object.entries(entries)) {
      const row = document.createElement('div');
      row.className = 'prop-row';
      if (!isQuantity && normalizedName !== 'IFC ATTRIBUTES') {
        row.dataset.editableProperty = 'true';
        row.tabIndex = 0;
        row.title = 'Select this property for safe editing';
        const selectForEditing = () => {
          dom.ifcEditPset.value = name;
          dom.ifcEditProperty.value = key;
          dom.ifcEditValue.value = value === null || value === undefined ? '' : String(value);
          dom.ifcEditValue.focus();
          dom.ifcEditValue.select();
          dom.ifcEditStatus.textContent = `Editing ${name}.${key} on element #${ctx.selectedIfcElement?.localId || '-'}.`;
        };
        row.addEventListener('click', selectForEditing);
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectForEditing();
          }
        });
      }
      const label = document.createElement('span');
      label.className = 'prop-label';
      label.textContent = key;
      const val = document.createElement('span');
      val.className = 'prop-value';
      const displayVal = formatPropValue(value);
      val.textContent = displayVal;
      val.title = displayVal;
      row.appendChild(label);
      row.appendChild(val);
      propsDiv.appendChild(row);
    }

    details.appendChild(summary);
    details.appendChild(propsDiv);
    if (normalizedName === 'CCP_TRAY_SYSTEM') {
      dom.propPsetsContainer.insertBefore(details, dom.propPsetsContainer.firstChild);
    } else {
      dom.propPsetsContainer.appendChild(details);
    }
  }

  function syncProjectTagPropertyGroup(model, localId) {
    if (!model || !localId) return;
    const element = { modelId: model.modelId || model.uuid, localId: Number(localId) };
    const assignment = api.getAssignmentForElement(element);
    const existing = ctx.loadedModels.find((entry) =>
      entry.model.modelId === element.modelId || entry.model.uuid === element.modelId
    )?.existingProjectTags?.get(element.localId);
    if (assignment?.delete === true) {
      dom.propPsetsContainer.querySelector('[data-pset-name="CCP_TRAY_SYSTEM"]')?.remove();
      if (ctx.selectedIfcElement?.modelId === element.modelId && Number(ctx.selectedIfcElement.localId) === Number(element.localId)) {
        dom.propTag.textContent = '-';
        dom.propTag.title = '-';
      }
      return;
    }
    const systemTag = assignment?.systemTag || existing?.systemTag || '';
    const componentId = assignment?.componentId || existing?.componentId || '';
    const sequenceNumber = assignment?.sequenceNumber || existing?.sequenceNumber || '';
    const elementTag = assignment?.elementTag || existing?.elementTag || componentId;
    const elementKind = assignment?.elementKind || existing?.elementKind || '';
    const typeCode = assignment?.typeCode || existing?.typeCode || '';

    if (!systemTag) {
      dom.propPsetsContainer.querySelector('[data-pset-name="CCP_TRAY_SYSTEM"]')?.remove();
      return;
    }
    renderPsetGroup('CCP_TRAY_SYSTEM', {
      SystemTag: systemTag,
      ElementTag: elementTag,
      ComponentId: componentId,
      ElementKind: elementKind,
      TypeCode: typeCode,
      SequenceNumber: sequenceNumber,
    });
  }

  // Extract property set entries from an IfcPropertySet or IfcElementQuantity
  async function extractPsetEntries(model, psetProps) {
    const entries = {};

    // IfcPropertySet → HasProperties
    if (psetProps.HasProperties) {
      for (const propRef of psetProps.HasProperties) {
        const propId = propRef.value ?? propRef;
        try {
          const sp = await model.getProperties(propId);
          if (sp && sp.Name) {
            const name = sp.Name.value ?? sp.Name;
            let value = '-';
            if (sp.NominalValue !== undefined && sp.NominalValue !== null) {
              value = sp.NominalValue.value ?? sp.NominalValue;
            }
            entries[name] = value;
          }
        } catch (_) { /* skip */ }
      }
    }

    // IfcElementQuantity → Quantities
    if (psetProps.Quantities) {
      for (const qRef of psetProps.Quantities) {
        const qId = qRef.value ?? qRef;
        try {
          const qp = await model.getProperties(qId);
          if (qp && qp.Name) {
            const name = qp.Name.value ?? qp.Name;
            let value = qp.LengthValue?.value ??
                        qp.AreaValue?.value ??
                        qp.VolumeValue?.value ??
                        qp.CountValue?.value ??
                        qp.WeightValue?.value ??
                        qp.TimeValue?.value ?? '-';
            if (typeof value === 'number') value = Math.round(value * 1000) / 1000;
            entries[name] = value;
          }
        } catch (_) { /* skip */ }
      }
    }

    return entries;
  }

  // Strategy 1: Use IfcRelationsIndexer (fast, indexed lookup)
  async function displayPsetsViaIndexer(model, expressId) {
    if (!ctx.indexer) return false;
    try {
      const rels = ctx.indexer.getEntityRelations(model, expressId, 'IsDefinedBy');
      if (!rels || rels.length === 0) return false;

      for (const relExpressId of rels) {
        const psetProps = await model.getProperties(relExpressId);
        if (!psetProps) continue;
        const psetName = psetProps.Name?.value || `PropertySet (${relExpressId})`;
        const isQuantity = psetProps.type === IFCELEMENTQUANTITY;
        const entries = await extractPsetEntries(model, psetProps);
        renderPsetGroup(psetName, entries, isQuantity);
      }
      return true;
    } catch (e) {
      console.warn('[Props] Indexer lookup failed:', e);
      return false;
    }
  }

  // Strategy 2: Manual traversal of IfcRelDefinesByProperties (fallback)
  async function displayPsetsManual(model, expressId) {
    try {
      const allRels = await model.getAllPropertiesOfType(IFCRELDEFINESBYPROPERTIES);
      if (!allRels) return;

      for (const relId in allRels) {
        const rel = allRels[relId];
        if (!rel || !rel.RelatedObjects) continue;

        const relatedIds = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [rel.RelatedObjects];
        const isRelated = relatedIds.some((obj) => Number(obj.value ?? obj) === Number(expressId));
        if (!isRelated) continue;

        const psetRef = rel.RelatingPropertyDefinition;
        if (!psetRef) continue;

        const psetId = psetRef.value ?? psetRef;
        const psetProps = await model.getProperties(psetId);
        if (!psetProps) continue;

        const psetName = psetProps.Name?.value || `PropertySet (${psetId})`;
        const isQuantity = psetProps.type === IFCELEMENTQUANTITY;
        const entries = await extractPsetEntries(model, psetProps);
        renderPsetGroup(psetName, entries, isQuantity);
      }
    } catch (e) {
      console.warn('[Props] Manual pset retrieval failed:', e);
    }
  }

  function unwrapItemValue(attribute) {
    if (attribute && typeof attribute === 'object' && !Array.isArray(attribute) && 'value' in attribute) {
      return attribute.value;
    }
    return attribute;
  }

  async function displayElementPropertiesModern(model, localId, modelName) {
    const results = await model.getItemsData([localId], {
      attributesDefault: true,
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        DefinesOccurrence: { attributes: true, relations: true },
      },
      relationsDefault: { attributes: false, relations: false },
    });
    const itemData = results?.[0];
    if (!itemData) throw new Error(`No IFC data found for local ID ${localId}.`);

    const name = unwrapItemValue(itemData.Name);
    const globalId = unwrapItemValue(itemData.GlobalId ?? itemData._guid);
    const tag = unwrapItemValue(itemData.Tag);

    dom.propTypeBadge.textContent = getModernIfcTypeName(itemData);
    dom.propName.textContent = formatPropValue(name);
    dom.propName.title = formatPropValue(name);
    dom.propGlobalId.textContent = formatPropValue(globalId);
    dom.propGlobalId.title = formatPropValue(globalId);
    dom.propTag.textContent = formatPropValue(tag);
    dom.propTag.title = formatPropValue(tag);
    dom.propExpressId.textContent = localId;
    dom.propModel.textContent = modelName || '-';
    dom.propModel.title = modelName || '';

    dom.propPsetsContainer.innerHTML = '';

    const attributes = {};
    const relationNames = new Set(['IsDefinedBy', 'DefinesOccurrence']);
    for (const [key, rawValue] of Object.entries(itemData)) {
      if (key.startsWith('_') || relationNames.has(key) || Array.isArray(rawValue)) continue;
      const value = unwrapItemValue(rawValue);
      if (value === undefined || value === null || typeof value === 'object') continue;
      if (['Name', 'GlobalId', 'Tag'].includes(key)) continue;
      attributes[key] = value;
    }
    renderPsetGroup('IFC Attributes', attributes);

    const groups = new Map();
    collectModernPropertySets(itemData, groups);
    groups.forEach(({ name: groupName, entries, isQuantity }) => {
      renderPsetGroup(groupName, entries, isQuantity);
    });
    syncProjectTagPropertyGroup(model, localId);
  }

  function collectModernPropertySets(value, groups, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => collectModernPropertySets(item, groups, visited));
      return;
    }

    const properties = Array.isArray(value.HasProperties) ? value.HasProperties : null;
    const quantities = Array.isArray(value.Quantities) ? value.Quantities : null;
    const members = properties || quantities;

    if (members) {
      const groupName = formatPropValue(unwrapItemValue(value.Name) || (quantities ? 'Quantities' : 'Property Set'));
      const groupKey = `${quantities ? 'quantity' : 'property'}:${groupName}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { name: groupName, entries: {}, isQuantity: Boolean(quantities) });
      }
      const group = groups.get(groupKey);

      for (const member of members) {
        if (!member || typeof member !== 'object') continue;
        const propertyName = unwrapItemValue(member.Name);
        if (!propertyName) continue;

        const propertyValue = unwrapItemValue(
          member.NominalValue ??
          member.LengthValue ??
          member.AreaValue ??
          member.VolumeValue ??
          member.CountValue ??
          member.WeightValue ??
          member.TimeValue ??
          member.Description
        );
        group.entries[propertyName] = propertyValue ?? '-';
      }
    }

    for (const nested of Object.values(value)) {
      collectModernPropertySets(nested, groups, visited);
    }
  }

  // Main display function: show full element properties panel
  async function displayElementProperties(model, expressId, modelName) {
    // Activate panel, show loading
    dom.elementPropsPanel.classList.remove('empty');
    dom.elementPropsPanel.classList.add('active');
    dom.elementPropsPanel.querySelector('.element-props-placeholder').style.display = 'none';
    dom.elementPropsPanel.querySelector('.element-props-content').style.display = 'flex';
    dom.propPsetsContainer.innerHTML = '<div class="props-loading"><div class="props-loading-spinner"></div>Loading properties…</div>';

    try {
      if (typeof model.getItemsData === 'function') {
        try {
          await displayElementPropertiesModern(model, expressId, modelName);
          if (dom.propPsetsContainer.children.length === 0) {
            dom.propPsetsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px 0; text-align: center;">No additional properties found for this element.</div>';
          }
          return;
        } catch (modernErr) {
          console.warn('[Element Properties] displayElementPropertiesModern failed, falling back to getProperties:', modernErr);
        }
      }

      const props = await model.getProperties(expressId);

      // Identity fields
      const typeName = (props && IFC_TYPE_MAP[props.type]) || (props ? `IFC Type ${props.type}` : 'Unknown');
      dom.propTypeBadge.textContent = typeName;
      dom.propName.textContent = props?.Name?.value ?? '-';
      dom.propName.title = props?.Name?.value ?? '';
      dom.propGlobalId.textContent = props?.GlobalId?.value ?? '-';
      dom.propGlobalId.title = props?.GlobalId?.value ?? '';
      dom.propTag.textContent = props?.Tag?.value ?? '-';
      dom.propTag.title = props?.Tag?.value ?? '';
      dom.propExpressId.textContent = expressId;
      dom.propModel.textContent = modelName || '-';
      dom.propModel.title = modelName || '';

      // Property sets — try indexed first, fall back to manual
      dom.propPsetsContainer.innerHTML = '';
      const foundViaIndexer = await displayPsetsViaIndexer(model, expressId);
      if (!foundViaIndexer) {
        await displayPsetsManual(model, expressId);
      }
      syncProjectTagPropertyGroup(model, expressId);

      // If no psets found at all, show a note
      if (dom.propPsetsContainer.children.length === 0) {
        dom.propPsetsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px 0; text-align: center;">No property sets found for this element.</div>';
      }
    } catch (err) {
      console.warn('[Element Properties] Failed:', err);
      dom.propPsetsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px 0; text-align: center;">Could not load properties.</div>';
    }
  }

  function renderMultiSelectHeader() {
    if (!dom.multiSelectHeader) return;
    const count = ctx.multiSelectionElements.length;
    if (count < 2) {
      dom.multiSelectHeader.style.display = 'none';
      return;
    }
    dom.multiSelectHeader.style.display = 'flex';
    dom.multiSelectBadge.textContent = `${count} Elements Selected`;

    const typeCounts = new Map();
    ctx.multiSelectionElements.forEach((e) => {
      const type = e.type || 'IfcElement';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });
    const breakdownParts = Array.from(typeCounts.entries()).map(([type, c]) => `${c}× ${type}`);
    dom.multiSelectTypeBreakdown.textContent = breakdownParts.join(' · ');

    const isCombined = ctx.multiSelectionIndex === -1;
    dom.btnMultiCombined.classList.toggle('active', isCombined);

    if (isCombined) {
      dom.multiSelectIndex.textContent = `All ${count}`;
      dom.btnMultiPrev.disabled = true;
      dom.btnMultiNext.disabled = true;
    } else {
      dom.multiSelectIndex.textContent = `${ctx.multiSelectionIndex + 1} of ${count}`;
      dom.btnMultiPrev.disabled = ctx.multiSelectionIndex <= 0;
      dom.btnMultiNext.disabled = ctx.multiSelectionIndex >= count - 1;
    }
  }

  async function displayCombinedProperties(elements) {
    if (!elements || elements.length === 0) return;

    dom.elementPropsPanel.classList.remove('empty');
    dom.elementPropsPanel.classList.add('active');
    dom.elementPropsPanel.querySelector('.element-props-placeholder').style.display = 'none';
    dom.elementPropsPanel.querySelector('.element-props-content').style.display = 'flex';
    dom.propPsetsContainer.innerHTML = '<div class="props-loading"><div class="props-loading-spinner"></div>Aggregating properties across elements…</div>';

    renderMultiSelectHeader();

    const types = new Set(elements.map((e) => e.type).filter(Boolean));
    const names = new Set(elements.map((e) => e.name).filter(Boolean));
    const tags = new Set(elements.map((e) => e.ifcTag).filter(Boolean));
    const models = new Set(elements.map((e) => e.modelName).filter(Boolean));

    const typeText = types.size === 1 ? Array.from(types)[0] : `Multiple Types (${types.size})`;
    const nameText = names.size === 1 ? Array.from(names)[0] : '<Varies>';
    const tagText = tags.size === 1 ? (Array.from(tags)[0] || '-') : (tags.size === 0 ? '-' : '<Varies>');
    const modelText = models.size === 1 ? Array.from(models)[0] : `<Varies> (${models.size} models)`;

    dom.propTypeBadge.textContent = typeText;

    dom.propName.textContent = nameText;
    dom.propName.title = names.size === 1 ? nameText : Array.from(names).join(', ');
    if (names.size !== 1) dom.propName.classList.add('prop-value-varies'); else dom.propName.classList.remove('prop-value-varies');

    dom.propGlobalId.textContent = '<Varies>';
    dom.propGlobalId.title = 'GlobalId is unique per element';
    dom.propGlobalId.classList.add('prop-value-varies');

    dom.propTag.textContent = tagText;
    dom.propTag.title = tags.size === 1 ? tagText : Array.from(tags).join(', ');
    if (tags.size > 1) dom.propTag.classList.add('prop-value-varies'); else dom.propTag.classList.remove('prop-value-varies');

    dom.propExpressId.textContent = '<Varies>';
    dom.propExpressId.title = 'Express ID is unique per element';
    dom.propExpressId.classList.add('prop-value-varies');

    dom.propModel.textContent = modelText;
    dom.propModel.title = models.size === 1 ? modelText : Array.from(models).join(', ');
    if (models.size !== 1) dom.propModel.classList.add('prop-value-varies'); else dom.propModel.classList.remove('prop-value-varies');

    const cappedElements = elements.slice(0, 50);
    const elementPsetsList = [];

    for (const elem of cappedElements) {
      const modelEntry = ctx.loadedModels.find((m) =>
        m.model?.modelId === elem.modelId ||
        m.model?.uuid === elem.modelId ||
        m.uuid === elem.modelId
      );
      if (!modelEntry || !modelEntry.model || typeof modelEntry.model.getItemsData !== 'function') continue;

      try {
        const itemData = (await modelEntry.model.getItemsData([elem.localId], {
          attributesDefault: true,
          relations: {
            IsDefinedBy: { attributes: true, relations: true },
            DefinesOccurrence: { attributes: true, relations: true },
          },
        }))?.[0];

        if (itemData) {
          // Verbatim legacy quirk (see spec open questions): the combined
          // view calls the collector with a single argument, so `groups`
          // is undefined here exactly as in `src/main.js` before the split.
          // The per-element try/catch below preserves the legacy outcome
          // (warn + skip) instead of failing the whole panel render.
          const psets = collectModernPropertySets(itemData);
          elementPsetsList.push(psets);
        }
      } catch (err) {
        console.warn(`[Combined Properties] Could not fetch psets for element #${elem.localId}:`, err);
      }
    }

    dom.propPsetsContainer.innerHTML = '';

    if (elements.length > 50) {
      const capNote = document.createElement('div');
      capNote.style.cssText = 'color: #fcd34d; font-size: 0.72rem; padding: 6px 0; font-style: italic; text-align: center;';
      capNote.textContent = `Property set comparison capped at first 50 elements (${elements.length} selected).`;
      dom.propPsetsContainer.appendChild(capNote);
    }

    if (!elementPsetsList.length) {
      const note = document.createElement('div');
      note.style.cssText = 'color: var(--text-muted); font-size: 0.8rem; padding: 8px 0; text-align: center;';
      note.textContent = 'No property sets found for the selected elements.';
      dom.propPsetsContainer.appendChild(note);
      return;
    }

    const psetMap = new Map();

    elementPsetsList.forEach((psets) => {
      for (const [psetName, props] of Object.entries(psets)) {
        if (!psetMap.has(psetName)) psetMap.set(psetName, { elementCount: 0, propMap: new Map() });
        const psetData = psetMap.get(psetName);
        psetData.elementCount += 1;

        for (const [propKey, propVal] of Object.entries(props)) {
          if (!psetData.propMap.has(propKey)) psetData.propMap.set(propKey, []);
          psetData.propMap.get(propKey).push(propVal);
        }
      }
    });

    const totalSampled = elementPsetsList.length;

    for (const [psetName, psetData] of psetMap) {
      const details = document.createElement('details');
      details.className = 'pset-group';
      details.open = true;

      const summary = document.createElement('summary');
      const titleSpan = document.createElement('span');
      titleSpan.textContent = psetName;
      summary.appendChild(titleSpan);

      if (psetData.elementCount < totalSampled) {
        const note = document.createElement('span');
        note.className = 'pset-partial-note';
        note.textContent = `(${psetData.elementCount}/${totalSampled} elements)`;
        summary.appendChild(note);
      }

      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'pset-content';

      for (const [propKey, values] of psetData.propMap) {
        const row = document.createElement('div');
        row.className = 'prop-row';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'prop-label';
        labelSpan.textContent = propKey;

        const valSpan = document.createElement('span');
        valSpan.className = 'prop-value';

        const distinctValues = new Set(values.map((v) => String(v ?? '')));

        if (values.length < psetData.elementCount || distinctValues.size > 1) {
          valSpan.textContent = '<Varies>';
          valSpan.classList.add('prop-value-varies');
          valSpan.title = `${distinctValues.size} distinct value(s): ${Array.from(distinctValues).slice(0, 5).join(', ')}`;
        } else {
          valSpan.textContent = values[0] ?? '-';
          valSpan.title = String(values[0] ?? '');
        }

        row.append(labelSpan, valSpan);
        content.appendChild(row);
      }

      details.appendChild(content);
      dom.propPsetsContainer.appendChild(details);
    }
  }

  // Clear the element properties panel back to placeholder state
  function clearElementProperties() {
    ctx.multiSelectionElements = [];
    ctx.multiSelectionIndex = -1;
    if (dom.multiSelectHeader) dom.multiSelectHeader.style.display = 'none';
    dom.elementPropsPanel.classList.add('empty');
    dom.elementPropsPanel.classList.remove('active');
    dom.elementPropsPanel.querySelector('.element-props-placeholder').style.display = 'flex';
    dom.elementPropsPanel.querySelector('.element-props-content').style.display = 'none';
    dom.propPsetsContainer.innerHTML = '';
  }

  api.displayElementProperties = displayElementProperties;
  api.displayCombinedProperties = displayCombinedProperties;
  api.clearElementProperties = clearElementProperties;
  api.renderMultiSelectHeader = renderMultiSelectHeader;
  api.renderPsetGroup = renderPsetGroup;
  api.syncProjectTagPropertyGroup = syncProjectTagPropertyGroup;
  api.formatPropValue = formatPropValue;
  api.collectModernPropertySets = collectModernPropertySets;

  return {
    displayElementProperties,
    displayCombinedProperties,
    clearElementProperties,
    renderPsetGroup,
    syncProjectTagPropertyGroup,
    formatPropValue,
  };
}
