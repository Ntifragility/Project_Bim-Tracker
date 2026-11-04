import { entityIndex, references, unescapeStepString } from './step-utils.js';

export const EDITABLE_IFC_VALUE_TYPES = new Set([
  'IFCLABEL',
  'IFCTEXT',
  'IFCIDENTIFIER',
  'IFCBOOLEAN',
  'IFCINTEGER',
  'IFCREAL',
  'IFCDATE',
  'IFCDATETIME',
]);

export const CUSTOM_PROPERTY_SET_PATTERN = /^(?:BIM_TRACKER_EDIT|COSAPI_[A-Z0-9_]+)$/i;

export function parsePropertyModel(source) {
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
