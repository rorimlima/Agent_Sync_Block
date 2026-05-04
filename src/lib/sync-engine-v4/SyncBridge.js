/**
 * SyncBridge — Main Thread ↔ Web Worker Communication Bridge
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ THIS IS THE ONLY V4 FILE THAT RUNS ON THE MAIN THREAD.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * It is a lightweight message dispatcher that:
 * 1. Creates and manages the Web Worker lifecycle
 * 2. Provides a Promise-based API for request/response patterns
 * 3. Manages pub/sub subscriptions for table data and sync status
 * 4. Handles Worker crashes with auto-restart
 * 5. Forwards online/offline/visibility events to the Worker
 * 6. Passes auth tokens to the Worker for RLS-compatible queries
 * 
 * ZERO heavy logic runs here. All data processing is in the Worker.
 */

// ─── Singleton State ────────────────────────────────────────────────────────────

let _worker = null;
let _isReady = false;
let _isInitDone = false;      // True after the first INIT_READY is received
let _requestId = 0;
const _pendingRequests = {};         // requestId → { resolve, reject, timer }
const _tableSubscribers = {};        // table → Set<callback>
const _statusSubscribers = new Set();
const _progressSubscribers = new Set();
let _workerReadyResolve = null;
let _workerReadyPromise = null;

// ─── Worker Lifecycle ───────────────────────────────────────────────────────────

/**
 * Get or create the Worker instance.
 * Uses Next.js-compatible Worker instantiation.
 */
function getWorker() {
  if (_worker) return _worker;

  // Create worker ready promise
  _workerReadyPromise = new Promise(resolve => {
    _workerReadyResolve = resolve;
  });

  // Create the Web Worker
  // Next.js/Turbopack supports `new Worker(new URL(...), { type: 'module' })` natively
  _worker = new Worker(
    new URL('./sync.worker.js', import.meta.url),
    { type: 'module' }
  );

  // ── Handle messages FROM the Worker ──
  _worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {

      case 'WORKER_READY':
        _isReady = true;
        _workerReadyResolve?.();
        break;

      // Table data update (from Realtime batch or initial load)
      case 'TABLE_DATA': {
        const subscribers = _tableSubscribers[msg.table];
        if (subscribers) {
          subscribers.forEach(cb => {
            try { cb(msg.data); } catch {}
          });
        }
        break;
      }

      // Sync status change
      case 'SYNC_STATUS': {
        _statusSubscribers.forEach(cb => {
          try { cb({ status: msg.status, pendingCount: msg.pendingCount }); } catch {}
        });
        break;
      }

      // Sync progress (during initial load)
      case 'SYNC_PROGRESS': {
        _progressSubscribers.forEach(cb => {
          try { cb(msg); } catch {}
        });
        break;
      }

      // Auto-heal event
      case 'AUTO_HEAL': {
        console.warn(`[SyncBridge] Auto-heal: ${msg.table} — ${msg.action}`);
        break;
      }

      // Response to a request (with requestId)
      case 'MUTATE_RESULT':
      case 'DELTA_RESULT':
      case 'HARD_SYNC_RESULT':
      case 'GET_ALL_RESULT':
      case 'RESET_DONE':
      case 'DESTROYED': {
        const pending = _pendingRequests[msg.requestId];
        if (pending) {
          clearTimeout(pending.timer);
          delete _pendingRequests[msg.requestId];
          pending.resolve(msg);
        }
        break;
      }

      // INIT_READY — Special case: resolve pending AND mark init as done
      case 'INIT_READY': {
        _isInitDone = true;
        const pending = _pendingRequests[msg.requestId];
        if (pending) {
          clearTimeout(pending.timer);
          delete _pendingRequests[msg.requestId];
          pending.resolve(msg);
        }
        break;
      }

      // Error from Worker
      case 'ERROR': {
        const pending = _pendingRequests[msg.requestId];
        if (pending) {
          clearTimeout(pending.timer);
          delete _pendingRequests[msg.requestId];
          pending.reject(new Error(msg.message));
        } else {
          console.error(`[SyncBridge] Worker error: ${msg.message} (table: ${msg.table})`);
        }
        break;
      }
    }
  };

  // ── Handle Worker crashes ──
  _worker.onerror = (err) => {
    console.error('[SyncBridge] Worker crashed:', err.message);
    _isReady = false;
    _isInitDone = false;
    // Reject all pending requests
    for (const [id, p] of Object.entries(_pendingRequests)) {
      clearTimeout(p.timer);
      p.reject(new Error('Worker crashed'));
    }
    // Clear state for restart
    _worker = null;
  };

  // ── Forward browser events to the Worker ──
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      _worker?.postMessage({ type: 'ONLINE' });
    });

    window.addEventListener('offline', () => {
      _worker?.postMessage({ type: 'OFFLINE' });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        _worker?.postMessage({ type: 'VISIBILITY_VISIBLE' });
      }
    });
  }

  return _worker;
}

/**
 * Wait for the Worker to be ready
 */
async function waitForReady() {
  if (_isReady) return;
  getWorker(); // Ensure worker is created
  await _workerReadyPromise;
}

/**
 * Send a message to the Worker and get a Promise back.
 * @param {Object} msg - Message to send
 * @param {number} [timeoutMs=30000] - Timeout in ms
 * @returns {Promise<Object>}
 */
function sendRequest(msg, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++_requestId;
    const worker = getWorker();

    const timer = setTimeout(() => {
      delete _pendingRequests[id];
      reject(new Error(`Worker request timeout: ${msg.type}`));
    }, timeoutMs);

    _pendingRequests[id] = { resolve, reject, timer };

    worker.postMessage({ ...msg, requestId: id });
  });
}

/**
 * Send a fire-and-forget message to the Worker (no response expected)
 */
function sendFire(msg) {
  const worker = getWorker();
  worker.postMessage(msg);
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialize the Sync Engine.
 * Creates the Worker, connects to Supabase, syncs all tables.
 * 
 * CRITICAL: authSession must contain access_token and refresh_token
 * so the Worker's Supabase client can authenticate and bypass RLS.
 * 
 * @param {string[]} tables - Tables to sync
 * @param {Object} [tableFilters] - Filters per table
 * @param {Object} [authSession] - Supabase auth session { access_token, refresh_token }
 * @returns {Promise<Object>} Init results
 */
export async function initSync(tables, tableFilters = {}, authSession = null) {
  await waitForReady();

  return sendRequest({
    type: 'INIT',
    tables,
    filters: tableFilters,
    supabaseConfig: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      accessToken: authSession?.access_token || null,
      refreshToken: authSession?.refresh_token || null,
    },
  }, 60000); // 60s timeout for initial sync
}

/**
 * Send refreshed auth tokens to the Worker.
 * Call this whenever the Main Thread's Supabase session refreshes.
 */
export function refreshWorkerAuth(accessToken, refreshToken) {
  sendFire({ type: 'TOKEN_REFRESH', accessToken, refreshToken });
}

/**
 * Subscribe to table data changes.
 * The callback receives the full array of records (excluding soft-deletes).
 * 
 * SAFE TO CALL BEFORE INIT:
 * - The SUBSCRIBE message is sent to the Worker immediately
 * - The Worker will wait for INIT to complete before reading data
 * - Once INIT completes, the Worker will send TABLE_DATA with the full dataset
 * 
 * @param {string} table - Table name
 * @param {Function} callback - (data: Array) => void
 * @returns {Function} unsubscribe
 */
export function subscribeTable(table, callback) {
  if (!_tableSubscribers[table]) {
    _tableSubscribers[table] = new Set();
  }
  _tableSubscribers[table].add(callback);

  // Request current data from the Worker
  // The Worker will wait for INIT if needed
  sendFire({ type: 'SUBSCRIBE', table });

  return () => {
    _tableSubscribers[table]?.delete(callback);
  };
}

/**
 * Subscribe to sync status changes.
 * @param {Function} callback - ({ status, pendingCount }) => void
 * @returns {Function} unsubscribe
 */
export function subscribeStatus(callback) {
  _statusSubscribers.add(callback);
  // Deliver current status immediately
  callback({ status: 'idle', pendingCount: 0 });
  return () => _statusSubscribers.delete(callback);
}

/**
 * Subscribe to sync progress events (during initial load).
 * @param {Function} callback - ({ table, phase, loaded }) => void
 * @returns {Function} unsubscribe
 */
export function subscribeProgress(callback) {
  _progressSubscribers.add(callback);
  return () => _progressSubscribers.delete(callback);
}

/**
 * Optimistic mutation — the main write API.
 * Returns instantly with the optimistic local record.
 */
export async function mutate(table, operation, record, options = {}) {
  const result = await sendRequest({
    type: 'MUTATE',
    table,
    operation,
    record,
    options,
  });
  return result.record;
}

/**
 * Force a delta sync on a specific table.
 */
export async function forceDeltaSync(table) {
  return sendRequest({ type: 'FORCE_DELTA', table });
}

/**
 * Force a hard sync (full reload) on a specific table.
 */
export async function forceHardSync(table) {
  return sendRequest({ type: 'HARD_SYNC', table }, 60000);
}

/**
 * Get all records from a table (one-time read).
 */
export async function getAll(table) {
  const result = await sendRequest({ type: 'GET_ALL', table });
  return result.data;
}

/**
 * Force the mutation queue to process now.
 */
export function forceProcess() {
  sendFire({ type: 'FORCE_PROCESS' });
}

/**
 * Reset the entire local database (used on logout).
 */
export async function resetDatabase() {
  return sendRequest({ type: 'RESET_DATABASE' });
}

/**
 * Destroy the Sync Engine completely (unsubscribe all, stop processing).
 */
export function destroySync() {
  sendFire({ type: 'DESTROY' });

  // Clear all Main Thread subscribers
  for (const table of Object.keys(_tableSubscribers)) {
    _tableSubscribers[table]?.clear();
  }
  _statusSubscribers.clear();
  _progressSubscribers.clear();
  _isInitDone = false;
}

/**
 * Terminate the Worker entirely (should only be used on app shutdown).
 */
export function terminateWorker() {
  destroySync();
  if (_worker) {
    _worker.terminate();
    _worker = null;
    _isReady = false;
    _isInitDone = false;
  }
}
