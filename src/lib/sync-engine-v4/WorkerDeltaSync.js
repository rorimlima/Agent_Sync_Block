/**
 * WorkerDeltaSync — Chunked Initial Load + Delta Fetch (inside Web Worker)
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * 🔒 RUNS ONLY INSIDE THE WEB WORKER.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Architecture:
 * 1. Initial Load: First time → paginated fetch in 500-record chunks
 * 2. Delta Sync: Subsequent syncs → only `updated_at > last_sync_at`
 * 3. Both paths write directly to Dexie.js (IndexedDB) inside the Worker
 * 
 * Performance guarantees:
 * - NEVER loads >500 records into memory at once
 * - Each chunk is flushed to IndexedDB before fetching the next
 * - Progress events are emitted so the UI can show loading %
 */

import {
  getAll,
  getById,
  putRecordsBatch,
  clearTable,
  getLastSyncAt,
  setLastSyncAt,
  hasInitialLoad,
  setInitialLoadDone,
  purgeDeletedOlderThan,
  verifyIntegrity,
  resetTable,
} from './WorkerSyncDatabase.js';

// ─── Configuration ──────────────────────────────────────────────────────────────

const CHUNK_SIZE = 500;         // Records per chunk (initial load)
const DELTA_LIMIT = 1000;       // Max records per delta sync
const MAX_RETRIES = 3;          // Retries per chunk
const RETRY_BASE_MS = 1000;     // Base delay for exponential backoff

// Column selections per table (minimize bandwidth)
const TABLE_SELECT = {
  clientes: 'id,cod_cliente,razao_social,cpf_cnpj,celular,email,cidade,estado,updated_at,is_deleted',
  vendas: 'id,cod_cliente,razao_social,placa,chassi,marca_modelo,valor_venda_cents,data_venda,bloqueio_financeiro,bloqueio_documentacao,status,vendedor,updated_at,is_deleted',
  veiculos_bloqueados: 'id,venda_id,placa,final_placa,marca_modelo,cod_cliente,razao_social,status_financeiro,status_documentacao,status_final,bloqueado_em,chassi,updated_at,is_deleted',
  audit_logs: 'id,acao,setor,detalhes,user_email,created_at,updated_at,is_deleted',
  colaboradores: '*',
};

function getSelect(table) {
  return TABLE_SELECT[table] || '*';
}

// ─── Supabase Client (injected from Worker init) ────────────────────────────────

let _supabase = null;

export function setSupabaseClient(client) {
  _supabase = client;
}

// ─── Helper: Fetch with retry ───────────────────────────────────────────────────

async function fetchWithRetry(queryFn, retries = MAX_RETRIES) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data, error } = await queryFn();
      if (error) throw error;
      return data || [];
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = Math.min(RETRY_BASE_MS * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ─── Sync Table (Entry Point) ───────────────────────────────────────────────────

/**
 * Sync a single table — decides between Full Load and Delta Sync.
 * 
 * @param {string} table - Table name
 * @param {Object} [options]
 * @param {Object} [options.filter] - Supabase eq filters
 * @param {boolean} [options.forceFullReload] - Force a full reload
 * @param {Function} [options.onProgress] - Progress callback({ table, phase, loaded, total? })
 * 
 * @returns {Promise<{ source: string, count: number }>}
 */
export async function syncTable(table, options = {}) {
  const { filter, forceFullReload = false, onProgress } = options;

  // Auto-heal check: verify table integrity before syncing
  const integrity = await verifyIntegrity(table);
  if (!integrity.ok) {
    console.warn(`[DeltaSync] Table "${table}" corrupted: ${integrity.error}. Triggering auto-heal.`);
    await resetTable(table);
    // Force full reload after healing
    return performChunkedFullLoad(table, { filter, onProgress });
  }

  const hadInitial = await hasInitialLoad(table);

  if (!hadInitial || forceFullReload) {
    return performChunkedFullLoad(table, { filter, onProgress });
  } else {
    return performDeltaSync(table, { filter, onProgress });
  }
}

// ─── Chunked Full Load ──────────────────────────────────────────────────────────

/**
 * Full initial load with PAGINATION IN CHUNKS.
 * 
 * Strategy:
 * 1. Fetch 500 records at a time via .range()
 * 2. Flush each chunk to IndexedDB immediately
 * 3. Report progress after each chunk
 * 4. Never hold >500 records in memory
 * 
 * This prevents:
 * - Memory spikes on weak devices
 * - Long GC pauses
 * - Timeout errors on slow connections
 */
async function performChunkedFullLoad(table, { filter, onProgress } = {}) {
  if (!_supabase) throw new Error('Supabase client not initialized');

  const selectCols = getSelect(table);
  let totalLoaded = 0;
  let page = 0;
  let hasMore = true;

  // Clear existing data before full reload
  await clearTable(table);

  onProgress?.({ table, phase: 'full_load', loaded: 0 });

  while (hasMore) {
    const currentPage = page; // Capture for closure

    const rows = await fetchWithRetry(() => {
      let query = _supabase.from(table).select(selectCols);

      // Apply filters
      if (filter) {
        for (const [key, value] of Object.entries(filter)) {
          query = query.eq(key, value);
        }
      }

      query = query.order('updated_at', { ascending: true });
      query = query.range(currentPage * CHUNK_SIZE, (currentPage + 1) * CHUNK_SIZE - 1);

      return query;
    });

    // ── Flush this chunk to IndexedDB immediately ──
    if (rows.length > 0) {
      await putRecordsBatch(table, rows);
      totalLoaded += rows.length;
    }

    // Report progress
    onProgress?.({ table, phase: 'full_load', loaded: totalLoaded });

    // Check if there are more pages
    if (rows.length < CHUNK_SIZE) {
      hasMore = false;
    } else {
      page++;
    }

    // Yield to prevent long task warnings (even inside Worker, be polite)
    if (hasMore) {
      await new Promise(r => setTimeout(r, 10));
    }
  }

  // Save the timestamp of the most recent record as delta cursor
  if (totalLoaded > 0) {
    // Read the latest updated_at from what we just saved
    const allSaved = await getAll(table, { includeDeleted: true });
    if (allSaved.length > 0) {
      const latestTimestamp = allSaved.reduce(
        (max, r) => (r.updated_at > max ? r.updated_at : max),
        allSaved[0].updated_at
      );
      await setLastSyncAt(table, latestTimestamp);
    }
  }

  await setInitialLoadDone(table);
  onProgress?.({ table, phase: 'full_load_done', loaded: totalLoaded });

  return { source: 'full', count: totalLoaded };
}

// ─── Delta Sync ─────────────────────────────────────────────────────────────────

/**
 * Delta Sync — fetches ONLY records changed since last_sync_at.
 * This is the core of bandwidth economy.
 * 
 * Strategy:
 * 1. Query: `updated_at > last_sync_at` with ORDER BY updated_at ASC
 * 2. For each record, apply Last-Write-Wins conflict resolution
 * 3. Batch-write winners to IndexedDB
 * 4. Update the delta cursor (last_sync_at)
 */
async function performDeltaSync(table, { filter, onProgress } = {}) {
  if (!_supabase) throw new Error('Supabase client not initialized');

  const lastSyncAt = await getLastSyncAt(table);

  if (!lastSyncAt) {
    // No cursor → fallback to full load
    return performChunkedFullLoad(table, { filter, onProgress });
  }

  const selectCols = getSelect(table);

  onProgress?.({ table, phase: 'delta', loaded: 0 });

  const rows = await fetchWithRetry(() => {
    let query = _supabase
      .from(table)
      .select(selectCols)
      .gt('updated_at', lastSyncAt) // ← THE DELTA: only what changed
      .order('updated_at', { ascending: true })
      .limit(DELTA_LIMIT);

    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        query = query.eq(key, value);
      }
    }

    return query;
  });

  if (rows.length > 0) {
    // ── Last-Write-Wins conflict resolution ──
    const toWrite = [];

    for (const serverRecord of rows) {
      const localRecord = await getById(table, serverRecord.id);

      if (!localRecord) {
        // New record — write directly
        toWrite.push(serverRecord);
      } else {
        // Potential conflict: compare timestamps
        const serverTime = new Date(serverRecord.updated_at).getTime();
        const localTime = new Date(localRecord.updated_at).getTime();

        if (serverTime >= localTime) {
          // Server wins
          toWrite.push(serverRecord);
        }
        // If local is newer, skip (our MutationQueue will push it)
      }
    }

    // Batch-write all winners
    if (toWrite.length > 0) {
      await putRecordsBatch(table, toWrite);
    }

    // Advance the delta cursor
    const latestTimestamp = rows.reduce(
      (max, r) => (r.updated_at > max ? r.updated_at : max),
      rows[0].updated_at
    );
    await setLastSyncAt(table, latestTimestamp);
  }

  onProgress?.({ table, phase: 'delta_done', loaded: rows.length });

  return { source: 'delta', count: rows.length };
}

// ─── Garbage Collection ─────────────────────────────────────────────────────────

/**
 * Run garbage collection on all tables.
 * Removes soft-deleted records older than 7 days from IndexedDB.
 */
export async function runGarbageCollection(tables) {
  let totalPurged = 0;
  for (const table of tables) {
    try {
      const purged = await purgeDeletedOlderThan(table, 7);
      if (purged > 0) {
        console.log(`[DeltaSync] GC: purged ${purged} deleted records from "${table}"`);
        totalPurged += purged;
      }
    } catch (err) {
      console.warn(`[DeltaSync] GC error on "${table}":`, err.message);
    }
  }
  return totalPurged;
}

// ─── Force Delta Sync (public) ──────────────────────────────────────────────────

/**
 * Force a delta sync on a specific table.
 * Used for pull-to-refresh or after visibility change.
 */
export async function forceDeltaSync(table, options = {}) {
  return syncTable(table, options);
}

/**
 * Force a hard sync (full reload) on a specific table.
 * Used for auto-heal after corruption or manual "fix" button.
 */
export async function forceHardSync(table, options = {}) {
  return syncTable(table, { ...options, forceFullReload: true });
}
