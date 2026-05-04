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
let _isInitialized = false; // True after first successful INIT completes

/**
 * The current access token from the Main Thread.
 * 
 * Updated on INIT (from the auth session) and on TOKEN_REFRESH events.
 * Used by the `accessToken` callback in the Supabase client constructor
 * to authenticate every REST/Realtime request.
 */
let _currentAccessToken = null;

/**
 * Initialize Supabase client inside the Worker.
 * CRITICAL: Must also receive auth tokens to bypass RLS.
 * 
 * AUTH STRATEGY:
 * Instead of using supabase.auth.setSession() (which requires a storage
 * backend, session validation, and can fail with "Auth session missing!"),
 * we use the `accessToken` constructor option — a callback function that
 * supabase-js calls on EVERY request to get the current JWT.
 * 
 * This is the official pattern for environments without localStorage
 * (Web Workers, Edge Functions, Service Workers, etc.).
 * 
 * SAFE TO CALL MULTIPLE TIMES:
 * - Creates the client only once (token updates via the closure)
 * - Always re-injects the client into all modules (fixes StrictMode)
 */
async function initSupabase(config) {
  // Update the token variable (closure captured by accessToken callback)
  if (config.accessToken) {
    _currentAccessToken = config.accessToken;
  }

  // Create the client only once
  if (!supabase) {
    supabase = createClient(config.url, config.anonKey, {
      // ── accessToken callback — the KEY to Worker auth ──
      // supabase-js calls this on every REST/Realtime request.
      // Returns the user's JWT if available, null otherwise (falls back to anonKey).
      accessToken: async () => _currentAccessToken || null,
      auth: {
        persistSession: false,       // No storage needed
        autoRefreshToken: false,     // Main Thread manages refresh
        detectSessionInUrl: false,   // Worker has no URL
      },
      realtime: {
        params: { eventsPerSecond: 5 },
      },
      global: {
        headers: { 'x-client-info': 'agent-sync-block-worker' },
      },
    });

    console.log('[Worker] Supabase client created with accessToken callback');
  }

  // ── ALWAYS inject the client into all modules ──
  // This is critical for React StrictMode (double-render) where the first
  // INIT creates the client but the cleanup destroys the modules' references,
  // then the second INIT skipped injection because of `if (supabase) return`.
  setDeltaSupabase(supabase);
  setMutationSupabase(supabase);
  setRealtimeSupabase(supabase);

  if (_currentAccessToken) {
    console.log('[Worker] Auth token set via accessToken callback');
  } else {
    console.warn('[Worker] No auth tokens provided — queries will use anon key (RLS may block data)');
  }
}

/**
 * Refresh the auth token inside the Worker.
 * Called when the Main Thread detects a token refresh.
 * 
 * Simply updates the variable — the next request from supabase-js
 * will call the accessToken callback and get the new token.
 */
function refreshAuth(accessToken, _refreshToken) {
  _currentAccessToken = accessToken;
  console.log('[Worker] Auth token refreshed via callback');
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

// ─── INIT lock to prevent concurrent INIT processing ────────────────────────────

let _initPromise = null;

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
        const { tables, filters = {}, supabaseConfig, requestId } = msg;

        // If an INIT is already running, wait for it to finish first
        if (_initPromise) {
          console.log('[Worker] INIT already running — waiting for completion...');
          try { await _initPromise; } catch {}
        }

        // Wrap the init in a trackable promise
        _initPromise = (async () => {
          // Initialize Supabase client inside Worker (includes auth session)
          await initSupabase(supabaseConfig);

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

          _isInitialized = true;

          // Schedule garbage collection in 30s (non-blocking)
          setTimeout(async () => {
            try {
              await runGarbageCollection(tables);
            } catch {}
          }, 30000);

          return results.map(r => r.value || r.reason);
        })();

        try {
          const results = await _initPromise;
          postToMain({
            type: 'INIT_READY',
            requestId,
            results,
          });
        } catch (initErr) {
          console.error('[Worker] INIT failed:', initErr);
          postToMain({
            type: 'ERROR',
            message: `INIT failed: ${initErr.message}`,
            requestId,
          });
        } finally {
          _initPromise = null;
        }
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TOKEN_REFRESH — Main Thread sends new auth tokens
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'TOKEN_REFRESH': {
        const { accessToken, refreshToken } = msg;
        await refreshAuth(accessToken, refreshToken);
        break;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // MUTATE — Optimistic write
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      case 'MUTATE': {
        const { table, operation, record, options = {}, requestId } = msg;

        // Wait for INIT to complete if it's still running
        if (_initPromise) {
          try { await _initPromise; } catch {}
        }

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

        // Wait for INIT to complete if it's still running
        if (_initPromise) {
          try { await _initPromise; } catch {}
        }

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

        // Wait for INIT to complete if it's still running
        if (_initPromise) {
          try { await _initPromise; } catch {}
        }

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
        // If INIT hasn't completed yet, wait for it before sending data
        if (_initPromise) {
          try { await _initPromise; } catch {}
        }
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
        // Only delta-sync if we've completed initial INIT
        if (!_isInitialized) break;
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
        const { requestId } = msg;
        await resetDatabase();
        _isInitialized = false;
        postToMain({ type: 'RESET_DONE', requestId });
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
        _isInitialized = false;
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
