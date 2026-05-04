'use client';
/**
 * SyncIndicator — Indicador PASSIVO de sincronização
 * 
 * REGRA ABSOLUTA: Este componente é apenas um ícone/texto pequeno.
 * NUNCA bloqueia a UI. NUNCA é um modal. NUNCA desabilita botões.
 * 
 * Posicionamento recomendado: header/sidebar, ao lado do indicador Online/Offline
 */

import { useSyncStatus } from '@/hooks/useSyncEngineV4';
import { Cloud, CloudOff, Loader2, AlertCircle, Check } from 'lucide-react';
import { forceProcess } from '@/lib/sync-engine-v4';

export default function SyncIndicator({ compact = false }) {
  const { status, pendingCount } = useSyncStatus();

  if (status === 'idle' && pendingCount === 0) {
    if (compact) return null; // Não mostra nada quando tudo está ok (modo compacto)
    return (
      <div className="flex items-center gap-1.5 text-success">
        <Check className="w-3 h-3" />
        <span className="text-[10px] font-medium">Sincronizado</span>
      </div>
    );
  }

  if (status === 'syncing') {
    return (
      <div className="flex items-center gap-1.5 text-primary animate-pulse">
        <Loader2 className="w-3 h-3 animate-spin" />
        {!compact && (
          <span className="text-[10px] font-medium">
            Sincronizando{pendingCount > 0 ? ` (${pendingCount})` : '...'}
          </span>
        )}
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="flex items-center gap-1.5 text-warning">
        <CloudOff className="w-3 h-3" />
        {!compact && (
          <span className="text-[10px] font-medium">
            Offline{pendingCount > 0 ? ` · ${pendingCount} pendente${pendingCount > 1 ? 's' : ''}` : ''}
          </span>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <button
        onClick={() => forceProcess()}
        className="flex items-center gap-1.5 text-danger hover:text-danger/80 cursor-pointer transition-colors"
        title="Clique para tentar novamente"
      >
        <AlertCircle className="w-3 h-3" />
        {!compact && (
          <span className="text-[10px] font-medium">
            Erro de sync{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </span>
        )}
      </button>
    );
  }

  // Tem pendências mas está idle (entre tentativas de retry)
  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-1.5 text-text-muted">
        <Cloud className="w-3 h-3" />
        {!compact && (
          <span className="text-[10px] font-medium">
            {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
    );
  }

  return null;
}
