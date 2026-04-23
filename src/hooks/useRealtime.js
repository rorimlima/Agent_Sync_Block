'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

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
 * Hook genérico para Supabase Realtime com cache offline
 */
export function useRealtime(table, options = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  const { 
    select = '*', 
    orderBy = 'created_at', 
    orderAsc = false, 
    filter,
    pageSize = 1000,
    fetchAll = true,
  } = options;

  const filterRef = useRef(filter);
  filterRef.current = filter;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Tentar buscar online
      if (navigator.onLine) {
        let allRows = [];
        let page = 0;
        let hasMore = true;

        while (hasMore) {
          let query = supabase.from(table).select(select);
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
  }, [table, select, orderBy, orderAsc, pageSize, fetchAll]);

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`realtime-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        setData(prev => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          if (eventType === 'INSERT') return [newRecord, ...prev];
          if (eventType === 'UPDATE') return prev.map(item => item.id === newRecord.id ? newRecord : item);
          if (eventType === 'DELETE') return prev.filter(item => item.id !== oldRecord.id);
          return prev;
        });
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));

    return () => supabase.removeChannel(channel);
  }, [table, fetchData]);

  return { data, loading, error, connected, refetch: fetchData };
}

/**
 * Hook leve para KPIs de Dashboard
 */
export function useStats() {
  const [stats, setStats] = useState({
    clientes: 0, vendas: 0, inadimplencia: 0, bloqueados: 0,
    total_inadimplente_cents: 0, total_vendas_cents: 0,
    emergencias: 0, atencao: 0, lembretes: 0, com_inadimplencia: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const [cliRes, vendRes, inadRes, bloqRes] = await Promise.all([
        supabase.from('clientes').select('id', { count: 'exact', head: true }),
        supabase.from('vendas').select('id', { count: 'exact', head: true }),
        supabase.from('inadimplencia').select('id', { count: 'exact', head: true }),
        supabase.from('veiculos_bloqueados').select('id', { count: 'exact', head: true }).eq('status_final', 'VEÍCULO BLOQUEADO'),
      ]);

      let allInad = [], pg = 0, more = true;
      while (more) {
        const { data: batch } = await supabase.from('inadimplencia')
          .select('valor_devido_cents, status_alerta, cod_cliente')
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        const rows = batch || [];
        allInad = allInad.concat(rows);
        more = rows.length === 1000; pg++;
      }

      const totalInad = allInad.reduce((a, r) => a + (r.valor_devido_cents || 0), 0);
      const emergencias = allInad.filter(r => r.status_alerta === 'EMERGENCIA').length;
      const atencao = allInad.filter(r => r.status_alerta === 'ATENCAO').length;
      const lembretes = allInad.filter(r => r.status_alerta === 'LEMBRETE').length;
      const inadCods = new Set(allInad.map(r => r.cod_cliente));

      let allVendas = []; pg = 0; more = true;
      while (more) {
        const { data: batch } = await supabase.from('vendas')
          .select('valor_venda_cents').range(pg * 1000, (pg + 1) * 1000 - 1);
        const rows = batch || [];
        allVendas = allVendas.concat(rows);
        more = rows.length === 1000; pg++;
      }
      const totalVendas = allVendas.reduce((a, r) => a + (r.valor_venda_cents || 0), 0);

      setStats({
        clientes: cliRes.count ?? 0, vendas: vendRes.count ?? 0,
        inadimplencia: inadRes.count ?? 0, bloqueados: bloqRes.count ?? 0,
        total_inadimplente_cents: totalInad, total_vendas_cents: totalVendas,
        emergencias, atencao, lembretes, com_inadimplencia: inadCods.size,
      });
    } catch (err) {
      console.error('Stats error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const channels = ['clientes', 'vendas', 'inadimplencia', 'veiculos_bloqueados'].map(t =>
      supabase.channel(`stats-${t}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => fetchStats())
        .subscribe()
    );
    return () => channels.forEach(ch => supabase.removeChannel(ch));
  }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}
