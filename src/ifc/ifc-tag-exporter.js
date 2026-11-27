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

const DEFAULT_SCAN_CHUNK_BYTES = 16 * 1024 * 1024; // 16 MB sliding window

/**
 * Streams an IFC string or Uint8Array in line-aligned UTF-8 text chunks so V8's
 * 512 MB max string length is never exceeded on 1.5 GB+ models.
 */
export function scanIfcChunks(sourceBytes, onChunkText, chunkSize = DEFAULT_SCAN_CHUNK_BYTES) {
  if (typeof sourceBytes === 'string') {
    onChunkText(sourceBytes);
    return;
  }
  const bytes = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
  if (bytes.byteLength <= chunkSize) {
    onChunkText(new TextDecoder('utf-8').decode(bytes));
    return;
  }

  const decoder = new TextDecoder('utf-8');
  let tail = '';
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const end = Math.min(bytes.byteLength, offset + chunkSize);
    const isLast = end >= bytes.byteLength;
    const chunk = decoder.decode(bytes.subarray(offset, end), { stream: !isLast });
    const combined = tail + chunk;
    if (isLast) {
      if (combined) onChunkText(combined);
      tail = '';
    } else {
      const lastNewline = combined.lastIndexOf('\n');
      if (lastNewline >= 0) {
        onChunkText(combined.slice(0, lastNewline + 1));
        tail = combined.slice(lastNewline + 1);
      } else {
        tail = combined;
      }
    }
  }
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
  const stringPattern = "((?:''|[^'])*)";
  const propertySets = new Map(); // psetId -> Set<propId>
  const wantedPropIds = new Set();
  const rawRelations = [];

  const propertySetRegex = new RegExp(
    `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSET\\([^;]*?,\\s*'${stringPattern}'\\s*,[^;]*?\\(([^)]*)\\)\\s*\\)\\s*;`,
    'gmi',
  );
  const relationRegex = /^\s*#\d+\s*=\s*IFCRELDEFINESBYPROPERTIES\([^;]*?\(([^)]*)\)\s*,\s*#(\d+)\s*\)\s*;/gmi;

  // Pass 1: locate matching IFCPROPERTYSET + IFCRELDEFINESBYPROPERTIES
  scanIfcChunks(sourceBytes, (chunkText) => {
    for (const match of chunkText.matchAll(propertySetRegex)) {
      if (unescapeStepString(match[2]).toLowerCase() !== propertySetName.toLowerCase()) continue;
      const psetId = Number(match[1]);
      const propIds = [];
      for (const ref of match[3].matchAll(/#(\d+)/g)) {
        const pid = Number(ref[1]);
        propIds.push(pid);
        wantedPropIds.add(pid);
      }
      if (propIds.length > 0) propertySets.set(psetId, propIds);
    }
    for (const match of chunkText.matchAll(relationRegex)) {
      rawRelations.push({ targetsText: match[1], psetId: Number(match[2]) });
    }
  }, options.chunkSize);

  if (propertySets.size === 0 || wantedPropIds.size === 0) {
    return new Map();
  }

  // Pass 2: resolve only the referenced IFCPROPERTYSINGLEVALUE entries
  const properties = new Map();
  const propertyRegex = new RegExp(
    `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSINGLEVALUE\\(\\s*'${stringPattern}'\\s*,[^,]*,\\s*[A-Z0-9_]+\\(\\s*'${stringPattern}'\\s*\\)`,
    'gmi',
  );
  scanIfcChunks(sourceBytes, (chunkText) => {
    for (const match of chunkText.matchAll(propertyRegex)) {
      const pid = Number(match[1]);
      if (!wantedPropIds.has(pid)) continue;
      if (unescapeStepString(match[2]).toLowerCase() !== propertyName.toLowerCase()) continue;
      properties.set(pid, unescapeStepString(match[3]));
    }
  }, options.chunkSize);

  const tags = new Map();
  for (const rel of rawRelations) {
    const propIds = propertySets.get(rel.psetId);
    if (!propIds) continue;
    const propertyId = propIds.find((id) => properties.has(id));
    if (!propertyId) continue;
    for (const reference of rel.targetsText.matchAll(/#(\d+)/g)) {
      tags.set(Number(reference[1]), { tag: properties.get(propertyId), propertyId });
    }
  }
  return tags;
}

function extractNamedPropertySets(sourceBytes, filterSetNames = null) {
  const stringPattern = "((?:''|[^'])*)";
  const propertySets = new Map(); // psetId -> { name, propIds }
  const wantedPropIds = new Set();
  const rawRelations = [];

  const propertySetRegex = new RegExp(
    `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSET\\([^;]*?,\\s*'${stringPattern}'\\s*,[^;]*?\\(([^)]*)\\)\\s*\\)\\s*;`,
    'gmi',
  );
  const relationRegex = /^\s*#\d+\s*=\s*IFCRELDEFINESBYPROPERTIES\([^;]*?\(([^)]*)\)\s*,\s*#(\d+)\s*\)\s*;/gmi;

  scanIfcChunks(sourceBytes, (chunkText) => {
    for (const match of chunkText.matchAll(propertySetRegex)) {
      const name = unescapeStepString(match[2]);
      if (filterSetNames && !filterSetNames.has(name.toUpperCase())) continue;
      const propIds = [];
      for (const reference of match[3].matchAll(/#(\d+)/g)) {
        const pid = Number(reference[1]);
        propIds.push(pid);
        wantedPropIds.add(pid);
      }
      propertySets.set(Number(match[1]), { name, propIds });
    }
    for (const match of chunkText.matchAll(relationRegex)) {
      rawRelations.push({ targetsText: match[1], psetId: Number(match[2]) });
    }
  });

  const elementSets = new Map();
  if (propertySets.size === 0) return elementSets;

  const properties = new Map();
  if (wantedPropIds.size > 0) {
    const propertyRegex = new RegExp(
      `^\\s*#(\\d+)\\s*=\\s*IFCPROPERTYSINGLEVALUE\\(\\s*'${stringPattern}'\\s*,[^,]*,\\s*[A-Z0-9_]+\\(\\s*'${stringPattern}'\\s*\\)`,
      'gmi',
    );
    scanIfcChunks(sourceBytes, (chunkText) => {
      for (const match of chunkText.matchAll(propertyRegex)) {
        const pid = Number(match[1]);
        if (!wantedPropIds.has(pid)) continue;
        properties.set(pid, {
          name: unescapeStepString(match[2]),
          value: unescapeStepString(match[3]),
        });
      }
    });
  }

  for (const rel of rawRelations) {
    const pset = propertySets.get(rel.psetId);
    if (!pset) continue;
    const values = new Map();
    for (const propertyId of pset.propIds) {
      const property = properties.get(propertyId);
      if (property) values.set(property.name.toLowerCase(), { ...property, propertyId });
    }
    const resolvedSet = { name: pset.name, psetId: rel.psetId, values };
    for (const reference of rel.targetsText.matchAll(/#(\d+)/g)) {
      const localId = Number(reference[1]);
      if (!elementSets.has(localId)) elementSets.set(localId, new Map());
      elementSets.get(localId).set(pset.name.toUpperCase(), resolvedSet);
    }
  }
  return elementSets;
}

export function extractTraySystemAssignmentsFromIfc(sourceBytes) {
  const elementSets = extractNamedPropertySets(sourceBytes, new Set(['CCP_TRAY_SYSTEM']));
  const assignments = new Map();
  for (const [localId, sets] of elementSets) {
    const system = sets.get('CCP_TRAY_SYSTEM');
    const systemTag = system?.values.get('systemtag')?.value || '';
    const componentId = system?.values.get('componentid')?.value || '';
    const elementTag = system?.values.get('elementtag')?.value || componentId;
    const planoEntry = system?.values.get('plano');
    const subTipoEntry = system?.values.get('subtipo') || system?.values.get('sub_tipo');
    const plano = planoEntry?.value || '';
    const subTipo = subTipoEntry?.value || '';
    if (!systemTag && !componentId && !elementTag && !plano && !subTipo) continue;
    assignments.set(localId, {
      psetId: system?.psetId,
      systemTag,
      elementTag,
      componentId,
      plano,
      subTipo,
      elementKind: system?.values.get('elementkind')?.value || '',
      typeCode: system?.values.get('typecode')?.value || '',
      sequenceNumber: system?.values.get('sequencenumber')?.value || '',
      schemeVersion: system?.values.get('schemeversion')?.value || '',
      originalIfcTag: system?.values.get('originalifctag')?.value || '',
      systemTagPropertyId: system?.values.get('systemtag')?.propertyId,
      elementTagPropertyId: system?.values.get('elementtag')?.propertyId,
      componentIdPropertyId: system?.values.get('componentid')?.propertyId,
      planoPropertyId: planoEntry?.propertyId,
      subTipoPropertyId: subTipoEntry?.propertyId,
      elementKindPropertyId: system?.values.get('elementkind')?.propertyId,
      typeCodePropertyId: system?.values.get('typecode')?.propertyId,
      sequencePropertyId: system?.values.get('sequencenumber')?.propertyId,
      schemeVersionPropertyId: system?.values.get('schemeversion')?.propertyId,
      originalIfcTagPropertyId: system?.values.get('originalifctag')?.propertyId,
    });
  }
  return assignments;
}

function appendPropertyIdsToPropertySet(source, psetId, newPropertyIds = []) {
  if (!psetId || !newPropertyIds.length) return source;
  const psetLine = new RegExp(
    `(^\\s*#${psetId}\\s*=\\s*IFCPROPERTYSET\\([^;]*?\\()([^)]*)(\\)\\s*\\)\\s*;)`,
    'gmi',
  );
  return source.replace(psetLine, (_m, prefix, listText, suffix) => {
    const trimmed = listText.trim();
    const additions = newPropertyIds.map((id) => `#${id}`).join(',');
    const combined = trimmed ? `${trimmed},${additions}` : additions;
    return `${prefix}${combined}${suffix}`;
  });
}

function replacePropertyValue(source, propertyId, value) {
  const propertyLine = new RegExp(
    `(^\\s*#${propertyId}\\s*=\\s*IFCPROPERTYSINGLEVALUE\\(\\s*'(?:''|[^'])*'\\s*,\\s*[^,]*,\\s*)[A-Z0-9_]+\\(\\s*'(?:''|[^'])*'\\s*\\)(\\s*,[^;]*\\)\\s*;)`,
    'gmi',
  );
  return source.replace(propertyLine, `$1IFCLABEL('${escapeStepString(value)}')$2`);
}

const NATIVE_TAG_ENTITY_TYPES = new Set([
  'IFCBUILDINGELEMENTPART',
  'IFCCABLECARRIERSEGMENT',
  'IFCCABLECARRIERFITTING',
  'IFCCABLEFITTING',
  'IFCFLOWSEGMENT',
  'IFCFLOWFITTING',
  'IFCDUCTSEGMENT',
  'IFCDUCTFITTING',
]);

function splitStepArguments(value) {
  const result = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      current += character;
      if (quoted && value[index + 1] === "'") {
        current += value[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted) {
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
    }
    current += character;
  }
  result.push(current.trim());
  return result;
}

function replaceNativeElementTag(source, localId, tag) {
  const entityPattern = new RegExp(`(^\\s*#${localId}\\s*=\\s*([A-Z0-9_]+)\\s*\\()([\\s\\S]*?)(\\)\\s*;)`, 'gmi');
  let updated = false;
  let supported = false;
  const nextSource = source.replace(entityPattern, (line, prefix, entityType, argumentsText, suffix) => {
    if (!NATIVE_TAG_ENTITY_TYPES.has(entityType.toUpperCase())) return line;
    supported = true;
    const args = splitStepArguments(argumentsText);
    if (args.length < 8) return line;
    args[7] = `'${escapeStepString(tag)}'`;
    updated = true;
    return `${prefix}${args.join(',')}${suffix}`;
  });
  return { source: nextSource, updated, supported };
}

function readNativeElementTag(source, localId) {
  const entityPattern = new RegExp(`^\\s*#${localId}\\s*=\\s*([A-Z0-9_]+)\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'mi');
  const match = entityPattern.exec(source);
  if (!match || !NATIVE_TAG_ENTITY_TYPES.has(match[1].toUpperCase())) return '';
  const args = splitStepArguments(match[2]);
  const rawTag = args[7] || '';
  const quoted = /^'((?:''|[^'])*)'$/.exec(rawTag);
  return quoted ? unescapeStepString(quoted[1]) : '';
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
    const removeAssignment = assignment.delete === true || assignment.action === 'delete';
    const systemTag = String(assignment.systemTag ?? '').trim();
    const componentId = String(assignment.componentId ?? assignment.elementTag ?? '').trim();
    const elementTag = String(assignment.elementTag ?? componentId).trim();
    const plano = String(assignment.plano ?? '').trim();
    const subTipo = String(assignment.subTipo ?? '').trim();
    const elementKind = String(assignment.elementKind ?? '').trim();
    const typeCode = String(assignment.typeCode ?? '').trim();
    const sequenceNumber = String(assignment.sequenceNumber ?? '').trim();
    const schemeVersion = String(assignment.schemeVersion ?? '').trim();
    const originalIfcTag = String(assignment.originalIfcTag ?? '').trim();
    if (!Number.isInteger(localId) || !entityIds.has(localId)) {
      skipped.push({ assignment, reason: 'element-not-found-in-source-ifc' });
      continue;
    }
    if (removeAssignment) {
      const current = existing.get(localId);
      if (
        !current?.systemTagPropertyId &&
        !current?.componentIdPropertyId &&
        !current?.sequencePropertyId &&
        !current?.planoPropertyId &&
        !current?.subTipoPropertyId
      ) {
        skipped.push({ assignment, reason: 'tray-assignment-not-found-in-source-ifc' });
        continue;
      }
      if (current.systemTagPropertyId) source = replacePropertyValue(source, current.systemTagPropertyId, '');
      if (current.componentIdPropertyId) source = replacePropertyValue(source, current.componentIdPropertyId, '');
      if (current.sequencePropertyId) source = replacePropertyValue(source, current.sequencePropertyId, '');
      if (current.elementTagPropertyId) source = replacePropertyValue(source, current.elementTagPropertyId, '');
      if (current.elementKindPropertyId) source = replacePropertyValue(source, current.elementKindPropertyId, '');
      if (current.typeCodePropertyId) source = replacePropertyValue(source, current.typeCodePropertyId, '');
      if (current.planoPropertyId) source = replacePropertyValue(source, current.planoPropertyId, plano);
      if (current.subTipoPropertyId) source = replacePropertyValue(source, current.subTipoPropertyId, subTipo);
      const nativeTag = readNativeElementTag(source, localId);
      if (nativeTag && [current.elementTag, current.componentId].filter(Boolean).includes(nativeTag)) {
        source = replaceNativeElementTag(source, localId, '').source;
      }
      applied.push({ localId, systemTag: '', componentId: '', sequenceNumber: '', plano, subTipo, action: 'deleted' });
      continue;
    }

    const hasCompleteTag = Boolean(systemTag && componentId && sequenceNumber);
    const hasCustomProps = Boolean(plano || subTipo);
    if (!hasCompleteTag && !hasCustomProps) {
      skipped.push({ assignment, reason: 'incomplete-tray-assignment' });
      continue;
    }

    const current = existing.get(localId);
    if (current) {
      const appendedPropIds = [];
      const upsertProp = (propId, propName, propVal, alwaysCreate = false) => {
        if (propId) {
          source = replacePropertyValue(source, propId, propVal);
        } else if (propVal || alwaysCreate) {
          const newPid = nextId++;
          entityLines.push(
            `#${newPid}=IFCPROPERTYSINGLEVALUE('${escapeStepString(propName)}',$,IFCLABEL('${escapeStepString(propVal)}'),$);`,
          );
          appendedPropIds.push(newPid);
        }
      };

      if (hasCompleteTag) {
        upsertProp(current.systemTagPropertyId, 'SystemTag', systemTag, true);
        upsertProp(current.elementTagPropertyId, 'ElementTag', elementTag, true);
        upsertProp(current.componentIdPropertyId, 'ComponentId', componentId, true);
        upsertProp(current.elementKindPropertyId, 'ElementKind', elementKind);
        upsertProp(current.typeCodePropertyId, 'TypeCode', typeCode);
        upsertProp(current.sequencePropertyId, 'SequenceNumber', sequenceNumber, true);
        upsertProp(current.schemeVersionPropertyId, 'SchemeVersion', schemeVersion);
        if (originalIfcTag || current.originalIfcTagPropertyId) {
          upsertProp(current.originalIfcTagPropertyId, 'OriginalIfcTag', originalIfcTag);
        }
      }
      upsertProp(current.planoPropertyId, 'Plano', plano, hasCustomProps);
      upsertProp(current.subTipoPropertyId, 'SubTipo', subTipo, hasCustomProps);

      if (appendedPropIds.length > 0 && current.psetId) {
        source = appendPropertyIdsToPropertySet(source, current.psetId, appendedPropIds);
      }

      let nativeUpdated = false;
      if (elementTag || componentId) {
        const nativeTag = replaceNativeElementTag(source, localId, elementTag || componentId);
        source = nativeTag.source;
        nativeUpdated = nativeTag.updated;
      }
      applied.push({
        localId,
        systemTag,
        elementTag,
        componentId,
        sequenceNumber,
        plano,
        subTipo,
        nativeTagUpdated: nativeUpdated,
        action: 'updated',
      });
      continue;
    }

    const propertyValues = [];
    if (hasCompleteTag) {
      propertyValues.push(
        ['SystemTag', systemTag],
        ['ElementTag', elementTag],
        ['ComponentId', componentId],
        ['ElementKind', elementKind],
        ['TypeCode', typeCode],
        ['SequenceNumber', sequenceNumber],
        ['SchemeVersion', schemeVersion],
      );
      if (originalIfcTag) propertyValues.push(['OriginalIfcTag', originalIfcTag]);
    }
    propertyValues.push(['Plano', plano], ['SubTipo', subTipo]);

    appendPropertySet(localId, 'CCP_TRAY_SYSTEM', propertyValues);
    let nativeUpdated = false;
    if (elementTag || componentId) {
      const nativeTag = replaceNativeElementTag(source, localId, elementTag || componentId);
      source = nativeTag.source;
      nativeUpdated = nativeTag.updated;
    }
    applied.push({
      localId,
      systemTag,
      elementTag,
      componentId,
      sequenceNumber,
      plano,
      subTipo,
      nativeTagUpdated: nativeUpdated,
      action: 'created',
    });
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
