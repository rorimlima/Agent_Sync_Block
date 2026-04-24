'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useStats } from '@/hooks/useRealtime';
import { formatCurrency } from '@/lib/utils';
import { exportToCSV } from '@/lib/export';
import { Users, Search, Eye, X, Download, ShoppingCart, AlertTriangle, Phone, Mail, MapPin, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const PAGE_SIZE = 50;

export default function ClientesPage() {
  const { hasRole } = useAuth();
  const { stats } = useStats();
  const [clientes, setClientes] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [clientVendas, setClientVendas] = useState([]);
  const [clientInad, setClientInad] = useState([]);

  if (!hasRole(['master', 'financeiro', 'documentacao'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  // Buscar clientes com paginação server-side
  const fetchClientes = useCallback(async (currentPage, searchTerm) => {
    setLoading(true);
    try {
      const from = currentPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase.from('clientes').select('*', { count: 'exact' });

      if (searchTerm) {
        query = query.or(
          `cod_cliente.ilike.%${searchTerm}%,razao_social.ilike.%${searchTerm}%,cpf_cnpj.ilike.%${searchTerm}%,celular.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,cidade.ilike.%${searchTerm}%`
        );
      }

      query = query.order('cod_cliente', { ascending: true }).range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;
      setClientes(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error('Fetch clientes error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Buscar totais de vendas e inadimplência para os clientes exibidos na página
  const [aggregates, setAggregates] = useState({});

  const fetchAggregates = useCallback(async (clientList) => {
    if (!clientList.length) { setAggregates({}); return; }
    const cods = clientList.map(c => c.cod_cliente);

    const [{ data: vendasAgg }, { data: inadAgg }] = await Promise.all([
      supabase.from('vendas').select('cod_cliente, valor_venda_cents').in('cod_cliente', cods),
      supabase.from('inadimplencia').select('cod_cliente, valor_devido_cents, status_alerta').in('cod_cliente', cods),
    ]);

    const agg = {};
    cods.forEach(cod => { agg[cod] = { vendas_total: 0, vendas_count: 0, inad_total: 0, inad_count: 0, pior_alerta: null }; });

    (vendasAgg || []).forEach(v => {
      if (agg[v.cod_cliente]) {
        agg[v.cod_cliente].vendas_total += (v.valor_venda_cents || 0);
        agg[v.cod_cliente].vendas_count += 1;
      }
    });

    const priority = { EMERGENCIA: 3, ATENCAO: 2, LEMBRETE: 1, NORMAL: 0 };
    (inadAgg || []).forEach(i => {
      if (agg[i.cod_cliente]) {
        agg[i.cod_cliente].inad_total += (i.valor_devido_cents || 0);
        agg[i.cod_cliente].inad_count += 1;
        const cur = priority[i.status_alerta] || 0;
        const prev = priority[agg[i.cod_cliente].pior_alerta] || 0;
        if (cur > prev) agg[i.cod_cliente].pior_alerta = i.status_alerta;
      }
    });

    setAggregates(agg);
  }, []);

  useEffect(() => {
    fetchClientes(page, search);
  }, [page, fetchClientes]);

  useEffect(() => {
    if (clientes.length > 0) fetchAggregates(clientes);
  }, [clientes, fetchAggregates]);

  // Debounce search
  const handleSearch = (value) => {
    setSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(setTimeout(() => {
      setPage(0);
      fetchClientes(0, value);
    }, 400));
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const openDetail = async (client) => {
    setSelectedClient(client);
    setShowModal(true);
    // Buscar vendas e inadimplência detalhadas desse cliente
    const [{ data: v }, { data: i }] = await Promise.all([
      supabase.from('vendas').select('*').eq('cod_cliente', client.cod_cliente).order('data_venda', { ascending: false }),
      supabase.from('inadimplencia').select('*').eq('cod_cliente', client.cod_cliente).order('data_vencimento', { ascending: false }),
    ]);
    setClientVendas(v || []);
    setClientInad(i || []);
  };

  const alertBadge = (status) => {
    const map = {
      EMERGENCIA: { label: '🔴 Emergência', cls: 'badge-emergencia' },
      ATENCAO: { label: '🟠 Atenção', cls: 'badge-atencao' },
      LEMBRETE: { label: '🟡 Lembrete', cls: 'badge-lembrete' },
    };
    return map[status] || null;
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> Clientes
          </h1>
          <p className="text-text-muted text-sm mt-1">{totalCount.toLocaleString('pt-BR')} clientes {search ? 'encontrados' : 'cadastrados'}</p>
        </div>
        <button onClick={() => {
          // Exportar a página atual
          const rows = clientes.map(c => {
            const a = aggregates[c.cod_cliente] || {};
            return {
              cod_cliente: c.cod_cliente, razao_social: c.razao_social, cpf_cnpj: c.cpf_cnpj || '',
              celular: c.celular || '', email: c.email || '', cidade: c.cidade || '', estado: c.estado || '',
              total_vendas_cents: a.vendas_total || 0, qtd_vendas: a.vendas_count || 0,
              total_devido_cents: a.inad_total || 0, qtd_inadimplencia: a.inad_count || 0,
            };
          });
          exportToCSV(rows, [
            { key: 'cod_cliente', label: 'Código' }, { key: 'razao_social', label: 'Razão Social' },
            { key: 'cpf_cnpj', label: 'CPF/CNPJ' }, { key: 'celular', label: 'Celular' },
            { key: 'email', label: 'Email' }, { key: 'cidade', label: 'Cidade' },
            { key: 'total_vendas_cents', label: 'Total Vendas', format: 'currency' },
            { key: 'qtd_vendas', label: 'Qtd Vendas' },
            { key: 'total_devido_cents', label: 'Total Devedor', format: 'currency' },
            { key: 'qtd_inadimplencia', label: 'Qtd Inadimplência' },
          ], 'clientes');
        }} className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary text-xs rounded-xl hover:bg-primary/20 transition-all cursor-pointer">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {/* Resumo Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-4 border border-primary/20">
          <p className="text-xs text-text-muted">Total Clientes</p>
          <p className="text-lg font-bold text-primary">{stats.clientes.toLocaleString('pt-BR')}</p>
        </div>
        <div className="glass-card p-4 border border-success/20">
          <p className="text-xs text-text-muted">Total em Vendas</p>
          <p className="text-lg font-bold text-success">{formatCurrency(stats.total_vendas_cents)}</p>
        </div>
        <div className="glass-card p-4 border border-danger/20">
          <p className="text-xs text-text-muted">Total Devedor</p>
          <p className="text-lg font-bold text-danger">{formatCurrency(stats.total_inadimplente_cents)}</p>
        </div>
        <div className="glass-card p-4 border border-warning/20">
          <p className="text-xs text-text-muted">Com Inadimplência</p>
          <p className="text-lg font-bold text-warning">{stats.com_inadimplencia}</p>
        </div>
      </div>

      {/* Filtro */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input value={search} onChange={e => handleSearch(e.target.value)}
          placeholder="Buscar por código, nome, CPF/CNPJ, celular, email, cidade..."
          className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8 gap-2 text-primary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      )}

      {/* Desktop Table */}
      {!loading && (
        <>
          <div className="hidden md:block glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Código</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">Razão Social</th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">CPF/CNPJ</th>
                  <th className="text-right py-3 px-4 text-text-muted font-medium">Total Vendas</th>
                  <th className="text-right py-3 px-4 text-text-muted font-medium">Total Devedor</th>
                  <th className="text-center py-3 px-4 text-text-muted font-medium">Status</th>
                  <th className="text-center py-3 px-4 text-text-muted font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map(c => {
                  const a = aggregates[c.cod_cliente] || {};
                  const badge = alertBadge(a.pior_alerta);
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors">
                      <td className="py-3 px-4 text-text font-mono font-bold">{c.cod_cliente}</td>
                      <td className="py-3 px-4 text-text">{c.razao_social}</td>
                      <td className="py-3 px-4 text-text-muted text-xs">{c.cpf_cnpj || '-'}</td>
                      <td className="py-3 px-4 text-right text-success font-medium">{a.vendas_total ? formatCurrency(a.vendas_total) : '-'}</td>
                      <td className="py-3 px-4 text-right text-danger font-medium">{a.inad_total ? formatCurrency(a.inad_total) : '-'}</td>
                      <td className="py-3 px-4 text-center">
                        {badge ? (
                          <span className={`text-xs px-2 py-1 rounded-lg ${badge.cls}`}>{badge.label}</span>
                        ) : (
                          <span className="text-xs text-success">✅ OK</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button onClick={() => openDetail(c)} className="px-3 py-1.5 bg-primary/10 text-primary text-xs rounded-lg hover:bg-primary/20 transition-all cursor-pointer">
                          <Eye className="w-3 h-3 inline mr-1" /> Detalhes
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {clientes.map(c => {
              const a = aggregates[c.cod_cliente] || {};
              const badge = alertBadge(a.pior_alerta);
              return (
                <button key={c.id} onClick={() => openDetail(c)} className="w-full glass-card p-4 text-left cursor-pointer hover:border-primary/30 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-text font-mono">{c.cod_cliente}</span>
                    {badge ? (
                      <span className={`text-xs px-2 py-0.5 rounded-lg ${badge.cls}`}>{badge.label}</span>
                    ) : a.vendas_count > 0 ? (
                      <span className="text-xs text-success">✅ OK</span>
                    ) : null}
                  </div>
                  <p className="text-sm text-text font-medium truncate">{c.razao_social}</p>
                  <p className="text-xs text-text-muted">{c.cpf_cnpj || 'Sem documento'}</p>
                  <div className="flex gap-4 mt-2 text-xs">
                    {a.vendas_total > 0 && <span className="text-success">Vendas: {formatCurrency(a.vendas_total)}</span>}
                    {a.inad_total > 0 && <span className="text-danger">Deve: {formatCurrency(a.inad_total)}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {clientes.length === 0 && <p className="text-center text-text-muted py-10">Nenhum cliente encontrado</p>}

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

      {/* Modal Detalhes do Cliente */}
      {showModal && selectedClient && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="glass-card w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text">Detalhes do Cliente</h3>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            {/* Info Principal */}
            <div className="bg-surface-2 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg">
                  {selectedClient.razao_social?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="text-sm font-bold text-text">{selectedClient.razao_social}</p>
                  <p className="text-xs text-text-muted font-mono">{selectedClient.cod_cliente}</p>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                {selectedClient.cpf_cnpj && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <span className="font-medium text-text">CPF/CNPJ:</span> {selectedClient.cpf_cnpj}
                  </div>
                )}
                {selectedClient.celular && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <Phone className="w-3 h-3" /> {selectedClient.celular}
                  </div>
                )}
                {selectedClient.email && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <Mail className="w-3 h-3" /> {selectedClient.email}
                  </div>
                )}
                {(selectedClient.cidade || selectedClient.estado) && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <MapPin className="w-3 h-3" /> {[selectedClient.endereco, selectedClient.cidade, selectedClient.estado].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
            </div>

            {/* Cards de Totais */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 bg-success/5 border border-success/20 rounded-xl text-center">
                <ShoppingCart className="w-4 h-4 text-success mx-auto mb-1" />
                <p className="text-lg font-bold text-success">{formatCurrency(clientVendas.reduce((a, v) => a + (v.valor_venda_cents || 0), 0))}</p>
                <p className="text-xs text-text-muted">{clientVendas.length} vendas</p>
              </div>
              <div className="p-3 bg-danger/5 border border-danger/20 rounded-xl text-center">
                <AlertTriangle className="w-4 h-4 text-danger mx-auto mb-1" />
                <p className="text-lg font-bold text-danger">{formatCurrency(clientInad.reduce((a, i) => a + (i.valor_devido_cents || 0), 0))}</p>
                <p className="text-xs text-text-muted">{clientInad.length} parcelas</p>
              </div>
            </div>

            {/* Veículos vinculados */}
            <div>
              <p className="text-sm font-semibold text-text mb-2">Veículos Vinculados</p>
              {clientVendas.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-4">Nenhum veículo</p>
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

            {/* Inadimplências vinculadas */}
            {clientInad.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-text mb-2">Inadimplências</p>
                <div className="space-y-2">
                  {clientInad.map(i => (
                    <div key={i.id} className="p-3 bg-danger/5 rounded-xl border border-danger/20">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-danger">{formatCurrency(i.valor_devido_cents)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-lg ${
                          i.status_alerta === 'EMERGENCIA' ? 'badge-emergencia' :
                          i.status_alerta === 'ATENCAO' ? 'badge-atencao' :
                          i.status_alerta === 'LEMBRETE' ? 'badge-lembrete' : 'badge-normal'
                        }`}>
                          {i.status_alerta}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted mt-1">
                        Vencimento: {i.data_vencimento ? new Date(i.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}
                        {i.dias_atraso > 0 && <span className="text-danger ml-2">({i.dias_atraso} dias atraso)</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
