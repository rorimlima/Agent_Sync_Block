'use client';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency } from '@/lib/utils';
import { AlertTriangle, Lock, DollarSign, TrendingDown, Activity, Clock, Users } from 'lucide-react';

export default function DashboardPage() {
  const { setor } = useAuth();
  const { data: clientes } = useRealtime('clientes');
  const { data: inadimplencia } = useRealtime('inadimplencia');
  const { data: bloqueados } = useRealtime('veiculos_bloqueados', { filter: { status_final: 'VEÍCULO BLOQUEADO' } });
  const { data: auditLogs } = useRealtime('audit_logs', { orderBy: 'created_at', orderAsc: false });

  const totalInadimplente = inadimplencia.reduce((acc, i) => acc + (i.valor_devido_cents || 0), 0);
  const emergencias = inadimplencia.filter(i => i.status_alerta === 'EMERGENCIA').length;
  const atencao = inadimplencia.filter(i => i.status_alerta === 'ATENCAO').length;
  const lembretes = inadimplencia.filter(i => i.status_alerta === 'LEMBRETE').length;

  const cards = [
    { title: 'Clientes Cadastrados', value: clientes.length, icon: Users, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
    { title: 'Total Inadimplente', value: formatCurrency(totalInadimplente), icon: DollarSign, color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
    { title: 'Veículos Bloqueados', value: bloqueados.length, icon: Lock, color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20' },
    { title: 'Emergência (>90d)', value: emergencias, icon: AlertTriangle, color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
  ];

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-text">Dashboard</h1>
        <p className="text-text-muted text-sm mt-1">Visão geral do sistema</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {cards.map((card, i) => (
          <div key={i} className={`glass-card p-4 md:p-5 border ${card.border}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-text-muted text-xs md:text-sm">{card.title}</p>
                <p className={`text-lg md:text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
              </div>
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <card.icon className={`w-4 h-4 md:w-5 md:h-5 ${card.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-danger animate-sync-pulse" />
          <span className="text-sm text-text-muted">Emergência:</span>
          <span className="text-sm font-bold text-danger">{emergencias}</span>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-warning animate-sync-pulse" />
          <span className="text-sm text-text-muted">Atenção:</span>
          <span className="text-sm font-bold text-warning">{atencao}</span>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-alert animate-sync-pulse" />
          <span className="text-sm text-text-muted">Lembrete:</span>
          <span className="text-sm font-bold text-alert">{lembretes}</span>
        </div>
      </div>

      {/* Recent Actions */}
      <div className="glass-card p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-text">Ações Recentes</h2>
        </div>
        <div className="space-y-2">
          {auditLogs.slice(0, 10).map(log => (
            <div key={log.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  log.acao === 'BLOQUEIO' ? 'bg-danger' : 
                  log.acao === 'DESBLOQUEIO' ? 'bg-success' : 
                  log.acao === 'LOGIN' ? 'bg-primary' : 
                  log.acao === 'IMPORTACAO' ? 'bg-warning' : 'bg-text-muted'
                }`} />
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">{log.acao} — {log.detalhes}</p>
                  <p className="text-xs text-text-muted">{log.setor}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-text-muted shrink-0 ml-2">
                <Clock className="w-3 h-3" />
                {new Date(log.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
              </div>
            </div>
          ))}
          {auditLogs.length === 0 && (
            <p className="text-sm text-text-muted text-center py-4">Nenhuma ação registrada</p>
          )}
        </div>
      </div>
    </div>
  );
}
