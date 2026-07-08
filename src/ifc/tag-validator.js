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
  const elementGroups = groupByTag(elements);
  const excelGroups = groupByTag(excelTags);
  const blankExcelRows = excelTags.filter((item) => !normalizeTag(item.tag));

  for (const items of elementGroups.values()) {
    if (items.length < 2) continue;
    errors.push({
      code: 'duplicate-ifc-tag',
      tag: items[0].tag,
      message: `Tag “${items[0].tag}” is used by ${items.length} IFC elements.`,
      items,
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
      message: `${unassignedExcel.length} Excel tag${unassignedExcel.length === 1 ? '' : 's'} are not assigned to IFC elements.`,
      items: unassignedExcel,
    });
  }

  const missingFromExcel = elements.filter((item) => {
    const normalized = normalizeTag(item.tag);
    return normalized && !excelGroups.has(normalized);
  });
  if (missingFromExcel.length) {
    warnings.push({
      code: 'ifc-tags-missing-from-excel',
      message: `${missingFromExcel.length} IFC tag${missingFromExcel.length === 1 ? '' : 's'} are missing from Excel.`,
      items: missingFromExcel,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts: {
      ifcTags: elements.length,
      excelTags: excelTags.length,
      matchedTags: excelTags.filter((item) => elementGroups.has(normalizeTag(item.tag))).length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
