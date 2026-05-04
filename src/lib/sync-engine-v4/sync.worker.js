/**
 * sync.worker.js — The Web Worker entry point for the Sync Engine v4
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * THIS FILE RUNS IN AN ISOLATED WEB WORKER THREAD.
 * It has NO access to the DOM, window, or React.
 * It HAS access to: IndexedDB, fetch, WebSocket, crypto, timers.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Role: Message Router
 * - Receives commands from Main Thread via postMessage
 * - Routes to the appropriate module (DeltaSync, MutationQueue, Realtime)
 * - Sends responses/events back to Main Thread via postMessage
 * 
 * This is the ONLY file that uses `self.onmessage` and `self.postMessage`.
 */

import { createClient } from '@supabase/supabase-js';

import {
  getAll,
  getById,
  resetDatabase,
  resetTable,
  DATA_TABLES,
} from './WorkerSyncDatabase.js';

import {
  setSupabaseClient as setDeltaSupabase,
  syncTable,
  forceDeltaSync,
  forceHardSync,
  runGarbageCollection,
} from './WorkerDeltaSync.js';

import {
  setSupabaseClient as setMutationSupabase,
  setStatusCallback,
  mutate,
  forceProcess,
  onOnline,
  destroy as destroyMutationQueue,
} from './WorkerMutationQueue.js';

import {
  setSupabaseClient as setRealtimeSupabase,
  setNotifyCallback,
  setAutoHealCallback,
  subscribe as realtimeSubscribe,
  unsubscribe as realtimeUnsubscribe,
  unsubscribeAll,
  notifyTableNow,
} from './WorkerRealtimeManager.js';

// ─── Supabase Client (created inside the Worker) ────────────────────────────────

let supabase = null;

function initSupabase(config) {
  if (supabase) return;

  supabase = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false, // Worker doesn't need session persistence
      autoRefreshToken: false,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
    global: {
      headers: { 'x-client-info': 'agent-sync-block-worker' },
    },
  });

  // Inject Supabase client into all modules
  setDeltaSupabase(supabase);
  setMutationSupabase(supabase);
  setRealtimeSupabase(supabase);
}

// ─── Callbacks to Main Thread ───────────────────────────────────────────────────

// Send a message to the Main Thread
function postToMain(msg) {
  self.postMessage(msg);
}

// Wire up callbacks
setStatusCallback((statusData) => {
  postToMain({ type: 'SYNC_STATUS', ...statusData });
});

setNotifyCallback(({ table, data }) => {
  postToMain({ type: 'TABLE_DATA', table, data });
});

setAutoHealCallback(async ({ table, action, error }) => {
  console.warn(`[Worker] Auto-heal triggered for "${table}": ${action}`);
  postToMain({ type: 'AUTO_HEAL', table, action, error });

  // Automatically attempt recovery
  try {
    await resetTable(table);
    const result = await forceHardSync(table);
    await notifyTableNow(table);
    postToMain({ type: 'AUTO_HEAL', table, action: 'recovered', count: result.count });
  } catch (healErr) {
    postToMain({ type: 'ERROR', table, message: `Auto-heal failed: ${healErr.message}` });
  }
});

// ─── Tables being tracked ───────────────────────────────────────────────────────

let _activeTables = [];
let _tableFilters = {};

// ─── Message Router ─────────────────────────────────────────────────────────────

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  try {
    switch (msg.type) {

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // INIT — Initialize the Sync Engine with tables and Supabase config
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'INIT': {
        const { tables, filters = {}, supabaseConfig } = msg;

        // Initialize Supabase client inside Worker
        initSupabase(supabaseConfig);

        _activeTables = tables;
        _tableFilters = filters;

        // Sync all tables in parallel
        const results = await Promise.allSettled(
          tables.map(async (table) => {
            try {
              const result = await syncTable(table, {
                filter: filters[table],
                onProgress: (progress) => {
                  postToMain({ type: 'SYNC_PROGRESS', ...progress });
                },
              });

              // Subscribe to Realtime
              realtimeSubscribe(table);

              // Send initial data to Main Thread
              await notifyTableNow(table);

              return { table, ...result };
            } catch (err) {
              console.error(`[Worker] Init sync failed for "${table}":`, err);

              // Even on error, send whatever is in cache
              try {
                await notifyTableNow(table);
              } catch {}

              return { table, source: 'cache', count: 0, error: err.message };
            }
          })
        );

        // Schedule garbage collection in 30s (non-blocking)
        setTimeout(async () => {
          try {
            await runGarbageCollection(tables);
          } catch {}
        }, 30000);

        postToMain({
          type: 'INIT_READY',
          results: results.map(r => r.value || r.reason),
        });
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // MUTATE — Optimistic write
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'MUTATE': {
        const { table, operation, record, options = {}, requestId } = msg;

        const localRecord = await mutate(table, operation, record, options);

        // Notify Main Thread about the table change immediately
        await notifyTableNow(table);

        // Also notify side-effect tables
        if (options.sideEffects) {
          const affectedTables = new Set(options.sideEffects.map(e => e.table));
          for (const t of affectedTables) {
            await notifyTableNow(t);
          }
        }

        postToMain({
          type: 'MUTATE_RESULT',
          table,
          record: localRecord,
          requestId,
        });
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // FORCE_DELTA — Manual delta sync (pull-to-refresh)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'FORCE_DELTA': {
        const { table, requestId } = msg;

        const result = await forceDeltaSync(table, {
          filter: _tableFilters[table],
        });
        await notifyTableNow(table);

        postToMain({
          type: 'DELTA_RESULT',
          table,
          ...result,
          requestId,
        });
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // HARD_SYNC — Full reload (auto-heal or manual reset)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'HARD_SYNC': {
        const { table, requestId } = msg;

        const result = await forceHardSync(table, {
          filter: _tableFilters[table],
        });
        await notifyTableNow(table);

        postToMain({
          type: 'HARD_SYNC_RESULT',
          table,
          ...result,
          requestId,
        });
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // GET_ALL — Read all records from a table
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'GET_ALL': {
        const { table, requestId } = msg;
        const data = await getAll(table);
        postToMain({ type: 'GET_ALL_RESULT', table, data, requestId });
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // SUBSCRIBE — Start receiving TABLE_DATA events for a table
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'SUBSCRIBE': {
        const { table } = msg;
        await notifyTableNow(table);
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ONLINE — Connection restored
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'ONLINE': {
        onOnline();
        // Also run a delta sync on all active tables
        for (const table of _activeTables) {
          try {
            await forceDeltaSync(table, { filter: _tableFilters[table] });
            await notifyTableNow(table);
          } catch {}
        }
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // OFFLINE — Connection lost
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'OFFLINE': {
        postToMain({ type: 'SYNC_STATUS', status: 'offline', pendingCount: 0 });
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // VISIBILITY_CHANGE — Tab became visible (refetch stale data)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'VISIBILITY_VISIBLE': {
        // Run delta sync on all active tables when tab regains focus
        for (const table of _activeTables) {
          try {
            await forceDeltaSync(table, { filter: _tableFilters[table] });
            await notifyTableNow(table);
          } catch {}
        }
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // FORCE_PROCESS — Force mutation queue processing
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'FORCE_PROCESS': {
        forceProcess();
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // RESET_DATABASE — Full reset (logout)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'RESET_DATABASE': {
        await resetDatabase();
        postToMain({ type: 'RESET_DONE' });
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // DESTROY — Complete shutdown
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'DESTROY': {
        unsubscribeAll();
        destroyMutationQueue();
        _activeTables = [];
        _tableFilters = {};
        postToMain({ type: 'DESTROYED' });
        break;
      }

      default:
        console.warn(`[Worker] Unknown message type: ${msg.type}`);
    }
  } catch (err) {
    console.error(`[Worker] Error handling message "${msg.type}":`, err);
    postToMain({
      type: 'ERROR',
      message: err.message,
      table: msg.table,
      requestId: msg.requestId,
    });
  }
};

// ─── Worker Ready Signal ────────────────────────────────────────────────────────

postToMain({ type: 'WORKER_READY' });
console.log('[Worker] Sync Engine v4 Worker initialized');
