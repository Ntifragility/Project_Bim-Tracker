// packages/viewer-core/src/bundle-cache.js
// Lightweight IndexedDB chunk cache for SVF2-Lite HTTP .fragbundle streaming.
// Falls back cleanly to an in-memory Map in Node/tests or private-browsing contexts without IndexedDB.

/**
 * Creates a chunk byte cache backed by IndexedDB (browser) or in-memory Map (fallback).
 */
export function createBundleCache({
  dbName = "covillaf-fragbundle-cache",
  storeName = "chunks",
  maxEntries = 128,
  useIndexedDb = typeof indexedDB !== "undefined",
} = {}) {
  const memoryFallback = new Map(); // key -> { bytes: Uint8Array, savedAt: number, size: number }
  let dbPromise = null;

  function openDb() {
    if (!useIndexedDb || typeof indexedDB === "undefined") return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: "key" });
            store.createIndex("savedAt", "savedAt", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function get(key) {
    if (!key) return null;
    const db = await openDb();
    if (!db) {
      const hit = memoryFallback.get(key);
      if (!hit) return null;
      hit.savedAt = Date.now();
      return hit.bytes;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => {
          const rec = req.result;
          if (!rec || !rec.bytes) return resolve(null);
          const buf = rec.bytes instanceof ArrayBuffer ? rec.bytes : rec.bytes.buffer || rec.bytes;
          resolve(new Uint8Array(buf));
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function evictIfNeeded(db) {
    if (!db) {
      if (memoryFallback.size <= maxEntries) return;
      const ordered = Array.from(memoryFallback.entries()).sort((a, b) => a[1].savedAt - b[1].savedAt);
      const dropCount = memoryFallback.size - maxEntries;
      for (let i = 0; i < dropCount; i++) {
        memoryFallback.delete(ordered[i][0]);
      }
      return;
    }
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const countReq = store.count();
        countReq.onsuccess = () => {
          const excess = (countReq.result || 0) - maxEntries;
          if (excess <= 0) return resolve();
          const idx = store.index("savedAt");
          let dropped = 0;
          const curReq = idx.openCursor();
          curReq.onsuccess = () => {
            const cursor = curReq.result;
            if (!cursor || dropped >= excess) return;
            cursor.delete();
            dropped++;
            cursor.continue();
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async function put(key, bytes) {
    if (!key || !bytes) return false;
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const db = await openDb();
    if (!db) {
      memoryFallback.set(key, {
        bytes: new Uint8Array(u8),
        savedAt: Date.now(),
        size: u8.byteLength,
      });
      await evictIfNeeded(null);
      return true;
    }
    const copyBuf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const ok = await new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put({
          key,
          bytes: copyBuf,
          savedAt: Date.now(),
          size: u8.byteLength,
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    if (ok) await evictIfNeeded(db);
    return ok;
  }

  async function stats() {
    const db = await openDb();
    if (!db) {
      let totalBytes = 0;
      for (const v of memoryFallback.values()) totalBytes += v.size || 0;
      return { entries: memoryFallback.size, totalBytes, backend: "memory" };
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        let entries = 0;
        let totalBytes = 0;
        const curReq = store.openCursor();
        curReq.onsuccess = () => {
          const cursor = curReq.result;
          if (!cursor) return resolve({ entries, totalBytes, backend: "indexeddb" });
          entries++;
          totalBytes += Number(cursor.value?.size) || 0;
          cursor.continue();
        };
        curReq.onerror = () => resolve({ entries: 0, totalBytes: 0, backend: "indexeddb" });
      } catch {
        resolve({ entries: 0, totalBytes: 0, backend: "indexeddb" });
      }
    });
  }

  async function clear() {
    memoryFallback.clear();
    const db = await openDb();
    if (!db) return true;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  return { get, put, stats, clear };
}
