function normalizeTag(value) {
  return String(value ?? '').trim().toLowerCase();
}

function groupByTag(items) {
  const groups = new Map();
  for (const item of items) {
    const normalized = normalizeTag(item.tag);
    if (!normalized) continue;
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized).push(item);
  }
  return groups;
}

export function validateTagIntegrity({ elements = [], excelTags = [] } = {}) {
  const errors = [];
  const warnings = [];
  const elementGroups = groupByTag(elements.map((item) => ({ ...item, tag: item.systemTag ?? item.tag })));
  const componentGroups = groupByTag(elements.map((item) => ({ ...item, tag: item.componentId })));
  const excelGroups = groupByTag(excelTags);
  const blankExcelRows = excelTags.filter((item) => !normalizeTag(item.tag));

  for (const items of componentGroups.values()) {
    if (items.length < 2) continue;
    errors.push({
      code: 'duplicate-component-id',
      tag: items[0].tag,
      message: `Component ID “${items[0].tag}” is used by ${items.length} IFC elements.`,
      items,
    });
  }

  const missingComponentIds = elements.filter((item) => !normalizeTag(item.componentId));
  if (missingComponentIds.length) {
    errors.push({
      code: 'missing-component-id',
      message: `${missingComponentIds.length} assigned element${missingComponentIds.length === 1 ? '' : 's'} have no component ID.`,
      items: missingComponentIds,
    });
  }

  for (const items of excelGroups.values()) {
    if (items.length < 2) continue;
    errors.push({
      code: 'duplicate-excel-tag',
      tag: items[0].tag,
      message: `Tag “${items[0].tag}” appears in ${items.length} Excel rows.`,
      items,
    });
  }

  if (blankExcelRows.length) {
    errors.push({
      code: 'blank-excel-tag',
      message: `${blankExcelRows.length} Excel row${blankExcelRows.length === 1 ? '' : 's'} have a blank tag.`,
      items: blankExcelRows,
    });
  }

  const unassignedExcel = excelTags.filter((item) => {
    const normalized = normalizeTag(item.tag);
    return normalized && !elementGroups.has(normalized);
  });
  if (unassignedExcel.length) {
    warnings.push({
      code: 'unassigned-excel-tags',
      message: `${unassignedExcel.length} Excel system tag${unassignedExcel.length === 1 ? '' : 's'} are not assigned to IFC elements.`,
      items: unassignedExcel,
    });
  }

  const uniqueSystems = Array.from(elementGroups.values(), (items) => items[0]);
  const missingFromExcel = uniqueSystems.filter((item) => {
    const normalized = normalizeTag(item.systemTag ?? item.tag);
    return normalized && !excelGroups.has(normalized);
  });
  if (missingFromExcel.length) {
    warnings.push({
      code: 'ifc-tags-missing-from-excel',
      message: `${missingFromExcel.length} IFC tray system${missingFromExcel.length === 1 ? '' : 's'} are missing from Excel.`,
      items: missingFromExcel,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts: {
      ifcTags: elementGroups.size,
      excelTags: excelTags.length,
      matchedTags: excelTags.filter((item) => elementGroups.has(normalizeTag(item.tag))).length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
