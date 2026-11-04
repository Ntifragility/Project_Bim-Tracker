// Thin re-export shim for the safe IFC editor (task 7.4).
// Implementation lives in focused modules under `src/ifc/safe/`:
//   step-utils.js    — STEP text primitives (decode, escape, entity index)
//   property-model.js — property model + whitelist constants
//   typed-value.js   — typed-value formatting + colour parsing
//   style-chain.js   — shape-item walk + existing-style updates
//   apply-edits.js   — applySafeIfcEdits + editedIfcFileName
// Existing imports (`src/ui/unified-export.js`, routing-core tests) keep
// working unchanged through this entry point.

export { applySafeIfcEdits, editedIfcFileName } from './safe/apply-edits.js';
export {
  CUSTOM_PROPERTY_SET_PATTERN,
  EDITABLE_IFC_VALUE_TYPES,
  parsePropertyModel,
} from './safe/property-model.js';
export { formatTypedValue, rgbFromHex } from './safe/typed-value.js';
export {
  decodeIfc,
  entityIndex,
  escapeStepString,
  findDataTerminator,
  nextEntityId,
  references,
  replaceEntity,
  unescapeStepString,
} from './safe/step-utils.js';
export {
  directShapeItemsForElement,
  mappedSourceItems,
  shapeItemsForElement,
  updateExistingStyles,
} from './safe/style-chain.js';
