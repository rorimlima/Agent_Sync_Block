'use client';
/**
 * useSyncEngine v4 — React Hooks for the Web Worker Sync Engine
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * PERFORMANCE RULES:
 * 1. The UI NEVER queries Supabase directly
 * 2. The UI reads from the Worker's IndexedDB via postMessage
 * 3. The UI writes via mutate() which returns INSTANTLY (optimistic)
 * 4. The sync indicator is PASSIVE (never blocks the UI)
 * 5. All heavy work runs in the Web Worker — ZERO Main Thread blocking
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * These hooks replace useSyncEngine.js (v3) and useRealtime.js (legacy).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  subscribeTable,
  subscribeStatus,
  subscribeProgress,
  mutate as syncMutate,
  initSync,
  refreshWorkerAuth,
  forceDeltaSync,
  destroySync,
  getAll,
} from '@/lib/sync-engine-v4';
import { supabase } from '@/lib/supabase';

// ─── useSyncTable ───────────────────────────────────────────────────────────────
/**
 * Hook that returns the data of a table, reading from the Worker's IndexedDB.
 * Auto-updates when data changes (via Realtime batch or mutation).
 * 
 * ZERO blocking: The Worker sends batched TABLE_DATA messages via postMessage.
 * The React state only updates when the data actually changes.
 * 
 * @param {string} table - Table name
 * @param {Object} [options]
 * @param {Function} [options.filter] - Client-side filter: (record) => boolean
 * @param {string} [options.orderBy] - Sort field (default: 'updated_at')
 * @param {boolean} [options.orderAsc] - Ascending order (default: false)
 * @param {boolean} [options.enabled] - If false, don't load (default: true)
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

  // Subscribe to Worker's TABLE_DATA events for this table
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

    // Safety timer — if no data in 15s, stop loading spinner
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current && loading) {
        setLoading(false);
      }
    }, 15000);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      clearTimeout(safetyTimer);
    };
  }, [table, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply client-side filter and sort (memoized)
  const data = useMemo(() => {
    let result = rawData;

    // Apply custom filter
    if (filterRef.current) {
      if (typeof filterRef.current === 'function') {
        result = result.filter(filterRef.current);
      } else if (typeof filterRef.current === 'object') {
        // Simple key/value filter
        result = result.filter(r =>
          Object.entries(filterRef.current).every(([k, v]) => r[k] === v)
        );
      }
    }

    // Sort
    result = [...result].sort((a, b) => {
      const aVal = a[orderBy] || '';
      const bVal = b[orderBy] || '';
      if (orderAsc) return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    });

    return result;
  }, [rawData, orderBy, orderAsc]); // filter via ref — doesn't trigger re-render

  // Manual refetch (force delta sync via Worker)
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
 * Hook that returns the optimistic mutation function.
 * The UI updates INSTANTLY; server sync happens in the Worker background.
 * 
 * Usage:
 *   const { mutate } = useMutate();
 *   await mutate('vendas', 'UPDATE', { id: venda.id, bloqueio_financeiro: true });
 */
export function useMutate() {
  const mutate = useCallback(async (table, operation, record, options) => {
    return await syncMutate(table, operation, record, options);
  }, []);

  return { mutate };
}

// ─── useSyncStatus ──────────────────────────────────────────────────────────────
/**
 * Hook that returns the sync status from the Worker.
 * Use for a passive indicator (icon in the header).
 * 
 * NEVER use this to block the UI (no modals, overlays, or disabled buttons).
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

// ─── useSyncProgress ────────────────────────────────────────────────────────────
/**
 * Hook that returns progress events during initial load.
 * Useful for showing a progress bar on first load.
 * 
 * @returns {{ table: string, phase: string, loaded: number } | null}
 */
export function useSyncProgress() {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeProgress((progressData) => {
      setProgress(progressData);
    });
    return unsubscribe;
  }, []);

  return progress;
}

// ─── useSyncInit ────────────────────────────────────────────────────────────────
/**
 * Hook that initializes the Sync Engine v4 (Web Worker) for a set of tables.
 * Must be called ONCE in the layout/provider, after authentication.
 * 
 * CRITICAL: This hook:
 * 1. Gets the Supabase auth session from the Main Thread
 * 2. Passes access_token + refresh_token to the Worker
 * 3. Listens for token refresh events and forwards them to the Worker
 * 
 * @param {string[]} tables - Tables to synchronize
 * @param {Object} [tableFilters] - Filters per table for initial load
 * @param {boolean} [enabled] - If false, don't initialize (wait for auth)
 */
export function useSyncInit(tables, tableFilters = {}, enabled = true) {
  const [isReady, setIsReady] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (!enabled || initRef.current || tables.length === 0) return;
    initRef.current = true;

    const doInit = async () => {
      // ── Get the auth session from the Main Thread's Supabase client ──
      // This is the CRITICAL step that was missing before.
      // Without it, the Worker makes anonymous requests and RLS blocks all data.
      let session = null;
      try {
        const { data } = await supabase.auth.getSession();
        session = data?.session || null;
        if (!session) {
          console.warn('[useSyncInit] No auth session found — data may be restricted by RLS');
        }
      } catch (err) {
        console.error('[useSyncInit] Failed to get auth session:', err);
      }

      // ── Initialize the Worker with tables + auth tokens ──
      await initSync(tables, tableFilters, session);
      setIsReady(true);
    };

    doInit().catch(err => {
      console.error('[useSyncInit] Init failed:', err);
      setIsReady(true); // Mark ready even on error (cached data will be used)
    });

    // ── Listen for token refresh and forward to Worker ──
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        refreshWorkerAuth(session.access_token, session.refresh_token);
      }
    });

    return () => {
      destroySync();
      initRef.current = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isReady };
}
