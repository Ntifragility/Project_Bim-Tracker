// Project I/O for saving and loading .conduit.json project files.
// Handles SHA-256 hash calculation and verification in both Node.js and browser environments.

import { DEFAULT_STICK_LENGTH_M, DEFAULT_WASTE_FACTOR } from './config.js';

export async function computeSha256(buffer) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuf));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Node.js fallback
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  } catch {
    throw new Error('No crypto implementation available for SHA-256 calculation.');
  }
}

export async function verifySourceHash(buffer, expectedHash) {
  if (!expectedHash) return true;
  const actualHash = await computeSha256(buffer);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}

export function serializeProject({
  network,
  markers = [],
  diameters = [],
  sourceModel = {},
  settings = {},
}) {
  const payload = {
    version: '1.0',
    savedAt: new Date().toISOString(),
    sourceModel: {
      name: sourceModel.name || '',
      size: sourceModel.size || 0,
      sha256: sourceModel.sha256 || '',
      unit: sourceModel.unit || 'METRE',
      schema: sourceModel.schema || 'IFC4',
    },
    settings: {
      stickLengthM: settings.stickLengthM || DEFAULT_STICK_LENGTH_M,
      wasteFactor: settings.wasteFactor !== undefined ? settings.wasteFactor : DEFAULT_WASTE_FACTOR,
      unit: settings.unit || sourceModel.unit || 'METRE',
    },
    diameters: diameters.map((d) => ({
      id: d.id,
      label: d.label,
      mm: d.mm,
      color: d.color,
    })),
    network: network?.toJSON ? network.toJSON() : network || { nodes: {}, runs: {} },
    markers: (markers || []).map((m) => ({
      id: m.id,
      type: m.type,
      position: { ...m.position },
      runId: m.runId || null,
      notes: m.notes || '',
    })),
  };

  return JSON.stringify(payload, null, 2);
}

export function deserializeProject(jsonString) {
  let data;
  try {
    data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
  } catch (err) {
    throw new Error(`Failed to parse project JSON: ${err.message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid project file: expected a JSON object.');
  }

  return {
    version: data.version || '1.0',
    savedAt: data.savedAt || null,
    sourceModel: data.sourceModel || {},
    settings: {
      stickLengthM: data.settings?.stickLengthM || DEFAULT_STICK_LENGTH_M,
      wasteFactor: data.settings?.wasteFactor !== undefined ? data.settings.wasteFactor : DEFAULT_WASTE_FACTOR,
      unit: data.settings?.unit || 'METRE',
    },
    diameters: Array.isArray(data.diameters) ? data.diameters : [],
    network: data.network || { nodes: {}, runs: {} },
    markers: Array.isArray(data.markers) ? data.markers : [],
  };
}
