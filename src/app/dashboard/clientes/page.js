'use client';
import { useState, useMemo } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency } from '@/lib/utils';
import { exportToCSV } from '@/lib/export';
import { Users, Search, Eye, X, Download, ShoppingCart, AlertTriangle, Phone, Mail, MapPin } from 'lucide-react';

export default function ClientesPage() {
  const { hasRole } = useAuth();
  const { data: clientes } = useRealtime('clientes', { orderBy: 'cod_cliente', orderAsc: true });
  const { data: vendas } = useRealtime('vendas');
  const { data: inadimplencia } = useRealtime('inadimplencia');
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [showModal, setShowModal] = useState(false);

  if (!hasRole(['financeiro', 'documentacao'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  // Agregar totais por cod_cliente
  const clientesEnriquecidos = useMemo(() => {
    const vendasMap = {};
    const inadMap = {};

    vendas.forEach(v => {
      const cod = v.cod_cliente;
      if (!vendasMap[cod]) vendasMap[cod] = { total: 0, count: 0, bloqueados: 0 };
      vendasMap[cod].total += (v.valor_venda_cents || 0);
      vendasMap[cod].count += 1;
      if (v.bloqueio_financeiro && v.bloqueio_documentacao) vendasMap[cod].bloqueados += 1;
    });

    inadimplencia.forEach(i => {
      const cod = i.cod_cliente;
      if (!inadMap[cod]) inadMap[cod] = { total: 0, count: 0, worst: 'NORMAL' };
      inadMap[cod].total += (i.valor_devido_cents || 0);
      inadMap[cod].count += 1;
      const priority = { EMERGENCIA: 3, ATENCAO: 2, LEMBRETE: 1, NORMAL: 0 };
      if (priority[i.status_alerta] > priority[inadMap[cod].worst]) inadMap[cod].worst = i.status_alerta;
    });

    return clientes.map(c => ({
      ...c,
      total_vendas_cents: vendasMap[c.cod_cliente]?.total || 0,
      qtd_vendas: vendasMap[c.cod_cliente]?.count || 0,
      veiculos_bloqueados: vendasMap[c.cod_cliente]?.bloqueados || 0,
      total_devido_cents: inadMap[c.cod_cliente]?.total || 0,
      qtd_inadimplencia: inadMap[c.cod_cliente]?.count || 0,
      pior_alerta: inadMap[c.cod_cliente]?.worst || null,
    }));
  }, [clientes, vendas, inadimplencia]);

  const filtered = clientesEnriquecidos.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.cod_cliente?.toLowerCase().includes(q) ||
      c.razao_social?.toLowerCase().includes(q) ||
      c.cpf_cnpj?.toLowerCase().includes(q) ||
      c.celular?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.cidade?.toLowerCase().includes(q)
    );
  });

  const openDetail = (client) => {
    setSelectedClient(client);
    setShowModal(true);
  };

  const alertBadge = (status) => {
    const map = {
      EMERGENCIA: { label: '🔴 Emergência', cls: 'badge-emergencia' },
      ATENCAO: { label: '🟠 Atenção', cls: 'badge-atencao' },
      LEMBRETE: { label: '🟡 Lembrete', cls: 'badge-lembrete' },
    };
    return map[status] || null;
  };

  // Dados para exportação
  const exportData = filtered.map(c => ({
    cod_cliente: c.cod_cliente,
    razao_social: c.razao_social,
    cpf_cnpj: c.cpf_cnpj || '',
    celular: c.celular || '',
    email: c.email || '',
    cidade: c.cidade || '',
    estado: c.estado || '',
    total_vendas_cents: c.total_vendas_cents,
    qtd_vendas: c.qtd_vendas,
    total_devido_cents: c.total_devido_cents,
    qtd_inadimplencia: c.qtd_inadimplencia,
  }));

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> Clientes
          </h1>
          <p className="text-text-muted text-sm mt-1">{filtered.length} clientes cadastrados</p>
        </div>
        <button onClick={() => exportToCSV(exportData, [
          { key: 'cod_cliente', label: 'Código' },
          { key: 'razao_social', label: 'Razão Social' },
          { key: 'cpf_cnpj', label: 'CPF/CNPJ' },
          { key: 'celular', label: 'Celular' },
          { key: 'email', label: 'Email' },
          { key: 'cidade', label: 'Cidade' },
          { key: 'total_vendas_cents', label: 'Total Vendas', format: 'currency' },
          { key: 'qtd_vendas', label: 'Qtd Vendas' },
          { key: 'total_devido_cents', label: 'Total Devedor', format: 'currency' },
          { key: 'qtd_inadimplencia', label: 'Qtd Inadimplência' },
        ], 'clientes')} className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary text-xs rounded-xl hover:bg-primary/20 transition-all cursor-pointer">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {/* Resumo Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-4 border border-primary/20">
          <p className="text-xs text-text-muted">Total Clientes</p>
          <p className="text-lg font-bold text-primary">{clientes.length}</p>
        </div>
        <div className="glass-card p-4 border border-success/20">
          <p className="text-xs text-text-muted">Total em Vendas</p>
          <p className="text-lg font-bold text-success">{formatCurrency(clientesEnriquecidos.reduce((a, c) => a + c.total_vendas_cents, 0))}</p>
        </div>
        <div className="glass-card p-4 border border-danger/20">
          <p className="text-xs text-text-muted">Total Devedor</p>
          <p className="text-lg font-bold text-danger">{formatCurrency(clientesEnriquecidos.reduce((a, c) => a + c.total_devido_cents, 0))}</p>
        </div>
        <div className="glass-card p-4 border border-warning/20">
          <p className="text-xs text-text-muted">Com Inadimplência</p>
          <p className="text-lg font-bold text-warning">{clientesEnriquecidos.filter(c => c.qtd_inadimplencia > 0).length}</p>
        </div>
      </div>

      {/* Filtro */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por código, nome, CPF/CNPJ, celular, email, cidade..."
          className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
      </div>

      {/* Desktop Table */}
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
            {filtered.map(c => {
              const badge = alertBadge(c.pior_alerta);
              return (
                <tr key={c.id} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors">
                  <td className="py-3 px-4 text-text font-mono font-bold">{c.cod_cliente}</td>
                  <td className="py-3 px-4 text-text">{c.razao_social}</td>
                  <td className="py-3 px-4 text-text-muted text-xs">{c.cpf_cnpj || '-'}</td>
                  <td className="py-3 px-4 text-right text-success font-medium">{formatCurrency(c.total_vendas_cents)}</td>
                  <td className="py-3 px-4 text-right text-danger font-medium">{c.total_devido_cents > 0 ? formatCurrency(c.total_devido_cents) : '-'}</td>
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
        {filtered.map(c => {
          const badge = alertBadge(c.pior_alerta);
          return (
            <button key={c.id} onClick={() => openDetail(c)} className="w-full glass-card p-4 text-left cursor-pointer hover:border-primary/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-text font-mono">{c.cod_cliente}</span>
                {badge ? (
                  <span className={`text-xs px-2 py-0.5 rounded-lg ${badge.cls}`}>{badge.label}</span>
                ) : c.qtd_vendas > 0 ? (
                  <span className="text-xs text-success">✅ OK</span>
                ) : null}
              </div>
              <p className="text-sm text-text font-medium truncate">{c.razao_social}</p>
              <p className="text-xs text-text-muted">{c.cpf_cnpj || 'Sem documento'}</p>
              <div className="flex gap-4 mt-2 text-xs">
                <span className="text-success">Vendas: {formatCurrency(c.total_vendas_cents)}</span>
                {c.total_devido_cents > 0 && <span className="text-danger">Deve: {formatCurrency(c.total_devido_cents)}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && <p className="text-center text-text-muted py-10">Nenhum cliente encontrado</p>}

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
                <p className="text-lg font-bold text-success">{formatCurrency(selectedClient.total_vendas_cents)}</p>
                <p className="text-xs text-text-muted">{selectedClient.qtd_vendas} vendas</p>
              </div>
              <div className="p-3 bg-danger/5 border border-danger/20 rounded-xl text-center">
                <AlertTriangle className="w-4 h-4 text-danger mx-auto mb-1" />
                <p className="text-lg font-bold text-danger">{formatCurrency(selectedClient.total_devido_cents)}</p>
                <p className="text-xs text-text-muted">{selectedClient.qtd_inadimplencia} parcelas</p>
              </div>
            </div>

            {/* Veículos vinculados */}
            <div>
              <p className="text-sm font-semibold text-text mb-2">Veículos Vinculados</p>
              {vendas.filter(v => v.cod_cliente === selectedClient.cod_cliente).length === 0 ? (
                <p className="text-xs text-text-muted text-center py-4">Nenhum veículo</p>
              ) : (
                <div className="space-y-2">
                  {vendas.filter(v => v.cod_cliente === selectedClient.cod_cliente).map(v => (
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
            {inadimplencia.filter(i => i.cod_cliente === selectedClient.cod_cliente).length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-text mb-2">Inadimplências</p>
                <div className="space-y-2">
                  {inadimplencia.filter(i => i.cod_cliente === selectedClient.cod_cliente).map(i => (
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
