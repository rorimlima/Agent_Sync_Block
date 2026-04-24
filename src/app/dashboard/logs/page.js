'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/lib/utils';
import { ClipboardList, Search, Filter, ChevronLeft, ChevronRight, Loader2, User, Shield, ShoppingCart, Lock, KeyRound, LogIn, LogOut as LogOutIcon, X } from 'lucide-react';

const PAGE_SIZE = 30;

const ACAO_CONFIG = {
  LOGIN:        { icon: LogIn,          color: 'text-success',  bg: 'bg-success/10', label: 'Login' },
  LOGOUT:       { icon: LogOutIcon,     color: 'text-text-muted', bg: 'bg-surface-2', label: 'Logout' },
  TROCA_SENHA:  { icon: KeyRound,       color: 'text-warning',  bg: 'bg-warning/10', label: 'Troca de Senha' },
  OCORRENCIA:   { icon: Shield,         color: 'text-success',  bg: 'bg-success/10', label: 'Ocorrência' },
  BLOQUEIO:     { icon: Lock,           color: 'text-danger',   bg: 'bg-danger/10',  label: 'Bloqueio' },
  DESBLOQUEIO:  { icon: Lock,           color: 'text-success',  bg: 'bg-success/10', label: 'Desbloqueio' },
  VENDA:        { icon: ShoppingCart,    color: 'text-primary',  bg: 'bg-primary/10', label: 'Venda' },
};

const getAcaoConfig = (acao) => {
  return ACAO_CONFIG[acao] || { icon: ClipboardList, color: 'text-text-muted', bg: 'bg-surface-2', label: acao || 'Ação' };
};

export default function LogsPage() {
  const { hasRole } = useAuth();
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filterAcao, setFilterAcao] = useState('');
  const [filterSetor, setFilterSetor] = useState('');
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);

  if (!hasRole(['master', 'financeiro'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  const fetchLogs = useCallback(async (currentPage, searchTerm, acaoFilter, setorFilter) => {
    setLoading(true);
    try {
      const from = currentPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase.from('audit_logs').select('*', { count: 'exact' });

      if (searchTerm) {
        query = query.or(
          `user_email.ilike.%${searchTerm}%,detalhes.ilike.%${searchTerm}%,acao.ilike.%${searchTerm}%,setor.ilike.%${searchTerm}%`
        );
      }
      if (acaoFilter) query = query.eq('acao', acaoFilter);
      if (setorFilter) query = query.eq('setor', setorFilter);

      query = query.order('created_at', { ascending: false }).range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;
      setLogs(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error('Fetch logs error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(page, search, filterAcao, filterSetor);
  }, [page, filterAcao, filterSetor, fetchLogs]);

  const handleSearch = (value) => {
    setSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(setTimeout(() => {
      setPage(0);
      fetchLogs(0, value, filterAcao, filterSetor);
    }, 400));
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Agrupar ações únicas para o filtro
  const acoes = Object.keys(ACAO_CONFIG);
  const setores = ['master', 'financeiro', 'documentacao', 'agente'];

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-primary" /> Logs de Atividade
        </h1>
        <p className="text-text-muted text-sm mt-1">
          {totalCount.toLocaleString('pt-BR')} registros {search || filterAcao || filterSetor ? 'encontrados' : 'no total'}
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar por email, ação, detalhes..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
        </div>
        <select value={filterAcao} onChange={e => { setFilterAcao(e.target.value); setPage(0); }}
          className="px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary min-w-[150px]">
          <option value="">Todas as ações</option>
          {acoes.map(a => <option key={a} value={a}>{getAcaoConfig(a).label}</option>)}
        </select>
        <select value={filterSetor} onChange={e => { setFilterSetor(e.target.value); setPage(0); }}
          className="px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary min-w-[150px]">
          <option value="">Todos os setores</option>
          {setores.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8 gap-2 text-primary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando logs...</span>
        </div>
      )}

      {/* Tabela Desktop */}
      {!loading && (
        <>
          <div className="hidden md:block glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="text-left py-3 px-4 text-text-muted font-medium w-12"></th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Ação</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Setor</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Usuário</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Detalhes</th>
                  <th className="text-right py-3 px-4 text-text-muted font-medium">Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const config = getAcaoConfig(log.acao);
                  const Icon = config.icon;
                  return (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors cursor-pointer" onClick={() => setSelectedLog(log)}>
                      <td className="py-3 px-4">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${config.bg}`}>
                          <Icon className={`w-4 h-4 ${config.color}`} />
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-text-muted bg-surface-2 px-2 py-1 rounded-lg capitalize">
                          {log.setor || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-text text-xs">{log.user_email || '-'}</td>
                      <td className="py-3 px-4 text-text-muted text-xs max-w-[300px] truncate">{log.detalhes || '-'}</td>
                      <td className="py-3 px-4 text-right text-text-muted text-xs whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cards Mobile */}
          <div className="md:hidden space-y-2">
            {logs.map(log => {
              const config = getAcaoConfig(log.acao);
              const Icon = config.icon;
              return (
                <button key={log.id} onClick={() => setSelectedLog(log)}
                  className="w-full glass-card p-4 text-left cursor-pointer hover:border-primary/30 transition-all">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${config.bg}`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
                        <span className="text-xs text-text-muted capitalize bg-surface-2 px-1.5 py-0.5 rounded">{log.setor || '-'}</span>
                      </div>
                      <p className="text-xs text-text-muted truncate">{log.user_email || '-'}</p>
                    </div>
                    <span className="text-[10px] text-text-muted whitespace-nowrap shrink-0">{formatDateTime(log.created_at)}</span>
                  </div>
                  {log.detalhes && <p className="text-xs text-text-muted line-clamp-2 pl-11">{log.detalhes}</p>}
                </button>
              );
            })}
          </div>

          {logs.length === 0 && <p className="text-center text-text-muted py-10">Nenhum log encontrado</p>}

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between glass-card p-3">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-2 rounded-lg hover:bg-primary/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-all">
                <ChevronLeft className="w-3 h-3" /> Anterior
              </button>
              <span className="text-xs text-text-muted">
                Página <span className="font-bold text-text">{page + 1}</span> de <span className="font-bold text-text">{totalPages}</span>
                {' '}({totalCount.toLocaleString('pt-BR')} registros)
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-2 rounded-lg hover:bg-primary/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-all">
                Próxima <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal de Detalhe do Log */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedLog(null)}>
          <div className="glass-card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text">Detalhe do Log</h3>
              <button onClick={() => setSelectedLog(null)} className="text-text-muted hover:text-text cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const config = getAcaoConfig(selectedLog.acao);
              const Icon = config.icon;
              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${config.bg}`}>
                      <Icon className={`w-6 h-6 ${config.color}`} />
                    </div>
                    <div>
                      <span className={`text-sm font-bold ${config.color}`}>{config.label}</span>
                      <p className="text-xs text-text-muted capitalize">{selectedLog.setor || '-'}</p>
                    </div>
                  </div>

                  <div className="bg-surface-2 rounded-xl p-4 space-y-3">
                    <div>
                      <p className="text-xs text-text-muted mb-0.5">Usuário</p>
                      <p className="text-sm text-text font-medium">{selectedLog.user_email || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted mb-0.5">Data e Hora</p>
                      <p className="text-sm text-text font-medium">{formatDateTime(selectedLog.created_at)}</p>
                    </div>
                    {selectedLog.detalhes && (
                      <div>
                        <p className="text-xs text-text-muted mb-0.5">Detalhes</p>
                        <p className="text-sm text-text">{selectedLog.detalhes}</p>
                      </div>
                    )}
                    {selectedLog.user_id && (
                      <div>
                        <p className="text-xs text-text-muted mb-0.5">User ID</p>
                        <p className="text-xs text-text-muted font-mono break-all">{selectedLog.user_id}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
