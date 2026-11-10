import { references, replaceEntity } from './step-utils.js';

export function directShapeItemsForElement(entities, localId) {
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

export function mappedSourceItems(entities, itemId, visited = new Set()) {
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

export function shapeItemsForElement(entities, localId) {
  const directItems = directShapeItemsForElement(entities, localId);
  const sourceItems = directItems.flatMap((id) => mappedSourceItems(entities, id));
  return {
    directItems,
    sourceItems: Array.from(new Set(sourceItems)),
    allItems: Array.from(new Set([...directItems, ...sourceItems])),
  };
}

export function updateExistingStyles(source, entities, itemIds, rgb, transparency) {
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
