'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useStats } from '@/hooks/useRealtime';
import { formatCurrency, getAlertBadgeClass, getAlertEmoji, getAlertLabel } from '@/lib/utils';
import { exportToCSV } from '@/lib/export';
import { AlertTriangle, Search, X, Car, Download, ChevronLeft, ChevronRight, Loader2, Users } from 'lucide-react';

const PAGE_SIZE = 50;

export default function InadimplenciaPage() {
  const { hasRole } = useAuth();
  const { stats } = useStats();
  const [clientList, setClientList] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientVendas, setClientVendas] = useState([]);
  const [clientInadList, setClientInadList] = useState([]);
  const [showModal, setShowModal] = useState(false);

  if (!hasRole(['financeiro', 'documentacao'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  // Buscar inadimplência agrupada por cod_cliente com paginação
  const fetchData = useCallback(async (currentPage, searchTerm, statusFilter) => {
    setLoading(true);
    try {
      // Buscar inadimplências com filtros
      let query = supabase.from('inadimplencia')
        .select('cod_cliente, razao_social, cpf_cnpj, valor_devido_cents, status_alerta', { count: 'exact' });

      if (searchTerm) {
        query = query.or(
          `cod_cliente.ilike.%${searchTerm}%,razao_social.ilike.%${searchTerm}%,cpf_cnpj.ilike.%${searchTerm}%`
        );
      }
      if (statusFilter) {
        query = query.eq('status_alerta', statusFilter);
      }

      // Buscar todos para agrupar (inadimplência tem menos registros que clientes)
      let allRows = [];
      let pg = 0;
      let more = true;
      while (more) {
        let q = supabase.from('inadimplencia')
          .select('cod_cliente, razao_social, cpf_cnpj, valor_devido_cents, status_alerta');
        if (searchTerm) {
          q = q.or(`cod_cliente.ilike.%${searchTerm}%,razao_social.ilike.%${searchTerm}%,cpf_cnpj.ilike.%${searchTerm}%`);
        }
        if (statusFilter) {
          q = q.eq('status_alerta', statusFilter);
        }
        q = q.range(pg * 1000, (pg + 1) * 1000 - 1);
        const { data: batch } = await q;
        const rows = batch || [];
        allRows = allRows.concat(rows);
        more = rows.length === 1000;
        pg++;
      }

      // Agrupar por cod_cliente
      const grouped = {};
      allRows.forEach(item => {
        const key = item.cod_cliente || 'sem_cod';
        if (!grouped[key]) {
          grouped[key] = {
            cod_cliente: item.cod_cliente,
            razao_social: item.razao_social || '',
            cpf_cnpj: item.cpf_cnpj,
            total: 0,
            count: 0,
            worst: 'NORMAL',
          };
        }
        grouped[key].total += item.valor_devido_cents || 0;
        grouped[key].count += 1;
        if (!grouped[key].razao_social && item.razao_social) grouped[key].razao_social = item.razao_social;
        const priority = { EMERGENCIA: 3, ATENCAO: 2, LEMBRETE: 1, NORMAL: 0 };
        if ((priority[item.status_alerta] || 0) > (priority[grouped[key].worst] || 0)) {
          grouped[key].worst = item.status_alerta;
        }
      });

      const sorted = Object.values(grouped).sort((a, b) => b.total - a.total);
      setTotalCount(sorted.length);

      // Paginar os resultados agrupados
      const start = currentPage * PAGE_SIZE;
      const paged = sorted.slice(start, start + PAGE_SIZE);
      setClientList(paged);
    } catch (err) {
      console.error('Fetch inad error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(page, search, filterStatus);
  }, [page, filterStatus, fetchData]);

  const handleSearch = (value) => {
    setSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(setTimeout(() => {
      setPage(0);
      fetchData(0, value, filterStatus);
    }, 400));
  };

  const handleFilterStatus = (value) => {
    setFilterStatus(value);
    setPage(0);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const openClientDetail = async (client) => {
    setSelectedClient(client);
    const [{ data: vendas }, { data: inad }] = await Promise.all([
      supabase.from('vendas').select('*').eq('cod_cliente', client.cod_cliente),
      supabase.from('inadimplencia').select('*').eq('cod_cliente', client.cod_cliente).order('data_vencimento', { ascending: false }),
    ]);
    setClientVendas(vendas || []);
    setClientInadList(inad || []);
    setShowModal(true);
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-danger" /> Inadimplência
          </h1>
          <p className="text-text-muted text-sm mt-1">{totalCount} clientes inadimplentes</p>
        </div>
        <button onClick={() => exportToCSV(clientList, [
          { key: 'cod_cliente', label: 'Cód. Cliente' },
          { key: 'razao_social', label: 'Razão Social' },
          { key: 'cpf_cnpj', label: 'CPF/CNPJ' },
          { key: 'total', label: 'Total Devido', format: 'currency' },
          { key: 'count', label: 'Parcelas' },
          { key: 'worst', label: 'Status' },
        ], 'inadimplencia')} className="flex items-center gap-2 px-3 py-2 bg-danger/10 text-danger text-xs rounded-xl hover:bg-danger/20 transition-all cursor-pointer">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {/* Resumo Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-4 border border-danger/20">
          <p className="text-xs text-text-muted">Total Devedor</p>
          <p className="text-lg font-bold text-danger">{formatCurrency(stats.total_inadimplente_cents)}</p>
        </div>
        <div className="glass-card p-4 border border-danger/20">
          <p className="text-xs text-text-muted">🔴 Emergência</p>
          <p className="text-lg font-bold text-danger">{stats.emergencias}</p>
        </div>
        <div className="glass-card p-4 border border-warning/20">
          <p className="text-xs text-text-muted">🟠 Atenção</p>
          <p className="text-lg font-bold text-warning">{stats.atencao}</p>
        </div>
        <div className="glass-card p-4 border border-alert/20">
          <p className="text-xs text-text-muted">🟡 Lembrete</p>
          <p className="text-lg font-bold text-alert">{stats.lembretes}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar por código, nome, CPF/CNPJ..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
        </div>
        <select value={filterStatus} onChange={e => handleFilterStatus(e.target.value)}
          className="px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary">
          <option value="">Todos os status</option>
          <option value="EMERGENCIA">🔴 Emergência</option>
          <option value="ATENCAO">🟠 Atenção</option>
          <option value="LEMBRETE">🟡 Lembrete</option>
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 gap-2 text-danger">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      )}

      {!loading && (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Status</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Cód. Cliente</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Razão Social</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">CPF/CNPJ</th>
                  <th className="text-right py-3 px-4 text-text-muted font-medium">Total Devedor</th>
                  <th className="text-center py-3 px-4 text-text-muted font-medium">Parcelas</th>
                  <th className="text-center py-3 px-4 text-text-muted font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {clientList.map(client => (
                  <tr key={client.cod_cliente} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors">
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${getAlertBadgeClass(client.worst)}`}>
                        {getAlertEmoji(client.worst)} {getAlertLabel(client.worst)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text font-mono font-bold">{client.cod_cliente}</td>
                    <td className="py-3 px-4 text-text font-medium">{client.razao_social || '-'}</td>
                    <td className="py-3 px-4 text-text-muted text-xs">{client.cpf_cnpj || '-'}</td>
                    <td className="py-3 px-4 text-right text-danger font-bold">{formatCurrency(client.total)}</td>
                    <td className="py-3 px-4 text-center text-text-muted">{client.count}</td>
                    <td className="py-3 px-4 text-center">
                      <button onClick={() => openClientDetail(client)} className="px-3 py-1.5 bg-primary/10 text-primary text-xs rounded-lg hover:bg-primary/20 transition-all cursor-pointer">
                        <Car className="w-3 h-3 inline mr-1" /> Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {clientList.map(client => (
              <button key={client.cod_cliente} onClick={() => openClientDetail(client)}
                className="w-full glass-card p-4 text-left cursor-pointer hover:border-primary/30 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${getAlertBadgeClass(client.worst)}`}>
                    {getAlertEmoji(client.worst)} {getAlertLabel(client.worst)}
                  </span>
                  <span className="text-danger font-bold text-sm">{formatCurrency(client.total)}</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-mono font-bold text-text">{client.cod_cliente}</span>
                  <span className="text-xs text-text-muted">•</span>
                  <span className="text-sm font-medium text-text truncate">{client.razao_social || '-'}</span>
                </div>
                <p className="text-xs text-text-muted">{client.cpf_cnpj || '-'} • {client.count} parcelas</p>
              </button>
            ))}
          </div>

          {clientList.length === 0 && <p className="text-center text-text-muted py-10">Nenhum registro encontrado</p>}

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between glass-card p-3">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-2 rounded-lg hover:bg-primary/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-all">
                <ChevronLeft className="w-3 h-3" /> Anterior
              </button>
              <span className="text-xs text-text-muted">
                Página <span className="font-bold text-text">{page + 1}</span> de <span className="font-bold text-text">{totalPages}</span>
                {' '}({totalCount} clientes)
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-2 rounded-lg hover:bg-primary/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-all">
                Próxima <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal Detalhes do Cliente */}
      {showModal && selectedClient && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="glass-card w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text">
                {selectedClient.razao_social || selectedClient.cod_cliente}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Info */}
            <div className="bg-surface-2 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-danger/20 flex items-center justify-center text-danger font-bold text-lg">
                  {(selectedClient.razao_social || selectedClient.cod_cliente)?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="text-sm font-bold text-text">{selectedClient.razao_social || '-'}</p>
                  <p className="text-xs text-text-muted font-mono">Cód: {selectedClient.cod_cliente} • {selectedClient.cpf_cnpj || 'Sem doc'}</p>
                </div>
              </div>
            </div>

            {/* Total Devedor */}
            <div className="p-3 bg-danger/5 border border-danger/20 rounded-xl text-center mb-4">
              <p className="text-2xl font-bold text-danger">{formatCurrency(selectedClient.total)}</p>
              <p className="text-xs text-text-muted">{selectedClient.count} parcelas em aberto</p>
            </div>

            {/* Parcelas detalhadas */}
            <p className="text-sm font-semibold text-text mb-2">Parcelas</p>
            <div className="space-y-2 mb-4">
              {clientInadList.map(i => (
                <div key={i.id} className="p-3 bg-danger/5 rounded-xl border border-danger/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-danger">{formatCurrency(i.valor_devido_cents)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-lg ${getAlertBadgeClass(i.status_alerta)}`}>
                      {getAlertEmoji(i.status_alerta)} {getAlertLabel(i.status_alerta)}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Vencimento: {i.data_vencimento ? new Date(i.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}
                    {i.dias_atraso > 0 && <span className="text-danger ml-2">({i.dias_atraso} dias atraso)</span>}
                  </p>
                </div>
              ))}
              {clientInadList.length === 0 && <p className="text-xs text-text-muted text-center py-4">Carregando...</p>}
            </div>

            {/* Veículos vinculados */}
            <p className="text-sm font-semibold text-text mb-2">Veículos Vinculados</p>
            {clientVendas.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-4">Nenhum veículo vinculado</p>
            ) : (
              <div className="space-y-2">
                {clientVendas.map(v => (
                  <div key={v.id} className="p-3 bg-surface-2 rounded-xl border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-text font-mono">{v.placa || '-'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${v.bloqueio_financeiro && v.bloqueio_documentacao ? 'badge-bloqueado' : 'badge-liberado'}`}>
                        {v.bloqueio_financeiro && v.bloqueio_documentacao ? '🔒 Bloqueado' : '✅ Livre'}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted">{v.marca_modelo || '-'}</p>
                    <p className="text-xs text-success mt-1">{formatCurrency(v.valor_venda_cents)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
