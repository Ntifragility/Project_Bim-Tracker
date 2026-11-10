import { applySafeIfcEdits, editedIfcFileName } from '../ifc/ifc-safe-editor.js';
import { addTraySystemAssignmentsToIfc } from '../ifc/ifc-tag-exporter.js';

/**
 * Exports modified IFC files combining property edits, appearance styling, and tag assignments.
 *
 * @param {Array} loadedModels List of loaded models with sourceIfcBytes
 * @param {Map} pendingIfcPropertyEdits Map of pending property edits
 * @param {Map} pendingIfcColorEdits Map of pending color edits
 * @param {Map} tagAssignments Map of assigned tags
 * @returns {{ exportedModels: number, appliedEditsCount: number, appliedTagsCount: number, skippedCount: number }}
 */
export function exportUnifiedIfc({
  loadedModels = [],
  pendingIfcPropertyEdits = new Map(),
  pendingIfcColorEdits = new Map(),
  tagAssignments = new Map(),
} = {}) {
  let exportedModels = 0;
  let appliedEditsCount = 0;
  let appliedTagsCount = 0;
  let skippedCount = 0;

  for (const modelEntry of loadedModels) {
    const modelIds = new Set([modelEntry.uuid, modelEntry.model?.uuid, modelEntry.model?.modelId].filter(Boolean));
    const propertyEdits = Array.from(pendingIfcPropertyEdits.values()).filter((edit) => modelIds.has(edit.modelId));
    const colorEdits = Array.from(pendingIfcColorEdits.values()).filter((edit) => modelIds.has(edit.modelId));
    const assignments = Array.from(tagAssignments.values()).filter((assignment) =>
      modelIds.has(assignment.modelId) || (modelEntry.model && (assignment.modelId === modelEntry.model.modelId || assignment.modelId === modelEntry.model.uuid))
    );

    const hasEdits = propertyEdits.length > 0 || colorEdits.length > 0;
    const hasTags = assignments.length > 0;

    if (!hasEdits && !hasTags) continue;

    if (!modelEntry.sourceIfcBytes) {
      console.warn(`[Unified IFC Export] No source bytes available for ${modelEntry.name}`);
      skippedCount += propertyEdits.length + colorEdits.length + assignments.length;
      continue;
    }

    try {
      let currentBytes = modelEntry.sourceIfcBytes;

      // 1. Apply property & appearance edits
      if (hasEdits) {
        const editResult = applySafeIfcEdits(currentBytes, { propertyEdits, colorEdits });
        currentBytes = editResult.bytes;
        appliedEditsCount += editResult.applied.length;
        skippedCount += editResult.skipped.length;
      }

      // 2. Apply tag assignments
      if (hasTags) {
        const tagResult = addTraySystemAssignmentsToIfc(currentBytes, assignments);
        currentBytes = tagResult.bytes;
        appliedTagsCount += tagResult.applied.length;
        skippedCount += tagResult.skipped.length;
      }

      // 3. Trigger browser download
      const blob = new Blob([currentBytes], { type: 'application/x-step' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = editedIfcFileName(modelEntry.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      exportedModels += 1;
    } catch (error) {
      console.error(`[Unified IFC Export] Error exporting ${modelEntry.name}:`, error);
      skippedCount += propertyEdits.length + colorEdits.length + assignments.length;
    }
  }

  return {
    exportedModels,
    appliedEditsCount,
    appliedTagsCount,
    skippedCount,
  };
}
