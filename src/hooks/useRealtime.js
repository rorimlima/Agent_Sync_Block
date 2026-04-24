'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getTTL, getSelect, getFilter } from '@/lib/syncByRole';

/**
 * Hook para detectar status online/offline e registrar SW
 */
export function useOnline() {
  const [isOnline, setIsOnline] = useState(true);
  const [swReady, setSwReady] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);

    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(() => setSwReady(true))
        .catch(err => console.warn('SW register failed:', err));
    }

    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  return { isOnline, swReady };
}

/**
 * Hook genérico para Supabase Realtime com cache offline e TTL
 */
export function useRealtime(table, options = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  const { 
    select, 
    orderBy = 'created_at', 
    orderAsc = false, 
    filter,
    pageSize = 500,
    fetchAll = true,
    limit,            // Limitar resultado total (ex: últimos 20 audit_logs)
    skipRealtime = false,
  } = options;

  const resolvedSelect = select || getSelect(table);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Tentar buscar online
      if (navigator.onLine) {
        // Se há limit, buscar só o necessário sem loop
        if (limit) {
          let query = supabase.from(table).select(resolvedSelect);
          if (filterRef.current) {
            Object.entries(filterRef.current).forEach(([key, value]) => {
              query = query.eq(key, value);
            });
          }
          query = query.order(orderBy, { ascending: orderAsc }).limit(limit);
          const { data: result, error: err } = await query;
          if (err) throw err;
          setData(result || []);
        } else {
          // Verificar TTL do cache antes de baixar tudo
          let useCached = false;
          try {
            const { isCacheFresh, getCachedData } = await import('@/lib/offlineCache');
            const ttl = getTTL(table);
            const fresh = await isCacheFresh(table, ttl);
            if (fresh) {
              let cached = await getCachedData(table);
              if (cached.length > 0) {
                // Aplicar filtro client-side nos dados do cache
                if (filterRef.current) {
                  cached = cached.filter(row =>
                    Object.entries(filterRef.current).every(([k, v]) => row[k] === v)
                  );
                }
                setData(cached);
                useCached = true;
              }
            }
          } catch {}

          if (!useCached) {
            let allRows = [];
            let page = 0;
            let hasMore = true;

            while (hasMore) {
              let query = supabase.from(table).select(resolvedSelect);
              if (filterRef.current) {
                Object.entries(filterRef.current).forEach(([key, value]) => {
                  query = query.eq(key, value);
                });
              }
              query = query.order(orderBy, { ascending: orderAsc });
              if (fetchAll) {
                const from = page * pageSize;
                const to = from + pageSize - 1;
                query = query.range(from, to);
              }
              const { data: result, error: err } = await query;
              if (err) throw err;
              const rows = result || [];
              allRows = allRows.concat(rows);
              if (!fetchAll || rows.length < pageSize) hasMore = false;
              else page++;
            }

            setData(allRows);

            // Cache para uso offline
            try {
              const { cacheTableData, setCacheTimestamp } = await import('@/lib/offlineCache');
              await cacheTableData(table, allRows);
              await setCacheTimestamp(table);
            } catch {}
          }
        }
      } else {
        // Offline — usar cache
        try {
          const { getCachedData } = await import('@/lib/offlineCache');
          const cached = await getCachedData(table);
          setData(cached);
        } catch { setData([]); }
      }
    } catch (err) {
      setError(err.message);
      // Fallback offline em caso de erro de rede
      try {
        const { getCachedData } = await import('@/lib/offlineCache');
        const cached = await getCachedData(table);
        if (cached.length > 0) setData(cached);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [table, resolvedSelect, orderBy, orderAsc, pageSize, fetchAll, limit]);

  useEffect(() => {
    fetchData();

    // Não abrir canal realtime se skipRealtime ou offline
    if (skipRealtime || !navigator.onLine) return;

    const channel = supabase
      .channel(`rt-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        setData(prev => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          const f = filterRef.current;
          const matchesFilter = !f || Object.entries(f).every(([k, v]) => newRecord?.[k] === v);
          if (eventType === 'INSERT') return matchesFilter ? [newRecord, ...prev] : prev;
          if (eventType === 'UPDATE') {
            if (matchesFilter) return prev.map(item => item.id === newRecord.id ? newRecord : item);
            return prev.filter(item => item.id !== newRecord.id);
          }
          if (eventType === 'DELETE') return prev.filter(item => item.id !== oldRecord.id);
          return prev;
        });
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));

    return () => supabase.removeChannel(channel);
  }, [table, fetchData, skipRealtime]);

  return { data, loading, error, connected, refetch: fetchData };
}

/**
 * Hook leve para KPIs de Dashboard — usa RPC agregada (1 query!)
 */
export function useStats() {
  const [stats, setStats] = useState({
    clientes: 0, vendas: 0, inadimplencia: 0, bloqueados: 0,
    total_inadimplente_cents: 0, total_vendas_cents: 0,
    emergencias: 0, atencao: 0, lembretes: 0, com_inadimplencia: 0,
  });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchStats = useCallback(async () => {
    try {
      if (!navigator.onLine) {
        // Tentar ler stats do cache
        try {
          const cached = sessionStorage.getItem('asb-stats');
          if (cached) setStats(JSON.parse(cached));
        } catch {}
        return;
      }

      setLoading(true);

      // Uma única query RPC em vez de loops
      const { data, error } = await supabase.rpc('get_dashboard_stats');
      if (error) throw error;

      if (data && mountedRef.current) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        setStats(parsed);
        // Cache para uso offline
        try { sessionStorage.setItem('asb-stats', JSON.stringify(parsed)); } catch {}
      }
    } catch (err) {
      console.error('Stats RPC error:', err);
      // Fallback: tentar cache
      try {
        const cached = sessionStorage.getItem('asb-stats');
        if (cached) setStats(JSON.parse(cached));
      } catch {}
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchStats();

    // Escutar realtime apenas nas tabelas que afetam stats
    // Debounce: refetch no máximo a cada 10s quando há mudanças
    let debounceTimer = null;
    const debouncedRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mountedRef.current) fetchStats();
      }, 10000);
    };

    const tables = ['clientes', 'vendas', 'inadimplencia', 'veiculos_bloqueados'];
    const channels = tables.map(t =>
      supabase.channel(`stats-${t}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: t }, debouncedRefetch)
        .subscribe()
    );

    return () => {
      mountedRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}
