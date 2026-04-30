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

const CACHE_VERSION = 'v2';

const saveToCache = (key, data) => {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      version: CACHE_VERSION,
      timestamp: Date.now(),
      data,
    }));
  } catch { /* ignorar */ }
};

const loadFromCache = (key, maxAgeMs = 60000) => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key));
    if (!cached) return null;
    if (cached.version !== CACHE_VERSION) return null;
    if (Date.now() - cached.timestamp > maxAgeMs) return null;
    return cached.data;
  } catch {
    return null;
  }
};

/**
 * Hook genérico para Supabase Realtime com cache offline e TTL
 */
export function useRealtime(table, options = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const lastFetchRef = useRef(0);

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
          const hasFilter = filterRef.current && Object.keys(filterRef.current).length > 0;

          // Verificar TTL do cache antes de baixar tudo (APENAS se não houver filtro server-side)
          let useCached = false;
          if (!hasFilter) {
            try {
              const { isCacheFresh, getCachedData } = await import('@/lib/offlineCache');
              const ttl = getTTL(table);
              const fresh = await isCacheFresh(table, ttl);
              if (fresh) {
                let cached = await getCachedData(table);
                if (cached.length > 0) {
                  setData(cached);
                  useCached = true;
                }
              }
            } catch {}
          }

          if (!useCached) {
            let allRows = [];
            let page = 0;
            let hasMore = true;

            while (hasMore) {
              let query = supabase.from(table).select(resolvedSelect);
              if (hasFilter) {
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

            // Cache para uso offline (apenas dados integrais)
            if (!hasFilter) {
              try {
                const { cacheTableData, setCacheTimestamp } = await import('@/lib/offlineCache');
                await cacheTableData(table, allRows);
                await setCacheTimestamp(table);
              } catch {}
            }
          }
        }
      } else {
        // Offline — usar cache
        try {
          const { getCachedData } = await import('@/lib/offlineCache');
          const cached = await getCachedData(table);
          if (cached.length > 0) {
            if (filterRef.current) {
              const filtered = cached.filter(row => 
                Object.entries(filterRef.current).every(([k, v]) => row[k] === v)
              );
              setData(filtered);
            } else {
              setData(cached);
            }
          } else {
            setData([]);
          }
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
      lastFetchRef.current = Date.now();
    }
  }, [table, resolvedSelect, orderBy, orderAsc, pageSize, fetchAll, limit]);

  // Safety timer escalonado — avisa em 20s, força reset em 45s
  useEffect(() => {
    if (!loading) return;

    const warnTimer = setTimeout(() => {
      console.warn(`[Agent Sync] Loading longo detectado (20s) na tabela ${table}`);
    }, 20000);

    const killTimer = setTimeout(() => {
      console.error(`[Agent Sync] Safety timer atingido — forçando reset na tabela ${table}`);
      setLoading(false);
      setError('A conexão expirou. Por favor, tente novamente.');
    }, 45000);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(killTimer);
    };
  }, [loading, table]);

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

    // Visibilitychange + Focus — reconectar e refetch
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastFetchRef.current;
        if (elapsed > 30000) {
          setLoading(false);
          supabase.removeChannel(channel);
          fetchData();
        }
      }
    };
    
    const handleFocus = () => {
      const elapsed = Date.now() - lastFetchRef.current;
      if (elapsed > 30000) {
        setLoading(false);
        supabase.removeChannel(channel);
        fetchData();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      supabase.removeChannel(channel);
    };
  }, [table, fetchData, skipRealtime]);

  return { data, loading, error, connected, refetch: fetchData };
}

/**
 * Hook leve para KPIs de Dashboard — usa RPC agregada (1 query!)
 */
export function useStats() {
  const [stats, setStats] = useState({
    clientes: 0, vendas: 0, bloqueados: 0,
    total_vendas_cents: 0,
  });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(0);

  const fetchStats = useCallback(async () => {
    try {
      if (!navigator.onLine) {
        const cached = loadFromCache('asb-stats', 86400000); // 24h
        if (cached) setStats(cached);
        return;
      }

      setLoading(true);

      // Retry exponencial
      let data = null;
      let error = null;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const res = await supabase.rpc('get_dashboard_stats');
        data = res.data;
        error = res.error;
        if (!error) break;
        if (attempt === maxRetries) throw error;
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        console.warn(`[Agent Sync] Tentativa ${attempt} falhou, retentando em ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }

      if (data && mountedRef.current) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        
        // Validação de dados (não renderizar com info faltando)
        if (parsed && typeof parsed.clientes === 'number') {
          setStats(parsed);
          saveToCache('asb-stats', parsed);
        } else {
          console.error('[Agent Sync] Dados incompletos em stats:', parsed);
        }
      }
    } catch (err) {
      console.error('Stats RPC error:', err);
      const cached = loadFromCache('asb-stats', 86400000);
      if (cached) setStats(cached);
    } finally {
      if (mountedRef.current) setLoading(false);
      lastFetchRef.current = Date.now();
    }
  }, []);

  // Safety timer escalonado
  useEffect(() => {
    if (!loading) return;
    const warnTimer = setTimeout(() => console.warn('[Agent Sync] Loading longo em stats (20s)'), 20000);
    const killTimer = setTimeout(() => {
      console.error('[Agent Sync] Safety timer atingido em stats');
      if (mountedRef.current) setLoading(false);
    }, 45000);
    return () => { clearTimeout(warnTimer); clearTimeout(killTimer); };
  }, [loading]);

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

    const tables = ['clientes', 'vendas', 'veiculos_bloqueados'];
    const channels = tables.map(t =>
      supabase.channel(`stats-${t}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: t }, debouncedRefetch)
        .subscribe()
    );

    // Visibilitychange + focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        const elapsed = Date.now() - lastFetchRef.current;
        if (elapsed > 30000) {
          setLoading(false);
          fetchStats();
        }
      }
    };
    const handleFocus = () => {
      if (mountedRef.current) {
        const elapsed = Date.now() - lastFetchRef.current;
        if (elapsed > 30000) {
          setLoading(false);
          fetchStats();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      mountedRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      channels.forEach(ch => supabase.removeChannel(ch));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}
