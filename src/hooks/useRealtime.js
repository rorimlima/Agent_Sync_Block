'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Hook genérico para Supabase Realtime
 * Carrega dados iniciais e escuta mudanças em tempo real
 * 
 * @param {string} table - Nome da tabela
 * @param {object} options - { select, orderBy, orderAsc, filter }
 */
export function useRealtime(table, options = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  const { select = '*', orderBy = 'created_at', orderAsc = false, filter } = options;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase.from(table).select(select);
      
      if (filter) {
        Object.entries(filter).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }
      
      query = query.order(orderBy, { ascending: orderAsc });
      
      const { data: result, error: err } = await query;
      if (err) throw err;
      setData(result || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [table, select, orderBy, orderAsc, filter]);

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel(`realtime-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        setData(prev => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          
          if (eventType === 'INSERT') {
            return [newRecord, ...prev];
          }
          if (eventType === 'UPDATE') {
            return prev.map(item => item.id === newRecord.id ? newRecord : item);
          }
          if (eventType === 'DELETE') {
            return prev.filter(item => item.id !== oldRecord.id);
          }
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
