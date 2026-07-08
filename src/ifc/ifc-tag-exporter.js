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

function findDataTerminator(source) {
  const match = /ENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i.exec(source);
  if (!match) throw new Error('The IFC DATA section terminator was not found.');
  return match.index;
}

function getEntityIds(source) {
  return new Set(Array.from(source.matchAll(/^\s*#(\d+)\s*=/gm), (match) => Number(match[1])));
}

export function addProjectTagsToIfc(sourceBytes, assignments, options = {}) {
  const propertySetName = options.propertySetName || 'CCP_TAG';
  const propertyName = options.propertyName || 'Tag';
  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();
  const source = typeof sourceBytes === 'string' ? sourceBytes : decoder.decode(sourceBytes);
  const insertionIndex = findDataTerminator(source);
  const entityIds = getEntityIds(source);
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

    const propertyId = nextId++;
    const propertySetId = nextId++;
    const relationshipId = nextId++;
    entityLines.push(
      `#${propertyId}=IFCPROPERTYSINGLEVALUE('${escapeStepString(propertyName)}',$,IFCLABEL('${escapeStepString(tag)}'),$);`,
      `#${propertySetId}=IFCPROPERTYSET('${createIfcGuid()}',$,'${escapeStepString(propertySetName)}',$,(#${propertyId}));`,
      `#${relationshipId}=IFCRELDEFINESBYPROPERTIES('${createIfcGuid()}',$,$,$,(#${localId}),#${propertySetId});`,
    );
    applied.push({ localId, tag, propertyId, propertySetId, relationshipId });
  }

  if (!applied.length) {
    throw new Error('No tag assignments matched elements in the source IFC.');
  }

  const prefix = source.slice(0, insertionIndex).replace(/\s*$/, '');
  const suffix = source.slice(insertionIndex);
  const output = `${prefix}\r\n/* BIM Tracker project tags */\r\n${entityLines.join('\r\n')}\r\n${suffix}`;
  return { bytes: encoder.encode(output), text: output, applied, skipped };
}

export function taggedIfcFileName(sourceName) {
  const name = sourceName || 'model.ifc';
  return /\.ifc$/i.test(name) ? name.replace(/\.ifc$/i, '_tagged.ifc') : `${name}_tagged.ifc`;
}
