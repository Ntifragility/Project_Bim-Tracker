import { createIfcGuid } from '../ifc-tag-exporter.js';
import {
  decodeIfc,
  escapeStepString,
  findDataTerminator,
  nextEntityId,
  replaceEntity,
} from './step-utils.js';
import { CUSTOM_PROPERTY_SET_PATTERN, parsePropertyModel } from './property-model.js';
import { formatTypedValue, rgbFromHex } from './typed-value.js';
import { shapeItemsForElement, updateExistingStyles } from './style-chain.js';

export function editedIfcFileName(sourceName) {
  const name = sourceName || 'model.ifc';
  return /\.ifc$/i.test(name) ? name.replace(/\.ifc$/i, '_edited.ifc') : `${name}_edited.ifc`;
}

export function applySafeIfcEdits(sourceBytes, edits = {}) {
  let source = decodeIfc(sourceBytes);
  let model = parsePropertyModel(source);
  let nextId = nextEntityId(model.entities);
  const entityLines = [];
  const applied = [];
  const skipped = [];

  for (const edit of edits.propertyEdits || []) {
    const localId = Number(edit.localId);
    const propertySetName = String(edit.propertySet || '').trim();
    const propertyName = String(edit.property || '').trim();
    if (!model.entities.has(localId) || !propertySetName || !propertyName) {
      skipped.push({ edit, reason: 'invalid-property-edit' });
      continue;
    }
    const set = (model.elementSets.get(localId) || [])
      .find((candidate) => candidate.name.toLowerCase() === propertySetName.toLowerCase());
    const property = set?.propertyIds
      .map((id) => model.properties.get(id))
      .find((candidate) => candidate?.name.toLowerCase() === propertyName.toLowerCase());

    if (property) {
      try {
        const formatted = formatTypedValue(property.valueType, edit.value);
        const replacement = `#${property.id}=IFCPROPERTYSINGLEVALUE('${escapeStepString(property.name)}',${property.description},${property.valueType}(${formatted}),${property.unit});`;
        source = replaceEntity(source, property, replacement);
        applied.push({ kind: 'property', localId, propertySet: set.name, property: property.name, action: 'updated' });
      } catch (error) {
        skipped.push({ edit, reason: error.message });
      }
      continue;
    }

    if (!CUSTOM_PROPERTY_SET_PATTERN.test(propertySetName)) {
      skipped.push({ edit, reason: 'new-properties-require-bim-tracker-edit-or-cosapi-prefixed-property-set' });
      continue;
    }
    const valueType = String(edit.valueType || 'IFCLABEL').toUpperCase();
    let formattedValue;
    try {
      formattedValue = formatTypedValue(valueType, edit.value);
    } catch (error) {
      skipped.push({ edit, reason: error.message });
      continue;
    }
    const propertyId = nextId++;
    entityLines.push(`#${propertyId}=IFCPROPERTYSINGLEVALUE('${escapeStepString(propertyName)}',$,${valueType}(${formattedValue}),$);`);
    if (set) {
      const updatedIds = [...set.propertyIds, propertyId];
      const replacement = `#${set.id}=IFCPROPERTYSET('${set.guid}',${set.ownerHistory},'${escapeStepString(set.name)}',${set.description},(${updatedIds.map((id) => `#${id}`).join(',')}));`;
      if (source.includes(set.text)) {
        source = replaceEntity(source, set, replacement);
      } else {
        const pendingIndex = entityLines.indexOf(set.text);
        if (pendingIndex >= 0) entityLines[pendingIndex] = replacement;
      }
    } else {
      const setId = nextId++;
      const relationId = nextId++;
      entityLines.push(
        `#${setId}=IFCPROPERTYSET('${createIfcGuid()}',$,'${escapeStepString(propertySetName)}',$,(#${propertyId}));`,
        `#${relationId}=IFCRELDEFINESBYPROPERTIES('${createIfcGuid()}',$,$,$,(#${localId}),#${setId});`,
      );
    }
    applied.push({ kind: 'property', localId, propertySet: propertySetName, property: propertyName, valueType, action: 'created' });
    model = parsePropertyModel(`${source}\n${entityLines.join('\n')}`);
  }

  model = parsePropertyModel(source);
  for (const edit of edits.colorEdits || []) {
    const localId = Number(edit.localId);
    const items = shapeItemsForElement(model.entities, localId);
    if (!items.sourceItems.length) {
      skipped.push({ edit, reason: 'shape-representation-items-not-found' });
      continue;
    }
    let rgb;
    try {
      rgb = rgbFromHex(edit.color);
    } catch (error) {
      skipped.push({ edit, reason: error.message });
      continue;
    }
    const transparency = Math.min(1, Math.max(0, Number(edit.transparency) || 0));
    const existingStyleUpdate = updateExistingStyles(
      source,
      model.entities,
      items.allItems,
      rgb,
      transparency,
    );
    if (existingStyleUpdate.colorCount) {
      source = existingStyleUpdate.source;
      applied.push({
        kind: 'color',
        localId,
        color: edit.color,
        transparency,
        itemCount: existingStyleUpdate.styledItemCount,
        action: 'updated',
      });
      model = parsePropertyModel(source);
      continue;
    }
    const colourId = nextId++;
    const shadingId = nextId++;
    const surfaceStyleId = nextId++;
    const assignmentId = nextId++;
    entityLines.push(
      `#${colourId}=IFCCOLOURRGB($,${rgb.map((value) => value.toFixed(6)).join(',')});`,
      `#${shadingId}=IFCSURFACESTYLESHADING(#${colourId},${transparency.toFixed(6)});`,
      `#${surfaceStyleId}=IFCSURFACESTYLE('BIM Tracker ${String(edit.color).toUpperCase()}',.BOTH.,(#${shadingId}));`,
      `#${assignmentId}=IFCPRESENTATIONSTYLEASSIGNMENT((#${surfaceStyleId}));`,
    );
    for (const itemId of items.sourceItems) {
      const styledItemId = nextId++;
      entityLines.push(`#${styledItemId}=IFCSTYLEDITEM(#${itemId},(#${assignmentId}),$);`);
    }
    applied.push({ kind: 'color', localId, color: edit.color, transparency, itemCount: items.sourceItems.length, action: 'created' });
  }

  if (!applied.length) throw new Error('No safe IFC edits could be applied.');
  const insertionIndex = findDataTerminator(source);
  const prefix = source.slice(0, insertionIndex).replace(/\s*$/, '');
  const suffix = source.slice(insertionIndex);
  const output = `${prefix}\r\n/* BIM Tracker safe property and appearance edits */\r\n${entityLines.join('\r\n')}\r\n${suffix}`;
  return { bytes: new TextEncoder().encode(output), text: output, applied, skipped };
}
