/**
 * WorkerRealtimeManager — Supabase Realtime with Batch Notify (inside Web Worker)
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * 🔒 RUNS ONLY INSIDE THE WEB WORKER.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * KEY OPTIMIZATION: Event Batching
 * 
 * Problem: If a user imports 200 records, Supabase Realtime fires 200 events
 *          in rapid succession. If each event triggers a UI re-render, the
 *          browser freezes completely (200 re-renders in <1 second).
 * 
 * Solution: The Batcher collects all events within a 500ms window,
 *           then sends a SINGLE "TABLE_DATA" message to the Main Thread
 *           with the full dataset. This means 200 events → 1 re-render.
 * 
 * Additionally, per-record debounce (300ms) prevents duplicate processing
 * when the same record is updated multiple times rapidly.
 */

import {
  getAll,
  getById,
  putRecord,
  getLastSyncAt,
  setLastSyncAt,
} from './WorkerSyncDatabase.js';

// ─── State ──────────────────────────────────────────────────────────────────────

let _supabase = null;
const _channels = {};           // table → RealtimeChannel
const _debounceTimers = {};     // `table_id` → timer
const _batchTimers = {};        // table → timer
const _batchDirty = {};         // table → boolean (has pending changes)
let _notifyCallback = null;     // Callback to send TABLE_DATA to Main Thread
let _autoHealCallback = null;   // Callback for auto-heal events

// ─── Configuration ──────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 300;        // Per-record debounce
const BATCH_WINDOW_MS = 500;    // Batch window for UI notifications

// ─── Init ───────────────────────────────────────────────────────────────────────

export function setSupabaseClient(client) {
  _supabase = client;
}

/**
 * Set callback for sending batched table data to the Main Thread.
 * Called with: { table, data }
 */
export function setNotifyCallback(cb) {
  _notifyCallback = cb;
}

/**
 * Set callback for auto-heal events.
 */
export function setAutoHealCallback(cb) {
  _autoHealCallback = cb;
}

// ─── Subscribe / Unsubscribe ────────────────────────────────────────────────────

/**
 * Subscribe to Supabase Realtime events for a table.
 * Events are debounced per-record and batched per-table.
 */
export function subscribe(table) {
  if (_channels[table] || !_supabase) return;

  const channelName = `sync-v4-rt-${table}`;
  const channel = _supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      handleRealtimeEvent(table, payload);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Realtime] Connected: ${table}`);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`[Realtime] Channel error: ${table}`);
      }
    });

  _channels[table] = channel;
}

/**
 * Unsubscribe from a table's Realtime channel
 */
export function unsubscribe(table) {
  const channel = _channels[table];
  if (channel && _supabase) {
    _supabase.removeChannel(channel);
    delete _channels[table];
  }
  // Clean up timers
  const batchTimer = _batchTimers[table];
  if (batchTimer) {
    clearTimeout(batchTimer);
    delete _batchTimers[table];
  }
}

/**
 * Unsubscribe from ALL channels (logout/destroy)
 */
export function unsubscribeAll() {
  for (const table of Object.keys(_channels)) {
    unsubscribe(table);
  }
  // Clean up all debounce timers
  for (const key of Object.keys(_debounceTimers)) {
    clearTimeout(_debounceTimers[key]);
    delete _debounceTimers[key];
  }
}

// ─── Event Handling ─────────────────────────────────────────────────────────────

/**
 * Handle a Realtime event with per-record DEBOUNCE.
 * If the same record receives multiple updates within 300ms, only the last is processed.
 */
function handleRealtimeEvent(table, payload) {
  const record = payload.new || payload.old;
  if (!record?.id) return;

  const debounceKey = `${table}_${record.id}`;

  // Clear any existing debounce timer for this specific record
  if (_debounceTimers[debounceKey]) {
    clearTimeout(_debounceTimers[debounceKey]);
  }

  // Debounce: wait 300ms before processing
  _debounceTimers[debounceKey] = setTimeout(async () => {
    delete _debounceTimers[debounceKey];

    try {
      await applyRealtimeChange(table, payload);
    } catch (err) {
      console.error(`[Realtime] Apply error (${table}):`, err.message);

      // If IndexedDB write failed, trigger auto-heal
      if (err.name === 'DataError' || err.name === 'ConstraintError' || err.name === 'InvalidStateError') {
        _autoHealCallback?.({ table, action: 'corruption_detected', error: err.message });
      }
    }
  }, DEBOUNCE_MS);
}

/**
 * Apply a single Realtime change to IndexedDB using Last-Write-Wins.
 * Then schedule a BATCHED notification to the Main Thread.
 */
async function applyRealtimeChange(table, payload) {
  const { eventType } = payload;
  const serverRecord = payload.new;

  if (!serverRecord?.id && eventType !== 'DELETE') return;

  if (eventType === 'DELETE') {
    // Hard delete from server → soft-delete locally
    const oldRecord = payload.old;
    if (oldRecord?.id) {
      const existing = await getById(table, oldRecord.id);
      if (existing) {
        await putRecord(table, {
          ...existing,
          is_deleted: true,
          updated_at: new Date().toISOString(),
        });
      }
    }
  } else {
    // INSERT or UPDATE — Last-Write-Wins
    const localRecord = await getById(table, serverRecord.id);

    if (!localRecord) {
      // New record — write directly
      await putRecord(table, serverRecord);
    } else {
      const serverTime = new Date(serverRecord.updated_at).getTime();
      const localTime = new Date(localRecord.updated_at).getTime();

      if (serverTime >= localTime) {
        // Server wins
        await putRecord(table, serverRecord);
      }
      // If local is newer, skip (MutationQueue will push our version)
    }

    // Advance the delta cursor if needed
    const currentLastSync = await getLastSyncAt(table);
    if (!currentLastSync || serverRecord.updated_at > currentLastSync) {
      await setLastSyncAt(table, serverRecord.updated_at);
    }
  }

  // ── Schedule BATCHED notification ──
  scheduleBatchNotify(table);
}

// ─── Batch Notification ─────────────────────────────────────────────────────────

/**
 * Schedule a batched notification for a table.
 * 
 * If this table already has a pending batch timer, we just mark it dirty.
 * When the timer fires, it reads ALL data from IndexedDB and sends a single
 * TABLE_DATA message to the Main Thread.
 * 
 * This means: 100 rapid events → 1 postMessage → 1 React re-render ✓
 */
function scheduleBatchNotify(table) {
  _batchDirty[table] = true;

  if (_batchTimers[table]) {
    // Timer already running — the dirty flag will ensure data is fresh when it fires
    return;
  }

  _batchTimers[table] = setTimeout(async () => {
    delete _batchTimers[table];

    if (!_batchDirty[table]) return;
    _batchDirty[table] = false;

    try {
      const data = await getAll(table);
      _notifyCallback?.({ table, data });
    } catch (err) {
      console.error(`[Realtime] Batch notify error (${table}):`, err.message);
    }
  }, BATCH_WINDOW_MS);
}

/**
 * Force an immediate notification for a table (bypasses batch window).
 * Used after mutations and sync operations.
 */
export async function notifyTableNow(table) {
  // Cancel pending batch timer
  if (_batchTimers[table]) {
    clearTimeout(_batchTimers[table]);
    delete _batchTimers[table];
  }
  _batchDirty[table] = false;

  try {
    const data = await getAll(table);
    _notifyCallback?.({ table, data });
  } catch (err) {
    console.error(`[Realtime] Immediate notify error (${table}):`, err.message);
  }
}
