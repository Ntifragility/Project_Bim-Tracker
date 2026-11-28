// src/tagging/session-cache.js
// Pure serialization, model fingerprinting, GlobalId/localId reconciliation,
// and IndexedDB persistence for Cable Tray tagging sessions (Tier 1 AutoRecover).

export const SESSION_SCHEMA_VERSION = 1;
const DB_NAME = 'covillaf-tray-sessions';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

/**
 * Strips .ifc / .frag extensions and duplicate suffixes like " (1)"
 * so tags saved on "P22114.ifc" also match "P22114.frag" or "P22114 (1).ifc".
 */
export function normalizeModelBaseName(name = '') {
  return String(name || '')
    .trim()
    .replace(/\.(ifc|frag|fragbundle)$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .trim()
    .toLowerCase();
}

/**
 * Computes a deterministic session key for a loaded model.
 */
export function computeSessionKey(name = '', byteLength = 0) {
  const base = normalizeModelBaseName(name) || 'unnamed-model';
  const size = Number.isFinite(Number(byteLength)) && Number(byteLength) > 0
    ? Number(byteLength)
    : 0;
  return size > 0 ? `${base}::${size}` : base;
}

/**
 * Serializes tagAssignments Map for a specific model (or all models if modelId omitted)
 * into a compact, schema-versioned plain JSON record.
 */
export function serializeTagSession({
  sessionKey,
  modelName = '',
  byteLength = 0,
  modelId = null,
  tagAssignments,
  pattern = null,
  hideTaggedActive = false,
} = {}) {
  const baseName = normalizeModelBaseName(modelName);
  const key = sessionKey || computeSessionKey(modelName, byteLength);
  const tags = [];

  if (tagAssignments instanceof Map) {
    for (const assignment of tagAssignments.values()) {
      if (!assignment) continue;
      if (modelId && assignment.modelId !== modelId) continue;
      tags.push({
        globalId: assignment.globalId || '',
        localId: Number(assignment.localId),
        elementTag: assignment.elementTag || assignment.componentId || '',
        componentId: assignment.componentId || assignment.elementTag || '',
        systemTag: assignment.systemTag || '',
        sequenceNumber: assignment.sequenceNumber || '',
        plano: assignment.plano || '',
        rev: assignment.rev || '',
        subTipo: assignment.subTipo || '',
        escAcc: assignment.escAcc || '',
        tension: assignment.tension || '',
        tipoMaterial: assignment.tipoMaterial || '',
        type: assignment.type || '',
        name: assignment.name || '',
        elementKind: assignment.elementKind || '',
        typeCode: assignment.typeCode || '',
        source: assignment.source || 'pending',
        delete: Boolean(assignment.delete),
      });
    }
  }

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionKey: key,
    baseName,
    modelName: String(modelName || ''),
    byteLength: Number(byteLength) || 0,
    updatedAt: Date.now(),
    pattern: pattern
      ? {
          prefix: String(pattern.prefix || ''),
          start: Math.max(1, Number.parseInt(pattern.start, 10) || 1),
          digits: Math.max(1, Math.min(6, Number.parseInt(pattern.digits, 10) || 2)),
        }
      : null,
    hideTaggedActive: Boolean(hideTaggedActive),
    tags,
  };
}

/**
 * Reconciles saved tag records onto a freshly loaded model's runtime modelId.
 * Prefers IFC GlobalId match when globalIdToLocalId map is provided; falls back to localId.
 */
export function reconcileRestoredTags(savedTags = [], {
  modelId,
  modelName = '',
  globalIdToLocalId = null,
} = {}) {
  if (!Array.isArray(savedTags) || !modelId) return [];
  const restored = [];

  for (const item of savedTags) {
    if (!item) continue;
    let resolvedLocalId = Number(item.localId);
    if (item.globalId && globalIdToLocalId instanceof Map && globalIdToLocalId.has(item.globalId)) {
      resolvedLocalId = Number(globalIdToLocalId.get(item.globalId));
    }
    if (!Number.isFinite(resolvedLocalId)) continue;

    restored.push({
      modelId,
      modelName: modelName || item.modelName || '',
      localId: resolvedLocalId,
      globalId: item.globalId || '',
      elementTag: item.elementTag || item.componentId || '',
      componentId: item.componentId || item.elementTag || '',
      systemTag: item.systemTag || '',
      sequenceNumber: item.sequenceNumber || '',
      plano: item.plano || '',
      rev: item.rev || '',
      subTipo: item.subTipo || '',
      escAcc: item.escAcc || '',
      tension: item.tension || '',
      tipoMaterial: item.tipoMaterial || '',
      type: item.type || '',
      name: item.name || '',
      elementKind: item.elementKind || '',
      typeCode: item.typeCode || '',
      source: item.source || 'pending',
      delete: Boolean(item.delete),
    });
  }

  return restored;
}

/**
 * Creates a session persistence store backed by IndexedDB (browser)
 * or an in-memory Map (headless/Node.js unit tests).
 */
export function createTagSessionStore({ indexedDBImpl = null } = {}) {
  const idb = indexedDBImpl ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);

  if (!idb) {
    // Headless / test fallback
    const mem = new Map();
    return {
      async save(record) {
        if (!record?.sessionKey) return false;
        mem.set(record.sessionKey, structuredClone(record));
        return true;
      },
      async load(sessionKey, baseName = '') {
        if (sessionKey && mem.has(sessionKey)) return structuredClone(mem.get(sessionKey));
        if (baseName) {
          let best = null;
          for (const rec of mem.values()) {
            if (rec.baseName === baseName && (!best || rec.updatedAt > best.updatedAt)) {
              best = rec;
            }
          }
          if (best) return structuredClone(best);
        }
        return null;
      },
      async remove(sessionKey, baseName = '') {
        if (sessionKey) mem.delete(sessionKey);
        if (baseName) {
          for (const [k, rec] of mem.entries()) {
            if (rec.baseName === baseName) mem.delete(k);
          }
        }
        return true;
      },
      async list() {
        return Array.from(mem.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      },
    };
  }

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'sessionKey' });
          store.createIndex('baseName', 'baseName', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error('Failed to open IndexedDB session store.'));
      };
    });
    return dbPromise;
  }

  async function save(record) {
    if (!record?.sessionKey) return false;
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[SessionCache] Save failed:', err);
      return false;
    }
  }

  async function list() {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? req.result : [];
          rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[SessionCache] List failed:', err);
      return [];
    }
  }

  async function load(sessionKey, baseName = '') {
    try {
      const db = await openDb();
      if (sessionKey) {
        const exact = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(sessionKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
        if (exact) return exact;
      }
      if (baseName) {
        const all = await list();
        const match = all.find((r) => r.baseName === baseName);
        if (match) return match;
      }
      return null;
    } catch (err) {
      console.warn('[SessionCache] Load failed:', err);
      return null;
    }
  }

  async function remove(sessionKey, baseName = '') {
    try {
      const db = await openDb();
      const all = baseName ? await list() : [];
      const keysToDelete = new Set();
      if (sessionKey) keysToDelete.add(sessionKey);
      for (const rec of all) {
        if (rec.baseName === baseName) keysToDelete.add(rec.sessionKey);
      }
      if (keysToDelete.size === 0) return true;
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const k of keysToDelete) store.delete(k);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[SessionCache] Remove failed:', err);
      return false;
    }
  }

  return { save, load, remove, list };
}
