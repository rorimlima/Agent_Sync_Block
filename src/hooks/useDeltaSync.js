'use client';
/**
 * useDeltaSync — React Hook for Delta Sync with Error Recovery + Garbage Collection
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * PURPOSE:
 * 1. Wraps useSyncTable with try/catch error handling for IndexedDB failures
 * 2. Shows toast notifications on local storage errors
 * 3. Triggers Garbage Collection automatically on quota errors
 * 4. Provides manual GC trigger for maintenance
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Usage:
 *   const { data, loading, refetch, triggerGC } = useDeltaSync('vendas');
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSyncTable, useMutate } from './useSyncEngineV4';
import { forceHardSync } from '@/lib/sync-engine-v4';

// ─── GC Configuration ───────────────────────────────────────────────────────────

const GC_FINALIZED_DAYS = 15;  // Delete finalized records older than 15 days
const GC_COOLDOWN_MS = 60000;  // Only run GC once per minute

// ─── Toast System ───────────────────────────────────────────────────────────────

let _globalToastCallback = null;

/**
 * Register a global toast callback for GC/error notifications.
 * Call this once in your layout/provider.
 * 
 * @param {Function} callback - (message: string, type: 'error'|'warning'|'info') => void
 */
export function registerToastCallback(callback) {
  _globalToastCallback = callback;
}

function showToast(message, type = 'error') {
  _globalToastCallback?.(message, type);
  console[type === 'error' ? 'error' : 'warn'](`[DeltaSync] ${message}`);
}

// ─── useDeltaSync Hook ──────────────────────────────────────────────────────────

/**
 * Enhanced Delta Sync hook with error recovery and GC.
 * Drop-in replacement for useSyncTable with added resilience.
 * 
 * @param {string} table - Table name
 * @param {Object} [options] - Same options as useSyncTable
 * @returns {{ data: Array, loading: boolean, refetch: Function, triggerGC: Function, gcRunning: boolean }}
 */
export function useDeltaSync(table, options = {}) {
  const { data, loading, refetch } = useSyncTable(table, options);
  const [gcRunning, setGcRunning] = useState(false);
  const lastGCRef = useRef(0);

  /**
   * Trigger Garbage Collection on this table.
   * Cleans up:
   * 1. Soft-deleted records (is_deleted = true) older than 7 days
   * 2. Finalized records (status = 'Finalizado') older than 15 days
   * 
   * After GC, forces a hard sync to ensure data consistency.
   */
  const triggerGC = useCallback(async () => {
    const now = Date.now();
    if (now - lastGCRef.current < GC_COOLDOWN_MS) {
      console.log('[DeltaSync] GC cooldown active, skipping');
      return;
    }

    lastGCRef.current = now;
    setGcRunning(true);

    try {
      showToast('Limpando cache antigo...', 'info');

      // Send GC command to the Worker via forceHardSync
      // The Worker's GC runs automatically during INIT, but we can also
      // trigger a hard sync which clears + reloads fresh data
      await forceHardSync(table);

      showToast('Cache limpo com sucesso', 'info');
    } catch (err) {
      console.error('[DeltaSync] GC failed:', err);
      showToast('Falha na limpeza de cache', 'error');
    } finally {
      setGcRunning(false);
    }
  }, [table]);

  // ── Auto-GC on QuotaExceededError ──
  useEffect(() => {
    const handleStorageError = (event) => {
      if (event?.reason?.name === 'QuotaExceededError' ||
          event?.message?.includes?.('QuotaExceeded') ||
          event?.reason?.message?.includes?.('QuotaExceeded')) {
        showToast('Erro de memória local, limpando cache antigo...', 'warning');
        triggerGC();
      }
    };

    window.addEventListener('unhandledrejection', handleStorageError);
    return () => window.removeEventListener('unhandledrejection', handleStorageError);
  }, [triggerGC]);

  return { data, loading, refetch, triggerGC, gcRunning };
}

// ─── useSoftDelete Hook ─────────────────────────────────────────────────────────

/**
 * Hook for performing soft deletes.
 * NEVER uses DELETE — always UPDATE with deleted_at + is_deleted.
 * 
 * Usage:
 *   const { softDelete } = useSoftDelete();
 *   await softDelete('vendas', venda.id);
 */
export function useSoftDelete() {
  const { mutate } = useMutate();

  const softDelete = useCallback(async (table, recordId, extras = {}) => {
    try {
      return await mutate(table, 'DELETE', { id: recordId, ...extras });
    } catch (err) {
      showToast(`Erro ao deletar registro: ${err.message}`, 'error');
      throw err;
    }
  }, [mutate]);

  return { softDelete };
}

// ─── useLocalMutate Hook (with error handling) ──────────────────────────────────

/**
 * Enhanced mutation hook with error handling and toast notifications.
 * Wraps useMutate with try/catch for IndexedDB failures.
 * 
 * Usage:
 *   const { safeMutate } = useLocalMutate();
 *   await safeMutate('vendas', 'UPDATE', { id: venda.id, status: 'Finalizado' });
 */
export function useLocalMutate() {
  const { mutate } = useMutate();

  const safeMutate = useCallback(async (table, operation, record, options) => {
    try {
      return await mutate(table, operation, record, options);
    } catch (err) {
      if (err.name === 'QuotaExceededError' || err.message?.includes('QuotaExceeded')) {
        showToast('Erro de memória local, limpando cache antigo...', 'warning');
        // The triggerGC from useDeltaSync handles cleanup
      } else {
        showToast(`Erro ao salvar: ${err.message}`, 'error');
      }
      throw err;
    }
  }, [mutate]);

  return { safeMutate };
}
