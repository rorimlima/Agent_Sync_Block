/**
 * WorkerSyncDatabase — Dexie.js IndexedDB inside the Web Worker
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * 🔒 THIS MODULE RUNS ONLY INSIDE THE WEB WORKER. NEVER IMPORT ON MAIN THREAD.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Responsibilities:
 * - Local offline database (IndexedDB via Dexie.js for max performance)
 * - Optimized indices for Delta Sync (updated_at, is_deleted)
 * - Mutation queue (pending writes to Supabase)
 * - Sync metadata (_sync_meta) for cursor tracking
 * - Auto-heal: corruption detection and recovery
 */

import Dexie from 'dexie';

// ─── Database Schema ────────────────────────────────────────────────────────────

const DB_NAME = 'agent_sync_v4';
const DB_VERSION = 1;

// Dexie schema: only indexed fields are declared. Non-indexed fields are stored automatically.
// '&' = unique, '+' = auto-increment, '*' = multi-entry, '++' = auto-increment primary key
const SCHEMA = {
  // ── Data Tables ──
  clientes:            '&id, updated_at, is_deleted, cod_cliente',
  vendas:              '&id, updated_at, is_deleted, cod_cliente, placa',
  veiculos_bloqueados: '&id, updated_at, is_deleted, placa, status_final',
  audit_logs:          '&id, updated_at, is_deleted, created_at',

  colaboradores:       '&id, updated_at, is_deleted, auth_user_id',

  // ── Internal Stores ──
  _mutation_queue:     '++queue_id, status, table, next_retry_at',
  _sync_meta:          '&key',
};

// List of data tables (excludes internal stores)
export const DATA_TABLES = [
  'clientes', 'vendas', 'veiculos_bloqueados',
  'audit_logs', 'colaboradores',
];

// ─── Singleton DB Instance ──────────────────────────────────────────────────────

let db = null;

/**
 * Get or create the Dexie database instance.
 * Dexie handles connection pooling internally.
 */
export function getDB() {
  if (!db) {
    db = new Dexie(DB_NAME);
    db.version(DB_VERSION).stores(SCHEMA);

    // Handle blocked/closed scenarios
    db.on('blocked', () => {
      console.warn('[WorkerDB] Database blocked — another tab may be upgrading');
    });
  }
  return db;
}

// ─── Data Operations ────────────────────────────────────────────────────────────

/**
 * Get all records from a table (excluding soft-deletes by default)
 * @param {string} table
 * @param {Object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {Promise<Array>}
 */
export async function getAll(table, { includeDeleted = false } = {}) {
  const d = getDB();
  const all = await d.table(table).toArray();
  if (includeDeleted) return all;
  // Filter in JS — more reliable than Dexie's where().notEqual() for booleans
  // Dexie can silently drop records where is_deleted is undefined/null
  return all.filter(r => !r.is_deleted);
}

/**
 * Get a single record by ID
 */
export async function getById(table, id) {
  return getDB().table(table).get(id) || null;
}

/**
 * Upsert a single record (put = insert or replace)
 */
export async function putRecord(table, record) {
  await getDB().table(table).put(record);
  return true;
}

/**
 * Bulk upsert — used by Delta Sync and Initial Load.
 * Dexie's bulkPut is highly optimized (single transaction, batch write).
 */
export async function putRecordsBatch(table, records) {
  if (!records || records.length === 0) return 0;
  await getDB().table(table).bulkPut(records);
  return records.length;
}

/**
 * Clear all records in a table
 */
export async function clearTable(table) {
  await getDB().table(table).clear();
}

/**
 * Count records in a table (fast, uses index)
 */
export async function countRecords(table) {
  return getDB().table(table).count();
}

/**
 * Purge soft-deleted records older than N days (garbage collection)
 */
export async function purgeDeletedOlderThan(table, days = 7) {
  const cutoffISO = new Date(Date.now() - days * 86400000).toISOString();
  const d = getDB();

  const toDelete = await d.table(table)
    .filter(r => r.is_deleted === true && r.updated_at < cutoffISO)
    .primaryKeys();

  if (toDelete.length > 0) {
    await d.table(table).bulkDelete(toDelete);
  }
  return toDelete.length;
}

// ─── Mutation Queue ─────────────────────────────────────────────────────────────

/**
 * Enqueue a mutation for background sync to Supabase
 * @returns {number} The auto-generated queue_id
 */
export async function enqueueMutation(mutation) {
  return getDB().table('_mutation_queue').add({
    ...mutation,
    status: 'pending',
    retry_count: 0,
    next_retry_at: Date.now(),
    created_at: new Date().toISOString(),
    last_error: null,
  });
}

/**
 * Get all pending mutations ready for processing (FIFO order)
 */
export async function getPendingMutations() {
  const now = Date.now();
  return getDB().table('_mutation_queue')
    .where('status').equals('pending')
    .filter(m => m.next_retry_at <= now)
    .sortBy('queue_id'); // FIFO
}

/**
 * Count pending mutations (for UI indicator)
 */
export async function countPendingMutations() {
  return getDB().table('_mutation_queue')
    .where('status').equals('pending')
    .count();
}

/**
 * Remove a mutation after successful sync
 */
export async function removeMutation(queueId) {
  await getDB().table('_mutation_queue').delete(queueId);
}

/**
 * Update mutation (retry count, backoff, error message)
 */
export async function updateMutation(queueId, updates) {
  await getDB().table('_mutation_queue').update(queueId, updates);
}

/**
 * Move permanently failed mutations to 'failed' status
 */
export async function failMutation(queueId, errorMessage) {
  await getDB().table('_mutation_queue').update(queueId, {
    status: 'failed',
    last_error: errorMessage,
  });
}

// ─── Sync Metadata ──────────────────────────────────────────────────────────────

/**
 * Get the last sync timestamp for a table
 */
export async function getLastSyncAt(table) {
  const meta = await getDB().table('_sync_meta').get(`last_sync_${table}`);
  return meta?.value || null;
}

/**
 * Set the last sync timestamp
 */
export async function setLastSyncAt(table, timestamp) {
  await getDB().table('_sync_meta').put({
    key: `last_sync_${table}`,
    value: timestamp,
  });
}

/**
 * Check if initial load has been completed for a table
 */
export async function hasInitialLoad(table) {
  const meta = await getDB().table('_sync_meta').get(`initial_load_${table}`);
  return !!meta?.value;
}

/**
 * Mark initial load as complete
 */
export async function setInitialLoadDone(table) {
  await getDB().table('_sync_meta').put({
    key: `initial_load_${table}`,
    value: true,
  });
}

// ─── Auto-Heal ──────────────────────────────────────────────────────────────────

/**
 * Verify database integrity for a table.
 * Returns { ok: boolean, error?: string }
 */
export async function verifyIntegrity(table) {
  try {
    // Try a simple read operation
    const count = await getDB().table(table).count();
    // Try reading a small sample
    await getDB().table(table).limit(1).toArray();
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Full database reset — deletes and recreates everything.
 * Used for auto-heal after corruption or on logout.
 */
export async function resetDatabase() {
  if (db) {
    db.close();
    db = null;
  }
  await Dexie.delete(DB_NAME);
  // Re-initialize
  getDB();
}

/**
 * Reset a single table (clear data + metadata).
 * Used for targeted auto-heal.
 */
export async function resetTable(table) {
  const d = getDB();
  await d.table(table).clear();
  await d.table('_sync_meta').delete(`last_sync_${table}`);
  await d.table('_sync_meta').delete(`initial_load_${table}`);
}
