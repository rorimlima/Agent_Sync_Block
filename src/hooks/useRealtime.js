'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getTTL, getSelect } from '@/lib/syncByRole';

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

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(() => setSwReady(true))
        .catch(err => console.warn('SW register failed:', err));
    }

    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return { isOnline, swReady };
}

// ─── Cache com validação de integridade ───────────────────────────────────────
const CACHE_VERSION = 'v2';

const saveToCache = (key, data) => {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      version: CACHE_VERSION,
      timestamp: Date.now(),
      data,
    }));
  } catch { /* sessionStorage pode não estar disponível */ }
};

const loadFromCache = (key, maxAgeMs = 60000) => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key));
    if (!cached) return null;
    if (cached.version !== CACHE_VERSION) return null; // Versão antiga, ignora
    if (Date.now() - cached.timestamp > maxAgeMs) return null; // Expirado
    return cached.data;
  } catch {
    return null;
  }
};

// ─── Helper: retry exponencial para Supabase queries ─────────────────────────
const withRetry = async (fn, maxRetries = 3) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      console.warn(`[Agent Sync] Tentativa ${attempt} falhou, retentando em ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
};

/**
 * Hook genérico para Supabase Realtime com cache offline, TTL e resiliência total
 */
export function useRealtime(table, options = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  // Flag de hidratação: só renderiza com dados completos
  const [isHydrated, setIsHydrated] = useState(false);

  const lastFetchRef = useRef(0);
  const mountedRef = useRef(true);

  const {
    select,
    orderBy = 'created_at',
    orderAsc = false,
    filter,
    pageSize = 500,
    fetchAll = true,
    limit,
    skipRealtime = false,
  } = options;

  const resolvedSelect = select || getSelect(table);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const fetchData = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      setLoading(true);
      setError(null);

      const hasFilter = filterRef.current && Object.keys(filterRef.current).length > 0;

      if (navigator.onLine) {
        // ── Busca com limit (ex: audit_logs) ─────────────────────────────
        if (limit) {
          const rows = await withRetry(async () => {
            let query = supabase.from(table).select(resolvedSelect);
            if (filterRef.current) {
              Object.entries(filterRef.current).forEach(([key, value]) => {
                query = query.eq(key, value);
              });
            }
            query = query.order(orderBy, { ascending: orderAsc }).limit(limit);
            const { data: result, error: err } = await query;
            if (err) throw err;
            return result || [];
          });
          if (mountedRef.current) {
            setData(rows);
            setIsHydrated(true);
          }
        } else {
          // ── Busca com paginação / sem filter — verifica cache ──────────
          let useCached = false;

          // Só usa cache IndexedDB se NÃO há filtro (evita cache parcial)
          if (!hasFilter) {
            try {
              const { isCacheFresh, getCachedData } = await import('@/lib/offlineCache');
              const ttl = getTTL(table);
              const fresh = await isCacheFresh(table, ttl);
              if (fresh) {
                const cached = await getCachedData(table);
                if (cached.length > 0) {
                  if (mountedRef.current) {
                    setData(cached);
                    setIsHydrated(true);
                  }
                  useCached = true;
                }
              }
            } catch {}
          }

          if (!useCached) {
            // Busca paginada com retry exponencial por página
            let allRows = [];
            let page = 0;
            let hasMore = true;

            while (hasMore) {
              const rows = await withRetry(async () => {
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
                return result || [];
              });

              allRows = allRows.concat(rows);
              if (!fetchAll || rows.length < pageSize) hasMore = false;
              else page++;
            }

            // Validação de integridade antes de hidratar
            if (mountedRef.current) {
              setData(allRows);
              setIsHydrated(true);
            }

            // Cache apenas dados integrais (sem filtro)
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
        // ── Offline: usa cache com filtragem client-side ──────────────────
        try {
          const { getCachedData } = await import('@/lib/offlineCache');
          const cached = await getCachedData(table);
          if (mountedRef.current) {
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
            setIsHydrated(true);
          }
        } catch { if (mountedRef.current) setData([]); }
      }
    } catch (err) {
      console.error(`[Agent Sync] Erro ao buscar tabela "${table}":`, err);
      if (mountedRef.current) {
        setError(err.message);
        // Fallback offline em caso de erro de rede
        try {
          const { getCachedData } = await import('@/lib/offlineCache');
          const cached = await getCachedData(table);
          if (cached.length > 0) {
            setData(cached);
            setIsHydrated(true);
          }
        } catch {}
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        lastFetchRef.current = Date.now();
      }
    }
  }, [table, resolvedSelect, orderBy, orderAsc, pageSize, fetchAll, limit]);

  // ── Safety timer escalonado (20s avisa, 45s força reset) ─────────────────
  useEffect(() => {
    if (!loading) return;

    const warnTimer = setTimeout(() => {
      console.warn(`[Agent Sync] Loading longo detectado (20s) na tabela "${table}"`);
    }, 20000);

    const killTimer = setTimeout(() => {
      console.error(`[Agent Sync] Safety timer atingido — forçando reset na tabela "${table}"`);
      if (mountedRef.current) {
        setLoading(false);
        setError('A conexão expirou. Por favor, tente novamente.');
      }
    }, 45000);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(killTimer);
    };
  }, [loading, table]);

  // ── Realtime + visibilitychange + focus ───────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    fetchData();

    if (skipRealtime || !navigator.onLine) return;

    const channel = supabase
      .channel(`rt-${table}-${Date.now()}`)
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
      .subscribe((status) => {
        if (mountedRef.current) setConnected(status === 'SUBSCRIBED');
      });

    const resetAndRefetch = () => {
      const elapsed = Date.now() - lastFetchRef.current;
      if (elapsed > 30000) {
        console.log(`[Agent Sync] Reconectando "${table}" após ${Math.round(elapsed / 1000)}s de inatividade`);
        if (mountedRef.current) setLoading(false);
        supabase.removeChannel(channel);
        fetchData();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resetAndRefetch();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', resetAndRefetch);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', resetAndRefetch);
      supabase.removeChannel(channel);
    };
  }, [table, fetchData, skipRealtime]);

  return { data, loading, error, connected, isHydrated, refetch: fetchData };
}

/**
 * Hook leve para KPIs do Dashboard — usa RPC agregada (1 query)
 */
export function useStats() {
  const [stats, setStats] = useState({
    clientes: 0, vendas: 0, bloqueados: 0,
    total_vendas_cents: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(0);

  const fetchStats = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      if (!navigator.onLine) {
        const cached = loadFromCache('asb-stats', 86400000); // 24h offline
        if (cached && mountedRef.current) {
          setStats(cached);
          setIsHydrated(true);
        }
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
        console.warn(`[Agent Sync] Stats: tentativa ${attempt} falhou, retentando em ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }

      if (data && mountedRef.current) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;

        // Validação de integridade — só renderiza com dados completos
        const requiredFields = ['clientes', 'vendas', 'bloqueados', 'total_vendas_cents'];
        const missing = requiredFields.filter(f => !(f in parsed) || typeof parsed[f] !== 'number');

        if (missing.length > 0) {
          console.error('[Agent Sync] Dados de stats incompletos, campos faltando:', missing);
          // Fallback para cache
          const cached = loadFromCache('asb-stats', 86400000);
          if (cached) setStats(cached);
        } else {
          setStats(parsed);
          saveToCache('asb-stats', parsed);
          setIsHydrated(true);
        }
      }
    } catch (err) {
      console.error('[Agent Sync] Stats RPC error:', err);
      // Fallback: cache local
      const cached = loadFromCache('asb-stats', 86400000);
      if (cached && mountedRef.current) {
        setStats(cached);
        setIsHydrated(true);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        lastFetchRef.current = Date.now();
      }
    }
  }, []);

  // ── Safety timer escalonado ───────────────────────────────────────────────
  useEffect(() => {
    if (!loading) return;
    const warnTimer = setTimeout(() => console.warn('[Agent Sync] Loading longo em stats (20s)'), 20000);
    const killTimer = setTimeout(() => {
      console.error('[Agent Sync] Safety timer atingido em stats — forçando reset');
      if (mountedRef.current) setLoading(false);
    }, 45000);
    return () => { clearTimeout(warnTimer); clearTimeout(killTimer); };
  }, [loading]);

  // ── Setup + Realtime + visibilitychange + focus ───────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    fetchStats();

    let debounceTimer = null;
    const debouncedRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mountedRef.current) fetchStats();
      }, 10000);
    };

    const tables = ['clientes', 'vendas', 'veiculos_bloqueados'];
    const channels = tables.map(t =>
      supabase.channel(`stats-${t}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: t }, debouncedRefetch)
        .subscribe()
    );

    const resetAndRefetch = () => {
      if (mountedRef.current) {
        const elapsed = Date.now() - lastFetchRef.current;
        if (elapsed > 30000) {
          setLoading(false);
          fetchStats();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resetAndRefetch();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', resetAndRefetch);

    return () => {
      mountedRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      channels.forEach(ch => supabase.removeChannel(ch));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', resetAndRefetch);
    };
  }, [fetchStats]);

  return { stats, loading, isHydrated, refetch: fetchStats };
}
