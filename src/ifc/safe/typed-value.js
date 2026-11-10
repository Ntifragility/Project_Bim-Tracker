import { escapeStepString } from './step-utils.js';
import { EDITABLE_IFC_VALUE_TYPES } from './property-model.js';

export function formatTypedValue(valueType, value) {
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

export function rgbFromHex(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!match) throw new Error(`"${hex}" is not a valid six-digit RGB color.`);
  return match.slice(1).map((part) => Number.parseInt(part, 16) / 255);
}
