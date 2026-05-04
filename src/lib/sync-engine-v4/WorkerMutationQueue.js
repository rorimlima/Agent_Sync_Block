/**
 * WorkerMutationQueue — Background Mutation Queue with Exponential Backoff
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * 🔒 RUNS ONLY INSIDE THE WEB WORKER.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Architecture:
 * 1. UI calls mutate() via postMessage → Worker applies optimistically to IndexedDB
 * 2. Mutation is enqueued for background push to Supabase
 * 3. Queue processor runs with exponential backoff (2s, 4s, 8s... max 5min)
 * 4. When connection returns (online event), queue auto-resumes
 * 
 * Key design:
 * - Mutations are persisted in IndexedDB → survive page refresh
 * - FIFO order guarantees causal consistency
 * - Idempotent upserts prevent duplicate-key errors
 */

import {
  getById,
  putRecord,
  enqueueMutation,
  getPendingMutations,
  removeMutation,
  updateMutation,
  failMutation,
  countPendingMutations,
} from './WorkerSyncDatabase.js';

// ─── Configuration ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 10;         // Max retries before marking as 'failed'
const BACKOFF_BASE_MS = 2000;   // 2s base
const BACKOFF_MAX_MS = 300000;  // 5min max
const PROCESS_INTERVAL_MS = 5000; // Re-check interval when items pending

// ─── State ──────────────────────────────────────────────────────────────────────

let _supabase = null;
let _isSyncing = false;
let _processTimer = null;
let _statusCallback = null;       // Callback to notify the Worker router
let _currentStatus = 'idle';      // 'idle' | 'syncing' | 'error' | 'offline'
let _pendingCount = 0;

// ─── Init ───────────────────────────────────────────────────────────────────────

export function setSupabaseClient(client) {
  _supabase = client;
}

/**
 * Set the callback that the Worker router uses to relay status to the Main Thread
 */
export function setStatusCallback(cb) {
  _statusCallback = cb;
}

function emitStatus() {
  _statusCallback?.({
    status: _currentStatus,
    pendingCount: _pendingCount,
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Optimistic Mutation — the MAIN entry point for all writes.
 * 
 * 1. Applies the change to IndexedDB INSTANTLY (optimistic)
 * 2. Enqueues the mutation for background push to Supabase
 * 3. Returns the local record immediately (UI can use it)
 * 
 * @param {string} table - Supabase table name
 * @param {'INSERT'|'UPDATE'|'DELETE'} operation
 * @param {Object} record - Record data (must have 'id' for UPDATE/DELETE)
 * @param {Object} [options]
 * @param {Object} [options.supabasePayload] - Custom payload for Supabase
 * @param {Array}  [options.sideEffects] - Additional mutations to enqueue
 * 
 * @returns {Promise<Object>} The local record (optimistic version)
 */
export async function mutate(table, operation, record, options = {}) {
  const now = new Date().toISOString();
  let localRecord;

  // ── Step 1: Apply optimistically to IndexedDB ──
  if (operation === 'DELETE') {
    const existing = await getById(table, record.id);
    if (existing) {
      localRecord = { ...existing, is_deleted: true, updated_at: now };
      await putRecord(table, localRecord);
    } else {
      localRecord = { id: record.id, is_deleted: true, updated_at: now };
    }
  } else if (operation === 'INSERT') {
    localRecord = {
      ...record,
      id: record.id || crypto.randomUUID(),
      created_at: record.created_at || now,
      updated_at: now,
      is_deleted: false,
    };
    await putRecord(table, localRecord);
  } else {
    // UPDATE — merge with existing
    const existing = await getById(table, record.id);
    localRecord = {
      ...(existing || {}),
      ...record,
      updated_at: now,
    };
    await putRecord(table, localRecord);
  }

  // ── Step 2: Enqueue for background push ──
  const supabasePayload = options.supabasePayload || record;
  await enqueueMutation({
    table,
    operation: operation === 'DELETE' ? 'UPDATE' : operation, // Soft delete → UPDATE
    payload: operation === 'DELETE'
      ? { id: record.id, is_deleted: true, updated_at: now }
      : { ...supabasePayload, id: localRecord.id, updated_at: now },
  });

  // ── Step 3: Process side effects ──
  if (options.sideEffects) {
    for (const effect of options.sideEffects) {
      const effectNow = new Date().toISOString();
      if (effect.record?.id) {
        const existingEffect = await getById(effect.table, effect.record.id);
        if (existingEffect) {
          await putRecord(effect.table, {
            ...existingEffect,
            ...effect.record,
            updated_at: effectNow,
          });
        }
      }
      await enqueueMutation({
        table: effect.table,
        operation: effect.operation || 'UPDATE',
        payload: {
          ...(effect.supabasePayload || effect.record),
          updated_at: effectNow,
        },
      });
    }
  }

  // ── Step 4: Update count and schedule processing ──
  _pendingCount = await countPendingMutations();
  emitStatus();
  scheduleProcess(100); // Process in 100ms (don't block Worker event loop)

  return localRecord;
}

// ─── Queue Processor ────────────────────────────────────────────────────────────

function scheduleProcess(delayMs = PROCESS_INTERVAL_MS) {
  if (_processTimer) clearTimeout(_processTimer);
  _processTimer = setTimeout(() => processQueue(), delayMs);
}

async function processQueue() {
  if (_isSyncing) return;
  if (!_supabase) return;

  _isSyncing = true;
  _currentStatus = 'syncing';
  emitStatus();

  try {
    const pending = await getPendingMutations();

    if (pending.length === 0) {
      _currentStatus = 'idle';
      _pendingCount = 0;
      emitStatus();
      return;
    }

    for (const job of pending) {
      try {
        await executeServerMutation(job);
        await removeMutation(job.queue_id);
        _pendingCount = Math.max(0, _pendingCount - 1);
        emitStatus();
      } catch (error) {
        console.error(`[MutationQueue] Failed:`, error.message);

        if (job.retry_count >= MAX_RETRIES) {
          // Too many retries — mark as permanently failed
          console.error(`[MutationQueue] Max retries reached for job ${job.queue_id}. Marking as failed.`);
          await failMutation(job.queue_id, error.message);
          _pendingCount = Math.max(0, _pendingCount - 1);
          emitStatus();
          continue;
        }

        // Exponential backoff
        const backoffDelay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, job.retry_count),
          BACKOFF_MAX_MS
        );

        await updateMutation(job.queue_id, {
          retry_count: job.retry_count + 1,
          next_retry_at: Date.now() + backoffDelay,
          last_error: error.message,
        });
      }
    }
  } catch (err) {
    console.error('[MutationQueue] Processing error:', err);
    _currentStatus = 'error';
    emitStatus();
  } finally {
    _isSyncing = false;

    // Re-schedule if items remain
    const remaining = await countPendingMutations();
    _pendingCount = remaining;
    if (remaining > 0) {
      _currentStatus = 'idle';
      scheduleProcess(PROCESS_INTERVAL_MS);
    } else {
      _currentStatus = 'idle';
    }
    emitStatus();
  }
}

/**
 * Execute a single mutation against Supabase
 */
async function executeServerMutation(job) {
  const { table, operation, payload } = job;

  if (operation === 'INSERT') {
    // Upsert for idempotency (handles retry after partial success)
    const { error } = await _supabase.from(table).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  } else if (operation === 'UPDATE') {
    const { id, ...fields } = payload;
    if (!id) throw new Error('UPDATE without ID');
    const { error } = await _supabase.from(table).update(fields).eq('id', id);
    if (error) throw error;
  }
}

// ─── External Controls ──────────────────────────────────────────────────────────

/**
 * Force immediate queue processing
 */
export function forceProcess() {
  scheduleProcess(0);
}

/**
 * Trigger processing when connectivity resumes
 */
export function onOnline() {
  console.log('[MutationQueue] Online — resuming queue processing');
  _currentStatus = 'idle';
  scheduleProcess(500);
}

/**
 * Get current status snapshot
 */
export function getStatus() {
  return { status: _currentStatus, pendingCount: _pendingCount };
}

/**
 * Stop queue processing (shutdown)
 */
export function destroy() {
  if (_processTimer) {
    clearTimeout(_processTimer);
    _processTimer = null;
  }
  _isSyncing = false;
  _currentStatus = 'idle';
  _pendingCount = 0;
}
