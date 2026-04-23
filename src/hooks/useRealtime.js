'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Hook genérico para Supabase Realtime
 * Carrega dados iniciais e escuta mudanças em tempo real
 * 
 * @param {string} table - Nome da tabela
 * @param {object} options - { select, orderBy, orderAsc, filter, pageSize, fetchAll }
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

        if (!fetchAll || rows.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }

      setData(allRows);
    } catch (err) {
      setError(err.message);
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
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, fetchData]);

  return { data, loading, error, connected, refetch: fetchData };
}

/**
 * Hook leve para KPIs de Dashboard
 * Busca contagens e totais sem carregar milhares de registros
 */
export function useStats() {
  const [stats, setStats] = useState({
    clientes: 0,
    vendas: 0,
    inadimplencia: 0,
    bloqueados: 0,
    total_inadimplente_cents: 0,
    total_vendas_cents: 0,
    emergencias: 0,
    atencao: 0,
    lembretes: 0,
    com_inadimplencia: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);

      // Buscar contagens com head:true (não transfere dados, só conta)
      const [cliRes, vendRes, inadRes, bloqRes] = await Promise.all([
        supabase.from('clientes').select('id', { count: 'exact', head: true }),
        supabase.from('vendas').select('id', { count: 'exact', head: true }),
        supabase.from('inadimplencia').select('id', { count: 'exact', head: true }),
        supabase.from('veiculos_bloqueados').select('id', { count: 'exact', head: true }).eq('status_final', 'VEÍCULO BLOQUEADO'),
      ]);

      // Buscar dados mínimos de inadimplência para totais e alertas
      let allInad = [];
      let pg = 0;
      let more = true;
      while (more) {
        const { data: batch, error } = await supabase
          .from('inadimplencia')
          .select('valor_devido_cents, status_alerta, cod_cliente')
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        if (error) { console.error('Inad fetch err:', error); break; }
        const rows = batch || [];
        allInad = allInad.concat(rows);
        more = rows.length === 1000;
        pg++;
      }

      const totalInad = allInad.reduce((a, r) => a + (r.valor_devido_cents || 0), 0);
      const emergencias = allInad.filter(r => r.status_alerta === 'EMERGENCIA').length;
      const atencao = allInad.filter(r => r.status_alerta === 'ATENCAO').length;
      const lembretes = allInad.filter(r => r.status_alerta === 'LEMBRETE').length;
      const inadCods = new Set(allInad.map(r => r.cod_cliente));

      // Total vendas
      let allVendas = [];
      pg = 0;
      more = true;
      while (more) {
        const { data: batch, error } = await supabase
          .from('vendas')
          .select('valor_venda_cents')
          .range(pg * 1000, (pg + 1) * 1000 - 1);
        if (error) { console.error('Vendas fetch err:', error); break; }
        const rows = batch || [];
        allVendas = allVendas.concat(rows);
        more = rows.length === 1000;
        pg++;
      }
      const totalVendas = allVendas.reduce((a, r) => a + (r.valor_venda_cents || 0), 0);

      setStats({
        clientes: cliRes.count ?? 0,
        vendas: vendRes.count ?? 0,
        inadimplencia: inadRes.count ?? 0,
        bloqueados: bloqRes.count ?? 0,
        total_inadimplente_cents: totalInad,
        total_vendas_cents: totalVendas,
        emergencias,
        atencao,
        lembretes,
        com_inadimplencia: inadCods.size,
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
      supabase
        .channel(`stats-${t}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => fetchStats())
        .subscribe()
    );
    return () => channels.forEach(ch => supabase.removeChannel(ch));
  }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}
