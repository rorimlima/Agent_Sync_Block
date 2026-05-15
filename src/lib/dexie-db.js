/**
 * dexie-db.js — Main Thread Dexie.js Database (lightweight)
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * PURPOSE: Replaces ALL localStorage usage for table data/timestamps.
 * Uses IndexedDB via Dexie.js for reliable, quota-friendly storage.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * This module is ONLY used by the Main Thread for:
 * 1. Cache timestamps (replaces localStorage cache_ts_*)
 * 2. Sync metadata (last_sync_at per table)
 * 3. Garbage collection triggers
 * 
 * Heavy data operations (bulk read/write) are done in the Web Worker.
 * This module is intentionally lightweight.
 */

import Dexie from 'dexie';

// ─── Database Instance ──────────────────────────────────────────────────────────

const DB_NAME = 'agent_sync_meta';
const DB_VERSION = 1;

let db = null;

/**
 * Get or create the Main Thread Dexie database.
 * This is a SMALL database for metadata only.
 */
function getDB() {
  if (!db) {
    db = new Dexie(DB_NAME);
    db.version(DB_VERSION).stores({
      _cache_meta: '&key',  // Cache timestamps, sync cursors
    });
  }
  return db;
}

// ─── Cache Timestamp Operations (replaces localStorage) ─────────────────────────

/**
 * Get the cache timestamp for a table.
 * @param {string} tableName
 * @returns {Promise<number>} Timestamp in ms, or 0 if not set
 */
export async function getCacheTimestamp(tableName) {
  try {
    const meta = await getDB().table('_cache_meta').get(`cache_ts_${tableName}`);
    return meta?.value || 0;
  } catch {
    return 0;
  }
}

/**
 * Set the cache timestamp for a table to NOW.
 * @param {string} tableName
 */
export async function setCacheTimestamp(tableName) {
  try {
    await getDB().table('_cache_meta').put({
      key: `cache_ts_${tableName}`,
      value: Date.now(),
    });
  } catch (err) {
    console.warn('[DexieDB] Failed to set cache timestamp:', err.message);
  }
}

/**
 * Check if cache is fresh (within TTL in ms).
 * @param {string} tableName
 * @param {number} [ttlMs=300000] - TTL in milliseconds (default 5min)
 * @returns {Promise<boolean>}
 */
export async function isCacheFresh(tableName, ttlMs = 300000) {
  const ts = await getCacheTimestamp(tableName);
  return ts > 0 && (Date.now() - ts) < ttlMs;
}

// ─── Generic Metadata Operations ────────────────────────────────────────────────

/**
 * Get a metadata value by key.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getMeta(key) {
  try {
    const meta = await getDB().table('_cache_meta').get(key);
    return meta?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Set a metadata value.
 * @param {string} key
 * @param {any} value
 */
export async function setMeta(key, value) {
  try {
    await getDB().table('_cache_meta').put({ key, value });
  } catch (err) {
    console.warn('[DexieDB] Failed to set meta:', err.message);
  }
}

/**
 * Delete a metadata key.
 * @param {string} key
 */
export async function deleteMeta(key) {
  try {
    await getDB().table('_cache_meta').delete(key);
  } catch {}
}

// ─── Database Reset ─────────────────────────────────────────────────────────────

/**
 * Clear all metadata (used on logout).
 */
export async function clearAllMeta() {
  try {
    await getDB().table('_cache_meta').clear();
  } catch {}
}

/**
 * Delete and recreate the metadata database entirely.
 */
export async function resetMetaDatabase() {
  if (db) {
    db.close();
    db = null;
  }
  await Dexie.delete(DB_NAME);
}
