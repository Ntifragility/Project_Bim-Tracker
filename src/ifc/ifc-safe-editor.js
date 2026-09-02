import { createIfcGuid } from './ifc-tag-exporter.js';

const EDITABLE_IFC_VALUE_TYPES = new Set([
  'IFCLABEL',
  'IFCTEXT',
  'IFCIDENTIFIER',
  'IFCBOOLEAN',
  'IFCINTEGER',
  'IFCREAL',
  'IFCDATE',
  'IFCDATETIME',
]);

const CUSTOM_PROPERTY_SET_PATTERN = /^(?:BIM_TRACKER_EDIT|COSAPI_[A-Z0-9_]+)$/i;

function decodeIfc(sourceBytes) {
  return typeof sourceBytes === 'string' ? sourceBytes : new TextDecoder('utf-8').decode(sourceBytes);
}

function escapeStepString(value) {
  return String(value).replaceAll("'", "''");
}

function unescapeStepString(value) {
  return String(value).replaceAll("''", "'");
}

function findDataTerminator(source) {
  const match = /ENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i.exec(source);
  if (!match) throw new Error('The IFC DATA section terminator was not found.');
  return match.index;
}

function entityIndex(source) {
  const entities = new Map();
  for (const match of source.matchAll(/^\s*#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;\s*$/gmi)) {
    entities.set(Number(match[1]), { id: Number(match[1]), type: match[2].toUpperCase(), args: match[3], text: match[0] });
  }
  return entities;
}

function nextEntityId(entities) {
  let nextId = 1;
  for (const id of entities.keys()) nextId = Math.max(nextId, id + 1);
  return nextId;
}

function references(value) {
  return Array.from(String(value).matchAll(/#(\d+)/g), (match) => Number(match[1]));
}

function parsePropertyModel(source) {
  const entities = entityIndex(source);
  const properties = new Map();
  const sets = new Map();
  const elementSets = new Map();

  for (const entity of entities.values()) {
    if (entity.type !== 'IFCPROPERTYSINGLEVALUE') continue;
    const match = /^\s*'((?:''|[^'])*)'\s*,\s*([^,]*)\s*,\s*([A-Z0-9_]+)\s*\((.*)\)\s*,\s*([^,]*)\s*$/i.exec(entity.args);
    if (!match) continue;
    properties.set(entity.id, {
      ...entity,
      name: unescapeStepString(match[1]),
      description: match[2],
      valueType: match[3].toUpperCase(),
      rawValue: match[4],
      unit: match[5],
    });
  }

  for (const entity of entities.values()) {
    if (entity.type !== 'IFCPROPERTYSET') continue;
    const match = /^\s*'((?:''|[^'])*)'\s*,\s*([^,]*)\s*,\s*'((?:''|[^'])*)'\s*,\s*([^,]*)\s*,\s*\(([^)]*)\)\s*$/i.exec(entity.args);
    if (!match) continue;
    const propertyIds = references(match[5]);
    sets.set(entity.id, {
      ...entity,
      guid: match[1],
      ownerHistory: match[2],
      name: unescapeStepString(match[3]),
      description: match[4],
      propertyIds,
    });
  }

  for (const entity of entities.values()) {
    if (entity.type !== 'IFCRELDEFINESBYPROPERTIES') continue;
    const match = /^.*,\s*\(([^)]*)\)\s*,\s*#(\d+)\s*$/i.exec(entity.args);
    if (!match) continue;
    const set = sets.get(Number(match[2]));
    if (!set) continue;
    for (const localId of references(match[1])) {
      if (!elementSets.has(localId)) elementSets.set(localId, []);
      elementSets.get(localId).push(set);
    }
  }
  return { entities, properties, sets, elementSets };
}

function formatTypedValue(valueType, value) {
  const text = String(value ?? '').trim();
  if (!EDITABLE_IFC_VALUE_TYPES.has(valueType)) {
    throw new Error(`IFC value type ${valueType} is not supported by the safe editor.`);
  }
  if (valueType === 'IFCBOOLEAN') {
    if (/^(true|yes|1|\.t\.)$/i.test(text)) return '.T.';
    if (/^(false|no|0|\.f\.)$/i.test(text)) return '.F.';
    throw new Error(`"${value}" is not a valid IFC Boolean.`);
  }
  if (valueType === 'IFCINTEGER') {
    if (!/^[+-]?\d+$/.test(text)) throw new Error(`"${value}" is not a valid IFC integer.`);
    return text;
  }
  if (valueType === 'IFCREAL') {
    const number = Number(text);
    if (!Number.isFinite(number)) throw new Error(`"${value}" is not a valid IFC real number.`);
    return Number.isInteger(number) ? `${number}.` : String(number);
  }
  if (valueType === 'IFCDATE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`"${value}" is not a valid IFC date (YYYY-MM-DD).`);
    return `'${text}'`;
  }
  if (valueType === 'IFCDATETIME') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) {
      throw new Error(`"${value}" is not a valid IFC date-time.`);
    }
    return `'${text}'`;
  }
  return `'${escapeStepString(value)}'`;
}

function replaceEntity(source, entity, replacement) {
  return source.replace(entity.text, replacement);
}

function directShapeItemsForElement(entities, localId) {
  const product = entities.get(Number(localId));
  if (!product) return [];
  const definitionShapes = references(product.args)
    .map((id) => entities.get(id))
    .filter((entity) => entity?.type === 'IFCPRODUCTDEFINITIONSHAPE');
  const shapeRepresentations = definitionShapes.flatMap((shape) =>
    references(shape.args).map((id) => entities.get(id)).filter((entity) => entity?.type === 'IFCSHAPEREPRESENTATION')
  );
  const items = new Set();
  for (const shape of shapeRepresentations) {
    const match = /,\s*\(([^()]*)\)\s*$/.exec(shape.args);
    if (match) references(match[1]).forEach((id) => items.add(id));
  }
  return Array.from(items);
}

function mappedSourceItems(entities, itemId, visited = new Set()) {
  if (visited.has(itemId)) return [];
  visited.add(itemId);
  const item = entities.get(itemId);
  if (!item || item.type !== 'IFCMAPPEDITEM') return [itemId];
  const mappingSourceId = references(item.args)[0];
  const mappingSource = entities.get(mappingSourceId);
  if (!mappingSource || mappingSource.type !== 'IFCREPRESENTATIONMAP') return [itemId];
  const mappedRepresentation = references(mappingSource.args)
    .map((id) => entities.get(id))
    .find((entity) => entity?.type === 'IFCSHAPEREPRESENTATION');
  if (!mappedRepresentation) return [itemId];
  const match = /,\s*\(([^()]*)\)\s*$/.exec(mappedRepresentation.args);
  if (!match) return [itemId];
  return references(match[1]).flatMap((id) => mappedSourceItems(entities, id, visited));
}

function shapeItemsForElement(entities, localId) {
  const directItems = directShapeItemsForElement(entities, localId);
  const sourceItems = directItems.flatMap((id) => mappedSourceItems(entities, id));
  return {
    directItems,
    sourceItems: Array.from(new Set(sourceItems)),
    allItems: Array.from(new Set([...directItems, ...sourceItems])),
  };
}

function updateExistingStyles(source, entities, itemIds, rgb, transparency) {
  const targetIds = new Set(itemIds);
  const colorIds = new Set();
  const shadingIds = new Set();
  const renderingIds = new Set();
  let styledItemCount = 0;

  for (const styledItem of entities.values()) {
    if (styledItem.type !== 'IFCSTYLEDITEM') continue;
    const itemId = references(styledItem.args)[0];
    if (!targetIds.has(itemId)) continue;
    styledItemCount += 1;
    const assignmentIds = references(styledItem.args).slice(1);
    for (const assignmentId of assignmentIds) {
      const assignment = entities.get(assignmentId);
      if (!assignment) continue;
      for (const surfaceStyleId of references(assignment.args)) {
        const surfaceStyle = entities.get(surfaceStyleId);
        if (surfaceStyle?.type !== 'IFCSURFACESTYLE') continue;
        for (const presentationId of references(surfaceStyle.args)) {
          const presentation = entities.get(presentationId);
          if (presentation?.type === 'IFCSURFACESTYLESHADING') shadingIds.add(presentation.id);
          if (presentation?.type === 'IFCSURFACESTYLERENDERING') renderingIds.add(presentation.id);
          const colourId = references(presentation?.args || '')[0];
          if (entities.get(colourId)?.type === 'IFCCOLOURRGB') colorIds.add(colourId);
        }
      }
    }
  }

  for (const colorId of colorIds) {
    const color = entities.get(colorId);
    const name = color.args.split(',')[0]?.trim() || '$';
    source = replaceEntity(
      source,
      color,
      `#${color.id}=IFCCOLOURRGB(${name},${rgb.map((value) => value.toFixed(6)).join(',')});`,
    );
  }
  for (const shadingId of shadingIds) {
    const shading = entities.get(shadingId);
    const colorId = references(shading.args)[0];
    source = replaceEntity(
      source,
      shading,
      `#${shading.id}=IFCSURFACESTYLESHADING(#${colorId},${transparency.toFixed(6)});`,
    );
  }
  for (const renderingId of renderingIds) {
    const rendering = entities.get(renderingId);
    const match = /^\s*(#\d+)\s*,\s*([^,]+)(,.*)$/i.exec(rendering.args);
    if (!match) continue;
    source = replaceEntity(
      source,
      rendering,
      `#${rendering.id}=IFCSURFACESTYLERENDERING(${match[1]},${transparency.toFixed(6)}${match[3]});`,
    );
  }
  return { source, styledItemCount, colorCount: colorIds.size };
}

function rgbFromHex(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!match) throw new Error(`"${hex}" is not a valid six-digit RGB color.`);
  return match.slice(1).map((part) => Number.parseInt(part, 16) / 255);
}

function editedIfcFileName(sourceName) {
  const name = sourceName || 'model.ifc';
  return /\.ifc$/i.test(name) ? name.replace(/\.ifc$/i, '_edited.ifc') : `${name}_edited.ifc`;
}

export { editedIfcFileName };

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
