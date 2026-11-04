export function decodeIfc(sourceBytes) {
  return typeof sourceBytes === 'string' ? sourceBytes : new TextDecoder('utf-8').decode(sourceBytes);
}

export function escapeStepString(value) {
  return String(value).replaceAll("'", "''");
}

export function unescapeStepString(value) {
  return String(value).replaceAll("''", "'");
}

export function findDataTerminator(source) {
  const match = /ENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i.exec(source);
  if (!match) throw new Error('The IFC DATA section terminator was not found.');
  return match.index;
}

export function entityIndex(source) {
  const entities = new Map();
  for (const match of source.matchAll(/^\s*#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;\s*$/gmi)) {
    entities.set(Number(match[1]), { id: Number(match[1]), type: match[2].toUpperCase(), args: match[3], text: match[0] });
  }
  return entities;
}

export function nextEntityId(entities) {
  let nextId = 1;
  for (const id of entities.keys()) nextId = Math.max(nextId, id + 1);
  return nextId;
}

export function references(value) {
  return Array.from(String(value).matchAll(/#(\d+)/g), (match) => Number(match[1]));
}

export function replaceEntity(source, entity, replacement) {
  return source.replace(entity.text, replacement);
}
