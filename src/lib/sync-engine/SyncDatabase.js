/**
 * SyncDatabase — IndexedDB gerenciado via API nativa (zero dependências)
 * 
 * Responsabilidades:
 * - Banco local de dados offline (IndexedDB)
 * - Índices otimizados para Delta Sync (updated_at, is_deleted)
 * - Fila de mutações pendentes (mutation_queue)
 * - Metadados de sincronização (_sync_meta)
 * 
 * REGRA DE OURO: Este módulo é ISOLADO da UI. Nenhum useState/useEffect aqui.
 */

const DB_NAME = 'agent_sync_v3';
const DB_VERSION = 1;

// Todas as tabelas do sistema com seus índices
const TABLE_SCHEMAS = {
  clientes: ['id', 'updated_at', 'is_deleted', 'cod_cliente'],
  vendas: ['id', 'updated_at', 'is_deleted', 'cod_cliente', 'placa'],
  veiculos_bloqueados: ['id', 'updated_at', 'is_deleted', 'placa', 'status_final'],
  audit_logs: ['id', 'updated_at', 'is_deleted', 'created_at'],
  colaboradores: ['id', 'updated_at', 'is_deleted', 'auth_user_id'],
};

// Stores internos do Sync Engine
const INTERNAL_STORES = {
  mutation_queue: { keyPath: 'queue_id', autoIncrement: true },
  _sync_meta: { keyPath: 'key' },
};

let _db = null;
let _dbPromise = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Criar stores para dados de cada tabela
      for (const [tableName, indices] of Object.entries(TABLE_SCHEMAS)) {
        if (!db.objectStoreNames.contains(tableName)) {
          const store = db.createObjectStore(tableName, { keyPath: 'id' });
          // Criar índices para cada campo (exceto id que já é keyPath)
          for (const idx of indices) {
            if (idx !== 'id') {
              store.createIndex(idx, idx, { unique: false });
            }
          }
        }
      }

      // Criar stores internos
      for (const [storeName, config] of Object.entries(INTERNAL_STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, config);
        }
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

// ─── Operações de Dados ─────────────────────────────────────────────────────────

/**
 * Lê todos os registros de uma tabela (excluindo soft-deletes)
 */
export async function getAll(table, { includeDeleted = false } = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readonly');
    const store = tx.objectStore(table);
    const req = store.getAll();
    req.onsuccess = () => {
      let results = req.result || [];
      if (!includeDeleted) {
        results = results.filter(r => !r.is_deleted);
      }
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Lê um registro por ID
 */
export async function getById(table, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readonly');
    const req = tx.objectStore(table).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Upsert (put) de um registro local — usado tanto por Optimistic UI quanto por Delta Sync
 * Retorna true se houve mudança efetiva
 */
export async function putRecord(table, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readwrite');
    tx.objectStore(table).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Upsert em lote (bulk) — usado pelo Delta Sync para aplicar muitos registros de uma vez
 */
export async function putRecordsBatch(table, records) {
  if (!records || records.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readwrite');
    const store = tx.objectStore(table);
    for (const record of records) {
      store.put(record);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Marca um registro como soft-deleted localmente
 */
export async function softDelete(table, id) {
  const existing = await getById(table, id);
  if (!existing) return false;
  
  return putRecord(table, {
    ...existing,
    is_deleted: true,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Limpa TODOS os dados de uma tabela (usado no full reload inicial)
 */
export async function clearTable(table) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readwrite');
    tx.objectStore(table).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Remove registros soft-deleted mais antigos que N dias (garbage collection)
 */
export async function purgeDeletedOlderThan(table, days = 7) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const all = await getAll(table, { includeDeleted: true });
  const toPurge = all.filter(r => r.is_deleted && r.updated_at < cutoff);
  
  if (toPurge.length === 0) return 0;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readwrite');
    const store = tx.objectStore(table);
    for (const record of toPurge) {
      store.delete(record.id);
    }
    tx.oncomplete = () => resolve(toPurge.length);
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Mutation Queue ─────────────────────────────────────────────────────────────

/**
 * Adiciona uma mutação à fila de envio ao servidor
 */
export async function enqueueMutation(mutation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutation_queue', 'readwrite');
    const record = {
      ...mutation,
      status: 'pending',
      retry_count: 0,
      next_retry_at: Date.now(),
      created_at: new Date().toISOString(),
      last_error: null,
    };
    const req = tx.objectStore('mutation_queue').add(record);
    req.onsuccess = () => resolve(req.result); // Retorna o ID gerado
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retorna todas as mutações pendentes prontas para envio
 */
export async function getPendingMutations() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutation_queue', 'readonly');
    const req = tx.objectStore('mutation_queue').getAll();
    req.onsuccess = () => {
      const now = Date.now();
      const pending = (req.result || [])
        .filter(m => m.status === 'pending' && m.next_retry_at <= now)
        .sort((a, b) => a.queue_id - b.queue_id); // FIFO
      resolve(pending);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Conta total de mutações pendentes (para UI indicator)
 */
export async function countPendingMutations() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutation_queue', 'readonly');
    const req = tx.objectStore('mutation_queue').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove uma mutação da fila (após envio com sucesso)
 */
export async function removeMutation(queueId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutation_queue', 'readwrite');
    tx.objectStore('mutation_queue').delete(queueId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Atualiza uma mutação na fila (retry count, backoff, erro)
 */
export async function updateMutation(queueId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutation_queue', 'readwrite');
    const store = tx.objectStore('mutation_queue');
    const getReq = store.get(queueId);
    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, ...updates });
      }
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Sync Metadata ──────────────────────────────────────────────────────────────

/**
 * Obtém o timestamp da última sincronização para uma tabela
 */
export async function getLastSyncAt(table) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('_sync_meta', 'readonly');
    const req = tx.objectStore('_sync_meta').get(`last_sync_${table}`);
    req.onsuccess = () => resolve(req.result?.value || null);
    req.onerror = () => resolve(null);
  });
}

/**
 * Grava o timestamp da última sincronização
 */
export async function setLastSyncAt(table, timestamp) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('_sync_meta', 'readwrite');
    tx.objectStore('_sync_meta').put({ key: `last_sync_${table}`, value: timestamp });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Verifica se o initial load já foi feito para uma tabela
 */
export async function hasInitialLoad(table) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('_sync_meta', 'readonly');
    const req = tx.objectStore('_sync_meta').get(`initial_load_${table}`);
    req.onsuccess = () => resolve(!!req.result?.value);
    req.onerror = () => resolve(false);
  });
}

/**
 * Marca que o initial load foi feito
 */
export async function setInitialLoadDone(table) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('_sync_meta', 'readwrite');
    tx.objectStore('_sync_meta').put({ key: `initial_load_${table}`, value: true });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Reseta completamente todo o banco local (logout / trocar conta)
 */
export async function resetDatabase() {
  const db = await openDB();
  const storeNames = [...db.objectStoreNames];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// Exporta lista de tabelas conhecidas para uso externo
export const KNOWN_TABLES = Object.keys(TABLE_SCHEMAS);
