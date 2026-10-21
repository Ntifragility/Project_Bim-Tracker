export const ELEMENT_KIND_OPTIONS = Object.freeze({
  tray: { label: 'Cable Tray', defaultTypeCode: '01' },
  fitting: { label: 'Cable Fitting', defaultTypeCode: '02' },
});

function cleanToken(value) {
  return String(value ?? '').trim();
}

export function normalizeTagScheme(input = {}) {
  const sequenceDigits = Number.parseInt(input.sequenceDigits, 10);
  const startSequence = Number.parseInt(input.startSequence, 10);
  return {
    prefix: cleanToken(input.prefix),
    system: cleanToken(input.system),
    separator: cleanToken(input.separator) || '.',
    sequenceDigits: Number.isInteger(sequenceDigits) && sequenceDigits >= 1 && sequenceDigits <= 6
      ? sequenceDigits
      : 2,
    startSequence: Number.isInteger(startSequence) && startSequence >= 1 ? startSequence : 1,
    typeCodes: {
      tray: cleanToken(input.typeCodes?.tray) || ELEMENT_KIND_OPTIONS.tray.defaultTypeCode,
      fitting: cleanToken(input.typeCodes?.fitting) || ELEMENT_KIND_OPTIONS.fitting.defaultTypeCode,
    },
  };
}

export function getSystemTag(schemeInput = {}) {
  const scheme = normalizeTagScheme(schemeInput);
  return `${scheme.prefix}${scheme.system}`;
}

export function formatElementTag({ systemTag, typeCode, sequenceNumber, separator = '.' }) {
  return [cleanToken(systemTag), cleanToken(typeCode), cleanToken(sequenceNumber)].join(separator);
}

export function parseGeneratedElementTag(value, schemeInput = {}) {
  const scheme = normalizeTagScheme(schemeInput);
  const parts = cleanToken(value).split(scheme.separator);
  if (parts.length !== 3) return null;
  const [systemTag, typeCode, sequenceNumber] = parts;
  if (!systemTag || !typeCode || !/^\d+$/.test(sequenceNumber)) return null;
  return { systemTag, typeCode, sequenceNumber, sequence: Number(sequenceNumber) };
}

export function validateTagScheme(schemeInput = {}) {
  const scheme = normalizeTagScheme(schemeInput);
  const errors = [];
  if (!scheme.prefix) errors.push('Enter a tag prefix.');
  if (!scheme.system) errors.push('Enter a system or run number.');
  if (scheme.prefix.includes(scheme.separator) || scheme.system.includes(scheme.separator)) {
    errors.push(`Prefix and system cannot contain the “${scheme.separator}” separator.`);
  }
  if (scheme.typeCodes.tray === scheme.typeCodes.fitting) {
    errors.push('Tray and fitting type codes must be different.');
  }
  for (const [kind, code] of Object.entries(scheme.typeCodes)) {
    if (!code) errors.push(`Enter a type code for ${ELEMENT_KIND_OPTIONS[kind].label.toLowerCase()}.`);
    if (code.includes(scheme.separator)) errors.push(`Type code “${code}” cannot contain the separator.`);
  }
  return { valid: errors.length === 0, errors, scheme };
}

export function allocateElementTags({
  elements = [],
  elementKind,
  scheme: schemeInput = {},
  existingAssignments = [],
} = {}) {
  const validation = validateTagScheme(schemeInput);
  if (!validation.valid) return { ...validation, assignments: [] };
  if (!ELEMENT_KIND_OPTIONS[elementKind]) {
    return { valid: false, errors: ['Choose Cable Tray or Cable Fitting before generating tags.'], assignments: [] };
  }

  const scheme = validation.scheme;
  const systemTag = getSystemTag(scheme);
  const typeCode = scheme.typeCodes[elementKind];
  const reserved = new Set();
  for (const assignment of existingAssignments) {
    const parsed = parseGeneratedElementTag(assignment.elementTag || assignment.componentId, scheme);
    if (!parsed) continue;
    if (parsed.systemTag.toLowerCase() !== systemTag.toLowerCase()) continue;
    if (parsed.typeCode.toLowerCase() !== typeCode.toLowerCase()) continue;
    reserved.add(parsed.sequence);
  }

  const maximum = (10 ** scheme.sequenceDigits) - 1;
  let nextSequence = reserved.size
    ? Math.max(scheme.startSequence, Math.max(...reserved) + 1)
    : scheme.startSequence;
  const assignments = [];
  for (const element of elements) {
    while (reserved.has(nextSequence)) nextSequence += 1;
    if (nextSequence > maximum) {
      return {
        valid: false,
        errors: [`The ${scheme.sequenceDigits}-digit sequence is full. Increase the digit count before applying tags.`],
        assignments: [],
        scheme,
      };
    }
    const sequenceNumber = String(nextSequence).padStart(scheme.sequenceDigits, '0');
    const elementTag = formatElementTag({
      systemTag,
      typeCode,
      sequenceNumber,
      separator: scheme.separator,
    });
    assignments.push({
      ...element,
      systemTag,
      elementTag,
      componentId: elementTag,
      elementKind,
      typeCode,
      sequenceNumber,
      schemeVersion: '2',
    });
    reserved.add(nextSequence);
    nextSequence += 1;
  }
  return { valid: true, errors: [], assignments, scheme };
}
