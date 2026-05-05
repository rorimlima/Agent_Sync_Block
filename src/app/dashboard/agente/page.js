'use client';
import { useSyncTable } from '@/hooks/useSyncEngineV4';
import { useAuth } from '@/hooks/useAuth';
import { Shield } from 'lucide-react';

export default function AgentePage() {
  const { hasRole } = useAuth();
  const { data: bloqueados, loading: bloqueadosLoading } = useSyncTable('veiculos_bloqueados', {
    filter: (b) => b.status_final === 'VEÍCULO BLOQUEADO',
  });

  if (!hasRole(['master', 'agente'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito ao Agente</div>;
  }

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
          <Shield className="w-6 h-6 text-success" /> Painel do Agente
        </h1>
        <p className="text-text-muted text-sm mt-1">Atuação em campo</p>
      </div>

      {/* Veículos Bloqueados */}
      <div>
        <h2 className="text-sm font-semibold text-text-muted mb-2">
          Veículos Bloqueados ({bloqueadosLoading ? '...' : bloqueados.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {bloqueados.map(b => (
            <div
              key={b.id}
              className="glass-card p-4 text-left transition-all hover:border-border-2"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-lg font-bold text-text font-mono">{b.placa}</span>
                <span className="badge-bloqueado text-xs px-2 py-1 rounded-lg">🔒</span>
              </div>
              {b.chassi && <p className="text-xs text-text-muted font-mono">Chassi: {b.chassi}</p>}
              <p className="text-xs text-text-muted">{b.marca_modelo || '-'}</p>
            </div>
          ))}
          {!bloqueadosLoading && bloqueados.length === 0 && (
            <p className="text-sm text-text-muted col-span-2 text-center py-6">Nenhum veículo bloqueado</p>
          )}
        </div>
      </div>
    </div>
  );
}
