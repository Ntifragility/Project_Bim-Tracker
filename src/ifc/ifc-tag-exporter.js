const IFC_GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes);
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

export function createIfcGuid() {
  let value = 0n;
  for (const byte of randomBytes(16)) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  for (let index = 0; index < 22; index += 1) {
    encoded = IFC_GUID_ALPHABET[Number(value & 63n)] + encoded;
    value >>= 6n;
  }
  return encoded;
}

function escapeStepString(value) {
  return String(value).replaceAll("'", "''");
}

function unescapeStepString(value) {
  return String(value).replaceAll("''", "'");
}

function decodeIfc(sourceBytes) {
  return typeof sourceBytes === 'string' ? sourceBytes : new TextDecoder('utf-8').decode(sourceBytes);
}

function findDataTerminator(source) {
  const match = /ENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i.exec(source);
  if (!match) throw new Error('The IFC DATA section terminator was not found.');
  return match.index;
}

function getEntityIds(source) {
  return new Set(Array.from(source.matchAll(/^\s*#(\d+)\s*=/gm), (match) => Number(match[1])));
}

export function extractProjectTagsFromIfc(sourceBytes, options = {}) {
  const propertySetName = options.propertySetName || 'CCP_TAG';
  const propertyName = options.propertyName || 'Tag';
  const source = decodeIfc(sourceBytes);
  const stringPattern = "((?:''|[^'])*)";
  const properties = new Map();
  const propertySets = new Map();
  const tags = new Map();

  const propertyRegex = new RegExp(
    `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSINGLEVALUE\\(\\s*'${stringPattern}'\\s*,[^,]*,\\s*[A-Z0-9_]+\\(\\s*'${stringPattern}'\\s*\\)`,
    'gmi',
  );
  for (const match of source.matchAll(propertyRegex)) {
    if (unescapeStepString(match[2]).toLowerCase() !== propertyName.toLowerCase()) continue;
    properties.set(Number(match[1]), unescapeStepString(match[3]));
  }

  const propertySetRegex = new RegExp(
    `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSET\\([^;]*?,\\s*'${stringPattern}'\\s*,[^;]*?\\(([^)]*)\\)\\s*\\)\\s*;`,
    'gmi',
  );
  for (const match of source.matchAll(propertySetRegex)) {
    if (unescapeStepString(match[2]).toLowerCase() !== propertySetName.toLowerCase()) continue;
    const propertyId = Array.from(match[3].matchAll(/#(\d+)/g), (reference) => Number(reference[1]))
      .find((id) => properties.has(id));
    if (propertyId) propertySets.set(Number(match[1]), propertyId);
  }

  const relationRegex = /^\s*#\d+\s*=\s*IFCRELDEFINESBYPROPERTIES\([^;]*?\(([^)]*)\)\s*,\s*#(\d+)\s*\)\s*;/gmi;
  for (const match of source.matchAll(relationRegex)) {
    const propertyId = propertySets.get(Number(match[2]));
    if (!propertyId) continue;
    for (const reference of match[1].matchAll(/#(\d+)/g)) {
      tags.set(Number(reference[1]), { tag: properties.get(propertyId), propertyId });
    }
  }
  return tags;
}

function extractNamedPropertySets(sourceBytes) {
  const source = decodeIfc(sourceBytes);
  const stringPattern = "((?:''|[^'])*)";
  const properties = new Map();
  const propertySets = new Map();
  const elementSets = new Map();
  const propertyRegex = new RegExp(
    `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSINGLEVALUE\\(\\s*'${stringPattern}'\\s*,[^,]*,\\s*[A-Z0-9_]+\\(\\s*'${stringPattern}'\\s*\\)`,
    'gmi',
  );
  for (const match of source.matchAll(propertyRegex)) {
    properties.set(Number(match[1]), {
      name: unescapeStepString(match[2]),
      value: unescapeStepString(match[3]),
    });
  }
  const propertySetRegex = new RegExp(
    `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSET\\([^;]*?,\\s*'${stringPattern}'\\s*,[^;]*?\\(([^)]*)\\)\\s*\\)\\s*;`,
    'gmi',
  );
  for (const match of source.matchAll(propertySetRegex)) {
    const values = new Map();
    for (const reference of match[3].matchAll(/#(\d+)/g)) {
      const propertyId = Number(reference[1]);
      const property = properties.get(propertyId);
      if (property) values.set(property.name.toLowerCase(), { ...property, propertyId });
    }
    propertySets.set(Number(match[1]), { name: unescapeStepString(match[2]), values });
  }
  const relationRegex = /^\s*#\d+\s*=\s*IFCRELDEFINESBYPROPERTIES\([^;]*?\(([^)]*)\)\s*,\s*#(\d+)\s*\)\s*;/gmi;
  for (const match of source.matchAll(relationRegex)) {
    const propertySet = propertySets.get(Number(match[2]));
    if (!propertySet) continue;
    for (const reference of match[1].matchAll(/#(\d+)/g)) {
      const localId = Number(reference[1]);
      if (!elementSets.has(localId)) elementSets.set(localId, new Map());
      elementSets.get(localId).set(propertySet.name.toUpperCase(), propertySet);
    }
  }
  return elementSets;
}

export function extractTraySystemAssignmentsFromIfc(sourceBytes) {
  const elementSets = extractNamedPropertySets(sourceBytes);
  const assignments = new Map();
  for (const [localId, sets] of elementSets) {
    const system = sets.get('CCP_TRAY_SYSTEM');
    const component = sets.get('CCP_COMPONENT');
    const systemTag = system?.values.get('systemtag')?.value || '';
    const componentId = component?.values.get('componentid')?.value || '';
    if (!systemTag && !componentId) continue;
    assignments.set(localId, {
      systemTag,
      componentId,
      sequenceNumber: component?.values.get('sequencenumber')?.value || '',
      systemTagPropertyId: system?.values.get('systemtag')?.propertyId,
      componentIdPropertyId: component?.values.get('componentid')?.propertyId,
      sequencePropertyId: component?.values.get('sequencenumber')?.propertyId,
    });
  }
  return assignments;
}

function replacePropertyValue(source, propertyId, value) {
  const propertyLine = new RegExp(
    `(^\\s*#${propertyId}\\s*=\\s*IFCPROPERTYSINGLEVALUE\\(\\s*'(?:''|[^'])*'\\s*,\\s*[^,]*,\\s*)[A-Z0-9_]+\\(\\s*'(?:''|[^'])*'\\s*\\)(\\s*,[^;]*\\)\\s*;)`,
    'gmi',
  );
  return source.replace(propertyLine, `$1IFCLABEL('${escapeStepString(value)}')$2`);
}

export function addTraySystemAssignmentsToIfc(sourceBytes, assignments) {
  const encoder = new TextEncoder();
  let source = decodeIfc(sourceBytes);
  const entityIds = getEntityIds(source);
  const existing = extractTraySystemAssignmentsFromIfc(source);
  let nextId = 1;
  for (const entityId of entityIds) nextId = Math.max(nextId, entityId + 1);
  const entityLines = [];
  const applied = [];
  const skipped = [];

  const appendPropertySet = (localId, name, values) => {
    const propertyIds = values.map(([propertyName, value]) => {
      const propertyId = nextId++;
      entityLines.push(`#${propertyId}=IFCPROPERTYSINGLEVALUE('${escapeStepString(propertyName)}',$,IFCLABEL('${escapeStepString(value)}'),$);`);
      return propertyId;
    });
    const propertySetId = nextId++;
    const relationshipId = nextId++;
    entityLines.push(
      `#${propertySetId}=IFCPROPERTYSET('${createIfcGuid()}',$,'${name}',$,(${propertyIds.map((id) => `#${id}`).join(',')}));`,
      `#${relationshipId}=IFCRELDEFINESBYPROPERTIES('${createIfcGuid()}',$,$,$,(#${localId}),#${propertySetId});`,
    );
  };

  for (const assignment of assignments) {
    const localId = Number(assignment.localId);
    const systemTag = String(assignment.systemTag ?? '').trim();
    const componentId = String(assignment.componentId ?? '').trim();
    const sequenceNumber = String(assignment.sequenceNumber ?? '').trim();
    if (!Number.isInteger(localId) || !entityIds.has(localId)) {
      skipped.push({ assignment, reason: 'element-not-found-in-source-ifc' });
      continue;
    }
    if (!systemTag || !componentId || !sequenceNumber) {
      skipped.push({ assignment, reason: 'incomplete-tray-assignment' });
      continue;
    }

    const current = existing.get(localId);
    if (current?.systemTagPropertyId && current?.componentIdPropertyId && current?.sequencePropertyId) {
      source = replacePropertyValue(source, current.systemTagPropertyId, systemTag);
      source = replacePropertyValue(source, current.componentIdPropertyId, componentId);
      source = replacePropertyValue(source, current.sequencePropertyId, sequenceNumber);
      applied.push({ localId, systemTag, componentId, sequenceNumber, action: 'updated' });
      continue;
    }
    appendPropertySet(localId, 'CCP_TRAY_SYSTEM', [['SystemTag', systemTag]]);
    appendPropertySet(localId, 'CCP_COMPONENT', [
      ['ComponentId', componentId],
      ['SequenceNumber', sequenceNumber],
    ]);
    applied.push({ localId, systemTag, componentId, sequenceNumber, action: 'created' });
  }
  if (!applied.length) throw new Error('No tray-system assignments matched elements in the source IFC.');
  const insertionIndex = findDataTerminator(source);
  const prefix = source.slice(0, insertionIndex).replace(/\s*$/, '');
  const suffix = source.slice(insertionIndex);
  const output = `${prefix}\r\n/* BIM Tracker tray-system assignments */\r\n${entityLines.join('\r\n')}\r\n${suffix}`;
  return { bytes: encoder.encode(output), text: output, applied, skipped };
}

export function addProjectTagsToIfc(sourceBytes, assignments, options = {}) {
  const propertySetName = options.propertySetName || 'CCP_TAG';
  const propertyName = options.propertyName || 'Tag';
  const encoder = new TextEncoder();
  let source = decodeIfc(sourceBytes);
  const entityIds = getEntityIds(source);
  const existingTags = extractProjectTagsFromIfc(source, { propertySetName, propertyName });
  let maximumEntityId = 0;
  for (const entityId of entityIds) maximumEntityId = Math.max(maximumEntityId, entityId);
  let nextId = maximumEntityId + 1;
  const entityLines = [];
  const applied = [];
  const skipped = [];

  for (const assignment of assignments) {
    const localId = Number(assignment.localId);
    const tag = String(assignment.tag ?? '').trim();
    if (!Number.isInteger(localId) || !entityIds.has(localId)) {
      skipped.push({ assignment, reason: 'element-not-found-in-source-ifc' });
      continue;
    }
    if (!tag) {
      skipped.push({ assignment, reason: 'empty-tag' });
      continue;
    }

    const existingTag = existingTags.get(localId);
    if (existingTag) {
      const propertyLine = new RegExp(
        `(^\\s*#${existingTag.propertyId}\\s*=\\s*IFCPROPERTYSINGLEVALUE\\(\\s*'(?:''|[^'])*'\\s*,\\s*[^,]*,\\s*)[A-Z0-9_]+\\(\\s*'(?:''|[^'])*'\\s*\\)(\\s*,[^;]*\\)\\s*;)`,
        'gmi',
      );
      source = source.replace(propertyLine, `$1IFCLABEL('${escapeStepString(tag)}')$2`);
      applied.push({ localId, tag, propertyId: existingTag.propertyId, action: 'updated' });
      continue;
    }

    const propertyId = nextId++;
    const propertySetId = nextId++;
    const relationshipId = nextId++;
    entityLines.push(
      `#${propertyId}=IFCPROPERTYSINGLEVALUE('${escapeStepString(propertyName)}',$,IFCLABEL('${escapeStepString(tag)}'),$);`,
      `#${propertySetId}=IFCPROPERTYSET('${createIfcGuid()}',$,'${escapeStepString(propertySetName)}',$,(#${propertyId}));`,
      `#${relationshipId}=IFCRELDEFINESBYPROPERTIES('${createIfcGuid()}',$,$,$,(#${localId}),#${propertySetId});`,
    );
    applied.push({ localId, tag, propertyId, propertySetId, relationshipId, action: 'created' });
  }

  if (!applied.length) {
    throw new Error('No tag assignments matched elements in the source IFC.');
  }

  const insertionIndex = findDataTerminator(source);
  const prefix = source.slice(0, insertionIndex).replace(/\s*$/, '');
  const suffix = source.slice(insertionIndex);
  const output = `${prefix}\r\n/* BIM Tracker project tags */\r\n${entityLines.join('\r\n')}\r\n${suffix}`;
  return { bytes: encoder.encode(output), text: output, applied, skipped };
}

export function taggedIfcFileName(sourceName) {
  const name = sourceName || 'model.ifc';
  return /\.ifc$/i.test(name) ? name.replace(/\.ifc$/i, '_tagged.ifc') : `${name}_tagged.ifc`;
}
