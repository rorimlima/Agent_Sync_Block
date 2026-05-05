/**
 * Offline Cache — IndexedDB para dados do Supabase
 * Armazena tabelas localmente para acesso offline
 * Singleton pattern: mantém conexão aberta na memória
 */

const DB_NAME = 'agent_sync_offline';
const DB_VERSION = 4;
const STORES = ['clientes', 'vendas', 'veiculos_bloqueados', 'audit_logs'];

let _db = null;
let _dbPromise = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach(store => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      });
      if (!db.objectStoreNames.contains('pending_actions')) {
        db.createObjectStore('pending_actions', { keyPath: 'id', autoIncrement: true });
      }
      // Store para meta/timestamps
      if (!db.objectStoreNames.contains('_meta')) {
        db.createObjectStore('_meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => { _db = null; _dbPromise = null; };
      _dbPromise = null;
      resolve(_db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });

  return _dbPromise;
}

export async function cacheTableData(tableName, data) {
  const db = await openDB();
  const tx = db.transaction(tableName, 'readwrite');
  const store = tx.objectStore(tableName);
  store.clear();
  data.forEach(item => store.put(item));
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedData(tableName) {
  try {
    const db = await openDB();
    const tx = db.transaction(tableName, 'readonly');
    const store = tx.objectStore(tableName);
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function addPendingAction(action) {
  const db = await openDB();
  const tx = db.transaction('pending_actions', 'readwrite');
  tx.objectStore('pending_actions').put({ ...action, timestamp: Date.now() });
  return new Promise((resolve) => { tx.oncomplete = resolve; });
}

export async function getPendingActions() {
  const db = await openDB();
  const tx = db.transaction('pending_actions', 'readonly');
  return new Promise((resolve) => {
    const req = tx.objectStore('pending_actions').getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

export async function clearPendingActions() {
  const db = await openDB();
  const tx = db.transaction('pending_actions', 'readwrite');
  tx.objectStore('pending_actions').clear();
  return new Promise((resolve) => { tx.oncomplete = resolve; });
}

export async function getCacheTimestamp(tableName) {
  try {
    const ts = localStorage.getItem(`cache_ts_${tableName}`);
    return ts ? parseInt(ts) : 0;
  } catch { return 0; }
}

export async function setCacheTimestamp(tableName) {
  try {
    localStorage.setItem(`cache_ts_${tableName}`, Date.now().toString());
  } catch {}
}

/**
 * Check if cache is fresh (within TTL in ms)
 */
export async function isCacheFresh(tableName, ttlMs = 300000) {
  const ts = await getCacheTimestamp(tableName);
  return ts > 0 && (Date.now() - ts) < ttlMs;
}
