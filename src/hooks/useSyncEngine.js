'use client';
/**
 * useSyncEngine — Hook React para conectar o Sync Engine à UI
 * 
 * REGRAS:
 * 1. A UI NUNCA consulta o Supabase diretamente
 * 2. A UI lê do IndexedDB local (via subscribeTable)
 * 3. A UI escreve via mutate() que retorna instantaneamente
 * 4. O indicador de sync é PASSIVO (nunca bloqueia a UI)
 * 
 * Este hook substitui o useRealtime antigo para as tabelas que migrarem.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  subscribeTable,
  subscribeStatus,
  mutate as syncMutate,
  initSync,
  forceDeltaSync,
  destroySync,
  getAll,
} from '@/lib/sync-engine';

// ─── useSyncTable ───────────────────────────────────────────────────────────────
/**
 * Hook que retorna os dados de uma tabela, lendo do IndexedDB local.
 * Re-renderiza automaticamente quando os dados mudam (via Realtime ou mutação local).
 * 
 * @param {string} table - Nome da tabela
 * @param {Object} [options] - Opções
 * @param {Function} [options.filter] - Função de filtro client-side: (record) => boolean
 * @param {string} [options.orderBy] - Campo para ordenação (default: 'updated_at')
 * @param {boolean} [options.orderAsc] - Ordem ascendente (default: false = desc)
 * @param {boolean} [options.enabled] - Se false, não carrega dados (default: true)
 * 
 * @returns {{ data: Array, loading: boolean, refetch: Function }}
 */
export function useSyncTable(table, options = {}) {
  const {
    filter,
    orderBy = 'updated_at',
    orderAsc = false,
    enabled = true,
  } = options;

  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Inscreve no pub/sub da tabela no Sync Engine
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    mountedRef.current = true;

    const unsubscribe = subscribeTable(table, (data) => {
      if (!mountedRef.current) return;
      setRawData(data);
      setLoading(false);
    });

    // Safety timer — se não receber dados em 10s, para de carregar
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current && loading) {
        setLoading(false);
      }
    }, 10000);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      clearTimeout(safetyTimer);
    };
  }, [table, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aplica filtro e ordenação client-side (memoizado)
  const data = useMemo(() => {
    let result = rawData;

    // Aplica filtro customizado
    if (filterRef.current) {
      if (typeof filterRef.current === 'function') {
        result = result.filter(filterRef.current);
      } else if (typeof filterRef.current === 'object') {
        // Filtro simples por chave/valor
        result = result.filter(r =>
          Object.entries(filterRef.current).every(([k, v]) => r[k] === v)
        );
      }
    }

    // Ordena
    result = [...result].sort((a, b) => {
      const aVal = a[orderBy] || '';
      const bVal = b[orderBy] || '';
      if (orderAsc) return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    });

    return result;
  }, [rawData, orderBy, orderAsc]); // filter via ref, não causa re-render

  // Refetch manual (force delta sync)
  const refetch = useCallback(async () => {
    try {
      await forceDeltaSync(table);
    } catch (err) {
      console.error(`[useSyncTable] Refetch failed for ${table}:`, err);
    }
  }, [table]);

  return { data, loading, refetch };
}

// ─── useMutate ──────────────────────────────────────────────────────────────────
/**
 * Hook que retorna a função de mutação optimistic.
 * A UI atualiza INSTANTANEAMENTE, o sync com servidor acontece em background.
 * 
 * Uso:
 * const { mutate } = useMutate();
 * await mutate('vendas', 'UPDATE', { id: venda.id, bloqueio_financeiro: true });
 */
export function useMutate() {
  const mutate = useCallback(async (table, operation, record, options) => {
    return await syncMutate(table, operation, record, options);
  }, []);

  return { mutate };
}

// ─── useSyncStatus ──────────────────────────────────────────────────────────────
/**
 * Hook que retorna o status de sincronização.
 * Use para exibir um indicador passivo (ícone no header).
 * 
 * NUNCA use para bloquear a UI (modal, overlay, disabled buttons).
 * 
 * @returns {{ status: 'idle'|'syncing'|'error'|'offline', pendingCount: number }}
 */
export function useSyncStatus() {
  const [syncState, setSyncState] = useState({ status: 'idle', pendingCount: 0 });

  useEffect(() => {
    const unsubscribe = subscribeStatus((state) => {
      setSyncState(state);
    });
    return unsubscribe;
  }, []);

  return syncState;
}

// ─── useSyncInit ────────────────────────────────────────────────────────────────
/**
 * Hook que inicializa o Sync Engine para um conjunto de tabelas.
 * Deve ser chamado UMA VEZ no layout/provider principal, após autenticação.
 * 
 * @param {string[]} tables - Tabelas para sincronizar
 * @param {Object} [tableFilters] - Filtros por tabela para o initial load
 * @param {boolean} [enabled] - Se false, não inicializa (útil para esperar auth)
 */
export function useSyncInit(tables, tableFilters = {}, enabled = true) {
  const [isReady, setIsReady] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (!enabled || initRef.current) return;
    initRef.current = true;

    initSync(tables, tableFilters)
      .then(() => setIsReady(true))
      .catch(err => {
        console.error('[useSyncInit] Init failed:', err);
        setIsReady(true); // Marca como ready mesmo com erro (dados do cache serão usados)
      });

    return () => {
      destroySync();
      initRef.current = false;
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isReady };
}
