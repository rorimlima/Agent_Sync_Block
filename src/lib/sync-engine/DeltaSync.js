/**
 * DeltaSync — Sincronização incremental (Delta Fetching) + Supabase Realtime
 * 
 * ARQUITETURA:
 * 1. Initial Load: Primeira vez → busca TUDO e grava no IndexedDB
 * 2. Delta Sync: Consultas subsequentes → busca apenas `updated_at > last_sync_at`
 * 3. Realtime: Supabase Realtime events → aplicados com debounce + Last-Write-Wins
 * 
 * REGRA: Este módulo é um SINGLETON. Gerencia os canais Realtime e o ciclo de delta sync
 * para TODAS as tabelas, isolado da UI.
 */

import { supabase } from '../supabase';
import {
  getAll,
  getById,
  putRecord,
  putRecordsBatch,
  clearTable,
  getLastSyncAt,
  setLastSyncAt,
  hasInitialLoad,
  setInitialLoadDone,
  purgeDeletedOlderThan,
  KNOWN_TABLES,
} from './SyncDatabase';
import { getSelect } from '../syncByRole';

// ─── Singleton State ────────────────────────────────────────────────────────────

const _realtimeChannels = {};
const _debounceTimers = {};
const _tableSubscribers = {}; // table -> Set<callback>
let _isInitialized = false;

// ─── Eventos para a UI (pub/sub por tabela) ────────────────────────────────────

/**
 * Inscreve um callback que será chamado sempre que os dados de uma tabela mudarem.
 * O callback recebe o array completo de registros (sem soft-deletes).
 * 
 * @returns {Function} unsubscribe
 */
export function subscribeTable(table, callback) {
  if (!_tableSubscribers[table]) {
    _tableSubscribers[table] = new Set();
  }
  _tableSubscribers[table].add(callback);

  // Entrega dados atuais imediatamente (async)
  getAll(table).then(data => {
    try { callback(data); } catch {}
  });

  return () => {
    _tableSubscribers[table]?.delete(callback);
  };
}

/**
 * Notifica todos os subscribers de uma tabela que os dados mudaram
 */
async function notifyTableChanged(table) {
  const subscribers = _tableSubscribers[table];
  if (!subscribers || subscribers.size === 0) return;

  const data = await getAll(table);
  subscribers.forEach(cb => {
    try { cb(data); } catch {}
  });
}

// ─── Initial Load + Delta Sync ──────────────────────────────────────────────────

/**
 * Executa o sync completo de uma tabela:
 * - Se nunca foi carregada → Full Load
 * - Se já tem dados → Delta Sync (apenas novos/alterados)
 * 
 * Retorna { source: 'full'|'delta'|'cache', count: number }
 */
export async function syncTable(table, options = {}) {
  const { filter, forceFullReload = false } = options;

  // Se estamos offline, retorna dados do cache
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { source: 'cache', count: 0 };
  }

  const hadInitialLoad = await hasInitialLoad(table);

  if (!hadInitialLoad || forceFullReload) {
    return await performFullLoad(table, { filter });
  } else {
    return await performDeltaSync(table, { filter });
  }
}

/**
 * Full Load — Busca todos os registros (usado apenas na primeira vez)
 */
async function performFullLoad(table, { filter } = {}) {
  const selectCols = getSelect(table);
  let allRows = [];
  let page = 0;
  const PAGE_SIZE = 500;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(selectCols);

    // Aplica filtros se existirem
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        query = query.eq(key, value);
      }
    }

    query = query.order('updated_at', { ascending: true });
    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    allRows = allRows.concat(rows);

    if (rows.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
    }
  }

  // Grava tudo no IndexedDB
  if (allRows.length > 0) {
    await clearTable(table);
    await putRecordsBatch(table, allRows);

    // Salva timestamp do registro mais recente como referência para delta sync
    const latestTimestamp = allRows.reduce((max, r) =>
      r.updated_at > max ? r.updated_at : max, allRows[0].updated_at
    );
    await setLastSyncAt(table, latestTimestamp);
  }

  await setInitialLoadDone(table);
  await notifyTableChanged(table);

  return { source: 'full', count: allRows.length };
}

/**
 * Delta Sync — Busca APENAS registros modificados desde o último sync
 * Este é o coração da economia de banda.
 */
async function performDeltaSync(table, { filter } = {}) {
  const lastSyncAt = await getLastSyncAt(table);
  
  if (!lastSyncAt) {
    // Fallback para full load se não tem timestamp
    return await performFullLoad(table, { filter });
  }

  const selectCols = getSelect(table);
  let query = supabase
    .from(table)
    .select(selectCols)
    .gt('updated_at', lastSyncAt)  // ← O DELTA: só busca o que mudou
    .order('updated_at', { ascending: true });

  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      query = query.eq(key, value);
    }
  }

  // Limit de 1000 registros no delta para segurança
  query = query.limit(1000);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];

  if (rows.length > 0) {
    // Aplica Last-Write-Wins para cada registro
    const toWrite = [];
    for (const serverRecord of rows) {
      const localRecord = await getById(table, serverRecord.id);

      if (!localRecord) {
        // Registro novo — aplica direto
        toWrite.push(serverRecord);
      } else {
        // Conflito potencial: Last-Write-Wins
        const serverTime = new Date(serverRecord.updated_at).getTime();
        const localTime = new Date(localRecord.updated_at).getTime();

        if (serverTime >= localTime) {
          toWrite.push(serverRecord);
        }
        // Se local é mais recente, ignora o servidor (o MutationQueue vai enviar o nosso)
      }
    }

    if (toWrite.length > 0) {
      await putRecordsBatch(table, toWrite);
    }

    // Atualiza o timestamp de referência
    const latestTimestamp = rows.reduce((max, r) =>
      r.updated_at > max ? r.updated_at : max, rows[0].updated_at
    );
    await setLastSyncAt(table, latestTimestamp);
  }

  // Notifica UI independentemente (dados locais podem ter mudado via MutationQueue)
  await notifyTableChanged(table);

  return { source: 'delta', count: rows.length };
}

// ─── Supabase Realtime ──────────────────────────────────────────────────────────

/**
 * Inscreve nos eventos Realtime de uma tabela do Supabase.
 * Eventos são debounced por registro para evitar spam de re-render.
 */
export function subscribeRealtime(table) {
  // Evita dupla inscrição
  if (_realtimeChannels[table]) return;

  const channelName = `sync-rt-${table}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      handleRealtimeEvent(table, payload);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[SyncEngine] Realtime conectado: ${table}`);
      }
    });

  _realtimeChannels[table] = channel;
}

/**
 * Desinscreve do Realtime de uma tabela
 */
export function unsubscribeRealtime(table) {
  const channel = _realtimeChannels[table];
  if (channel) {
    supabase.removeChannel(channel);
    delete _realtimeChannels[table];
  }
}

/**
 * Desinscreve de TODOS os canais Realtime (logout)
 */
export function unsubscribeAllRealtime() {
  for (const table of Object.keys(_realtimeChannels)) {
    unsubscribeRealtime(table);
  }
}

/**
 * Handler de evento Realtime com DEBOUNCE por registro.
 * Se o mesmo registro receber 5 updates em 300ms, só processa o último.
 */
function handleRealtimeEvent(table, payload) {
  const record = payload.new || payload.old;
  if (!record?.id) return;

  const debounceKey = `${table}_${record.id}`;
  
  // Limpa timer anterior para este registro
  if (_debounceTimers[debounceKey]) {
    clearTimeout(_debounceTimers[debounceKey]);
  }

  // Debounce de 300ms
  _debounceTimers[debounceKey] = setTimeout(async () => {
    delete _debounceTimers[debounceKey];
    await applyRealtimeChange(table, payload);
  }, 300);
}

/**
 * Aplica a mudança do Realtime no IndexedDB local, usando Last-Write-Wins.
 */
async function applyRealtimeChange(table, payload) {
  const { eventType } = payload;
  const serverRecord = payload.new;

  if (!serverRecord?.id) return;

  try {
    const localRecord = await getById(table, serverRecord.id);

    if (eventType === 'DELETE') {
      // Hard delete do servidor → marca como deleted localmente
      if (localRecord) {
        await putRecord(table, { ...localRecord, is_deleted: true, updated_at: new Date().toISOString() });
        await notifyTableChanged(table);
      }
      return;
    }

    // INSERT ou UPDATE — aplica Last-Write-Wins
    if (!localRecord) {
      // Registro novo
      await putRecord(table, serverRecord);
    } else {
      const serverTime = new Date(serverRecord.updated_at).getTime();
      const localTime = new Date(localRecord.updated_at).getTime();

      if (serverTime >= localTime) {
        await putRecord(table, serverRecord);
      }
      // Se local é mais recente, ignora (nosso MutationQueue vai enviar)
    }

    // Atualiza last_sync_at para incluir este timestamp
    const currentLastSync = await getLastSyncAt(table);
    if (!currentLastSync || serverRecord.updated_at > currentLastSync) {
      await setLastSyncAt(table, serverRecord.updated_at);
    }

    await notifyTableChanged(table);
  } catch (err) {
    console.error(`[SyncEngine] Realtime apply error (${table}):`, err);
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────────

/**
 * Inicializa o Delta Sync para um conjunto de tabelas.
 * Faz sync inicial + inscreve no Realtime.
 * 
 * @param {string[]} tables - Array de nomes de tabelas
 * @param {Object} [tableFilters] - Filtros por tabela, ex: { veiculos_bloqueados: { status_final: 'VEÍCULO BLOQUEADO' } }
 */
export async function initSync(tables, tableFilters = {}) {
  // Sync paralelo de todas as tabelas
  const results = await Promise.allSettled(
    tables.map(async (table) => {
      try {
        const result = await syncTable(table, { filter: tableFilters[table] });
        subscribeRealtime(table);
        return { table, ...result };
      } catch (err) {
        console.error(`[SyncEngine] Init sync failed for ${table}:`, err);
        // Mesmo com erro, entrega dados do cache
        await notifyTableChanged(table);
        return { table, source: 'cache', count: 0, error: err.message };
      }
    })
  );

  // Garbage collection em background (não bloqueia)
  setTimeout(async () => {
    for (const table of tables) {
      try { await purgeDeletedOlderThan(table, 7); } catch {}
    }
  }, 30000);

  _isInitialized = true;
  return results.map(r => r.value || r.reason);
}

/**
 * Força um Delta Sync manual de uma tabela (ex: pull-to-refresh)
 */
export async function forceDeltaSync(table, options = {}) {
  return await syncTable(table, options);
}

/**
 * Cleanup completo — chamado no logout
 */
export function destroySync() {
  unsubscribeAllRealtime();
  // Limpa todos os debounce timers
  for (const key of Object.keys(_debounceTimers)) {
    clearTimeout(_debounceTimers[key]);
    delete _debounceTimers[key];
  }
  // Limpa subscribers
  for (const table of Object.keys(_tableSubscribers)) {
    _tableSubscribers[table]?.clear();
  }
  _isInitialized = false;
}
