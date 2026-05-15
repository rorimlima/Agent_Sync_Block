'use client';
/**
 * SyncFAB — Floating Action Button for Sync (AppSheet-style)
 * 
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior (modeled after AppSheet's sync button):
 * 
 * 1. IDLE (all synced):  Small pill showing "✓ Sincronizado" — fades to just an icon after 3s
 * 2. SYNCING:            Animated rotating sync icon with progress ring
 * 3. PENDING:            Shows count badge, pulsing to prompt user to tap
 * 4. ERROR:              Red state with retry action on tap
 * 5. OFFLINE:            Gray cloud-off icon, static
 * 
 * Tap behavior:
 * - Single tap:         ALWAYS triggers Delta Sync (push pending + pull changes)
 * - Long press / menu:  Shows context menu with Sync Rápido, Sync Completo, Limpar Cache
 * - When syncing:       No-op (disabled)
 * 
 * Position: Bottom-right corner, above the mobile bottom nav bar
 * ═══════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSyncStatus } from '@/hooks/useSyncEngineV4';
import {
  forceDeltaSync,
  forceHardSync,
  forceProcess,
} from '@/lib/sync-engine-v4';
import { getTablesForRole } from '@/lib/syncByRole';
import { useAuth } from '@/hooks/useAuth';
import {
  RefreshCw,
  Check,
  CloudOff,
  AlertCircle,
  Cloud,
  Loader2,
  Trash2,
} from 'lucide-react';

// ─── Sync FAB Component ─────────────────────────────────────────────────────────

export default function SyncFAB() {
  const { status, pendingCount } = useSyncStatus();
  const { colaborador } = useAuth();

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [showLabel, setShowLabel] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [syncResult, setSyncResult] = useState(null); // 'success' | 'error' | 'offline' | null
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const hideTimerRef = useRef(null);
  const resultTimerRef = useRef(null);
  const menuRef = useRef(null);
  const fabRef = useRef(null);
  const longPressTimerRef = useRef(null);

  // Determine active tables from user role
  const activeTables = colaborador?.funcao
    ? getTablesForRole(colaborador.funcao)
    : [];

  // ── Track online/offline state and auto-sync on reconnect ──
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      // Auto-trigger delta sync when connection returns
      setSyncResult(null);
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ── Auto-hide label after 3 seconds ──
  useEffect(() => {
    if (showLabel) {
      hideTimerRef.current = setTimeout(() => setShowLabel(false), 3000);
      return () => clearTimeout(hideTimerRef.current);
    }
  }, [showLabel]);

  // ── Clear sync result feedback after 3 seconds ──
  useEffect(() => {
    if (syncResult) {
      resultTimerRef.current = setTimeout(() => setSyncResult(null), 3000);
      return () => clearTimeout(resultTimerRef.current);
    }
  }, [syncResult]);

  // ── Close menu on outside click ──
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          fabRef.current && !fabRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [showMenu]);

  // Show label briefly when sync status changes
  useEffect(() => {
    if (status === 'syncing' || pendingCount > 0) {
      setShowLabel(true);
    }
  }, [status, pendingCount]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  /**
   * Full Sync Flow — Push pending mutations FIRST, then Delta Sync all tables.
   * This ensures data consistency: local changes are pushed before pulling.
   */
  const handleDeltaSync = useCallback(async () => {
    if (isSyncing || activeTables.length === 0) return;

    // ── If offline, show feedback but don't block ──
    if (!navigator.onLine) {
      setSyncResult('offline');
      setShowLabel(true);
      return;
    }

    setIsSyncing(true);
    setShowMenu(false);
    setShowLabel(true);
    setSyncResult(null);

    try {
      // Step 1: Force-process any pending mutations in the queue
      // This pushes local changes to Supabase BEFORE we pull
      forceProcess();

      // Small delay to let the queue start processing
      await new Promise(r => setTimeout(r, 300));

      // Step 2: Delta Sync all tables (pull only changes since last_sync_at)
      let totalChanged = 0;
      for (const table of activeTables) {
        try {
          const result = await forceDeltaSync(table);
          totalChanged += (result?.count || 0);
        } catch (err) {
          console.warn(`[SyncFAB] Delta sync failed for "${table}":`, err.message);
        }
      }

      setLastSyncTime(new Date());
      setSyncResult('success');
      setShowLabel(true);
      console.log(`[SyncFAB] Delta sync completed — ${totalChanged} records synced`);
    } catch (err) {
      console.error('[SyncFAB] Delta sync error:', err);
      setSyncResult('error');
      setShowLabel(true);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, activeTables]);

  /**
   * Hard Sync — Full reload of all tables (like AppSheet "force sync").
   * Clears local IndexedDB tables and reloads everything from Supabase.
   */
  const handleHardSync = useCallback(async () => {
    if (isSyncing || activeTables.length === 0) return;
    setIsSyncing(true);
    setShowMenu(false);
    setShowLabel(true);
    setSyncResult(null);

    try {
      // Step 1: Force-process pending mutations first
      forceProcess();
      await new Promise(r => setTimeout(r, 500));

      // Step 2: Hard sync all tables (clear + full reload)
      for (const table of activeTables) {
        try {
          await forceHardSync(table);
        } catch (err) {
          console.warn(`[SyncFAB] Hard sync failed for "${table}":`, err.message);
        }
      }

      setLastSyncTime(new Date());
      setSyncResult('success');
      setShowLabel(true);
      console.log('[SyncFAB] Hard sync completed — all tables reloaded');
    } catch (err) {
      console.error('[SyncFAB] Hard sync error:', err);
      setSyncResult('error');
      setShowLabel(true);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, activeTables]);

  /**
   * Cache Cleanup — Forces GC on all tables then delta sync.
   * Removes: soft-deleted (7d), finalized records (15d), then syncs fresh.
   */
  const handleCacheCleanup = useCallback(async () => {
    if (isSyncing || activeTables.length === 0) return;
    setIsSyncing(true);
    setShowMenu(false);
    setShowLabel(true);
    setSyncResult(null);

    try {
      // Step 1: Force-process pending mutations
      forceProcess();
      await new Promise(r => setTimeout(r, 300));

      // Step 2: Hard sync — this clears old data and pulls fresh
      // The Worker automatically runs GC (purgeDeleted + purgeFinalized)
      // 30s after INIT, but a hard sync does an immediate clear + reload
      for (const table of activeTables) {
        try {
          await forceHardSync(table);
        } catch (err) {
          console.warn(`[SyncFAB] Cache cleanup failed for "${table}":`, err.message);
        }
      }

      setLastSyncTime(new Date());
      setSyncResult('success');
      setShowLabel(true);
      console.log('[SyncFAB] Cache cleanup completed — old data purged, tables reloaded');
    } catch (err) {
      console.error('[SyncFAB] Cache cleanup error:', err);
      setSyncResult('error');
      setShowLabel(true);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, activeTables]);

  /**
   * Main FAB tap handler — ALWAYS syncs.
   * Single tap = push pending + pull delta (fast, lightweight).
   */
  const handleFabTap = useCallback(() => {
    if (isSyncing) return;

    // If menu is open, close it
    if (showMenu) {
      setShowMenu(false);
      return;
    }

    // ALWAYS sync on tap — no menu toggling on single tap
    handleDeltaSync();
  }, [isSyncing, showMenu, handleDeltaSync]);

  /**
   * Long press handler — opens context menu
   */
  const handlePointerDown = useCallback(() => {
    longPressTimerRef.current = setTimeout(() => {
      if (!isSyncing) {
        setShowMenu(true);
      }
    }, 500); // 500ms = long press
  }, [isSyncing]);

  const handlePointerUp = useCallback(() => {
    clearTimeout(longPressTimerRef.current);
  }, []);

  // ── Render Helpers ────────────────────────────────────────────────────────────

  const getStatusColor = () => {
    if (syncResult === 'success') return 'var(--color-success)';
    if (syncResult === 'offline') return 'var(--color-warning)';
    if (syncResult === 'error' || status === 'error') return 'var(--color-danger)';
    if (isSyncing || status === 'syncing') return 'var(--color-primary)';
    if (status === 'offline' || !isOnline) return 'var(--color-text-muted)';
    if (pendingCount > 0) return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  const getStatusIcon = () => {
    if (syncResult === 'success') return <Check className="w-5 h-5" />;
    if (syncResult === 'offline') return <CloudOff className="w-5 h-5" />;
    if (syncResult === 'error' || status === 'error') return <AlertCircle className="w-5 h-5" />;
    if (isSyncing || status === 'syncing') return <RefreshCw className="w-5 h-5 animate-spin" style={{ animationDuration: '1s' }} />;
    if (status === 'offline' || !isOnline) return <CloudOff className="w-5 h-5" />;
    if (pendingCount > 0) return <Cloud className="w-5 h-5" />;
    return <RefreshCw className="w-5 h-5" />;
  };

  const getStatusLabel = () => {
    if (syncResult === 'success') return 'Sincronizado!';
    if (syncResult === 'offline') return 'Sem conexão';
    if (syncResult === 'error') return 'Erro na sync';
    if (isSyncing || status === 'syncing') return 'Sincronizando...';
    if (status === 'offline' || !isOnline) {
      // Show last sync time so agent knows how fresh the data is
      if (lastSyncTime) {
        return `Offline · ${getLastSyncLabel()}`;
      }
      return 'Modo Offline';
    }
    if (status === 'error') return 'Erro';
    if (pendingCount > 0) return `${pendingCount} pendente${pendingCount > 1 ? 's' : ''}`;
    if (lastSyncTime) return `✓ ${getLastSyncLabel()}`;
    return 'Sincronizar';
  };

  const getLastSyncLabel = () => {
    if (!lastSyncTime) return null;
    const diff = Math.round((Date.now() - lastSyncTime.getTime()) / 1000);
    if (diff < 60) return `${diff}s atrás`;
    if (diff < 3600) return `${Math.round(diff / 60)}min atrás`;
    return lastSyncTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  // Don't render until authenticated
  if (!colaborador?.funcao) return null;

  const statusColor = getStatusColor();
  // FAB is ALWAYS interactive — even offline (shows feedback to user)
  const isDisabled = isSyncing;

  return (
    <>
      {/* ── Context Menu (AppSheet-style actions) ── */}
      {showMenu && (
        <div
          ref={menuRef}
          className="sync-fab-menu"
          style={{
            position: 'fixed',
            bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px) + 60px)',
            right: '1rem',
            zIndex: 59,
          }}
        >
          <div className="bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden"
            style={{ minWidth: '230px', backdropFilter: 'blur(20px)' }}
          >
            {/* Delta Sync (quick) */}
            <button
              onClick={handleDeltaSync}
              disabled={isDisabled}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-40"
            >
              <RefreshCw className="w-4 h-4 text-primary" />
              <div className="text-left">
                <p className="font-medium">Sync Rápido</p>
                <p className="text-[10px] text-text-muted">Enviar pendentes + puxar alterações</p>
              </div>
            </button>

            <div className="h-px bg-border" />

            {/* Hard Sync (full reload) */}
            <button
              onClick={handleHardSync}
              disabled={isDisabled}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Loader2 className="w-4 h-4 text-warning" />
              <div className="text-left">
                <p className="font-medium">Sync Completo</p>
                <p className="text-[10px] text-text-muted">Recarregar todos os dados</p>
              </div>
            </button>

            <div className="h-px bg-border" />

            {/* Cache Cleanup */}
            <button
              onClick={handleCacheCleanup}
              disabled={isDisabled}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4 text-danger" />
              <div className="text-left">
                <p className="font-medium">Limpar Cache</p>
                <p className="text-[10px] text-text-muted">Remover dados antigos e recarregar</p>
              </div>
            </button>

            {/* Force Process (only if pending) */}
            {pendingCount > 0 && (
              <>
                <div className="h-px bg-border" />
                <button
                  onClick={() => { forceProcess(); setShowMenu(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-text hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <Cloud className="w-4 h-4 text-success" />
                  <div className="text-left">
                    <p className="font-medium">Enviar Pendentes</p>
                    <p className="text-[10px] text-text-muted">{pendingCount} alteração{pendingCount > 1 ? 'ões' : ''} na fila</p>
                  </div>
                </button>
              </>
            )}

            {/* Last sync info */}
            {lastSyncTime && (
              <>
                <div className="h-px bg-border" />
                <div className="px-4 py-2.5 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-success" />
                  <span className="text-[10px] text-text-muted">
                    Última sync: {getLastSyncLabel()}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── FAB Button ── */}
      <button
        ref={fabRef}
        onClick={handleFabTap}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        disabled={isSyncing}
        aria-label="Sincronizar dados"
        className="sync-fab"
        style={{
          position: 'fixed',
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px) + 64px)',
          right: '1rem',
          zIndex: 58,
          display: 'flex',
          alignItems: 'center',
          gap: showLabel ? '8px' : '0',
          padding: showLabel ? '10px 16px 10px 12px' : '12px',
          borderRadius: showLabel ? '50px' : '50%',
          border: `1.5px solid color-mix(in srgb, ${statusColor} 30%, transparent)`,
          backgroundColor: `color-mix(in srgb, ${statusColor} 12%, var(--color-surface))`,
          color: statusColor,
          boxShadow: `0 4px 20px color-mix(in srgb, ${statusColor} 20%, transparent), 0 2px 8px rgba(0,0,0,0.15)`,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          outline: 'none',
          opacity: !isOnline && !isSyncing ? 0.7 : 1,
          transform: isSyncing ? 'scale(1.05)' : 'scale(1)',
        }}
      >
        {/* Icon */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            flexShrink: 0,
          }}
        >
          {getStatusIcon()}
        </span>

        {/* Label (animated collapse) */}
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            maxWidth: showLabel ? '150px' : '0',
            opacity: showLabel ? 1 : 0,
            transition: 'max-width 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
          }}
        >
          {getStatusLabel()}
        </span>

        {/* Pending count badge */}
        {pendingCount > 0 && !showLabel && (
          <span
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              backgroundColor: 'var(--color-warning)',
              color: '#000',
              fontSize: '10px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid var(--color-surface)',
              animation: 'sync-badge-pulse 2s ease-in-out infinite',
            }}
          >
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}

        {/* Syncing progress ring */}
        {isSyncing && (
          <span
            style={{
              position: 'absolute',
              inset: '-3px',
              borderRadius: showLabel ? '50px' : '50%',
              border: '2px solid transparent',
              borderTopColor: statusColor,
              animation: 'sync-ring-spin 1s linear infinite',
              pointerEvents: 'none',
            }}
          />
        )}
      </button>

      {/* ── Keyframe Animations ── */}
      <style jsx global>{`
        @keyframes sync-badge-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        @keyframes sync-ring-spin {
          to { transform: rotate(360deg); }
        }

        /* Desktop: position above footer, no bottom nav offset */
        @media (min-width: 768px) {
          .sync-fab {
            bottom: 1.5rem !important;
          }
          .sync-fab-menu {
            bottom: calc(1.5rem + 56px) !important;
          }
        }

        /* Hover effect */
        .sync-fab:hover:not(:disabled) {
          transform: scale(1.08) !important;
        }
        .sync-fab:active:not(:disabled) {
          transform: scale(0.95) !important;
        }
      `}</style>
    </>
  );
}
