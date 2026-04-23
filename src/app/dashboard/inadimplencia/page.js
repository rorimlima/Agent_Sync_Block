'use client';
import { useState } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, getAlertBadgeClass, getAlertEmoji, getAlertLabel } from '@/lib/utils';
import { AlertTriangle, Search, X, Car } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function InadimplenciaPage() {
  const { hasRole } = useAuth();
  const { data: inadimplencia } = useRealtime('inadimplencia', { orderBy: 'valor_devido_cents', orderAsc: false });
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientVendas, setClientVendas] = useState([]);
  const [showModal, setShowModal] = useState(false);

  if (!hasRole(['financeiro', 'documentacao'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  const filtered = inadimplencia.filter(item => {
    const matchSearch = !search || 
      item.cod_cliente?.toLowerCase().includes(search.toLowerCase()) ||
      item.cpf_cnpj?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !filterStatus || item.status_alerta === filterStatus;
    return matchSearch && matchStatus;
  });

  // Agrupar por cod_cliente
  const grouped = {};
  filtered.forEach(item => {
    const key = item.cod_cliente || 'sem_cod';
    if (!grouped[key]) grouped[key] = { cod_cliente: item.cod_cliente, cpf_cnpj: item.cpf_cnpj, total: 0, items: [], worst: 'NORMAL' };
    grouped[key].total += item.valor_devido_cents || 0;
    grouped[key].items.push(item);
    const priority = { EMERGENCIA: 3, ATENCAO: 2, LEMBRETE: 1, NORMAL: 0 };
    if (priority[item.status_alerta] > priority[grouped[key].worst]) grouped[key].worst = item.status_alerta;
  });
  const clientList = Object.values(grouped).sort((a, b) => b.total - a.total);

  const openClientDetail = async (client) => {
    setSelectedClient(client);
    const { data } = await supabase.from('vendas').select('*').eq('cod_cliente', client.cod_cliente);
    setClientVendas(data || []);
    setShowModal(true);
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-danger" /> Inadimplência
        </h1>
        <p className="text-text-muted text-sm mt-1">{clientList.length} clientes inadimplentes</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por código ou CPF/CNPJ..." className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary">
          <option value="">Todos os status</option>
          <option value="EMERGENCIA">🔴 Emergência</option>
          <option value="ATENCAO">🟠 Atenção</option>
          <option value="LEMBRETE">🟡 Lembrete</option>
        </select>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50">
              <th className="text-left py-3 px-4 text-text-muted font-medium">Status</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Cód. Cliente</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">CPF/CNPJ</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Total Devedor</th>
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
                <td className="py-3 px-4 text-text font-medium">{client.cod_cliente}</td>
                <td className="py-3 px-4 text-text-muted">{client.cpf_cnpj || '-'}</td>
                <td className="py-3 px-4 text-right text-danger font-bold">{formatCurrency(client.total)}</td>
                <td className="py-3 px-4 text-center">
                  <button onClick={() => openClientDetail(client)} className="px-3 py-1.5 bg-primary/10 text-primary text-xs rounded-lg hover:bg-primary/20 transition-all cursor-pointer">
                    <Car className="w-3 h-3 inline mr-1" /> Veículos
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
          <button key={client.cod_cliente} onClick={() => openClientDetail(client)} className="w-full glass-card p-4 text-left cursor-pointer hover:border-primary/30 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${getAlertBadgeClass(client.worst)}`}>
                {getAlertEmoji(client.worst)} {getAlertLabel(client.worst)}
              </span>
              <span className="text-danger font-bold text-sm">{formatCurrency(client.total)}</span>
            </div>
            <p className="text-sm font-medium text-text">{client.cod_cliente}</p>
            <p className="text-xs text-text-muted">{client.cpf_cnpj || '-'}</p>
          </button>
        ))}
      </div>

      {clientList.length === 0 && <p className="text-center text-text-muted py-10">Nenhum registro encontrado</p>}

      {/* Modal Veículos */}
      {showModal && selectedClient && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="glass-card w-full max-w-lg max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text">Veículos — {selectedClient.cod_cliente}</h3>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            {clientVendas.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-6">Nenhum veículo vinculado</p>
            ) : (
              <div className="space-y-3">
                {clientVendas.map(v => (
                  <div key={v.id} className="p-3 bg-surface-2 rounded-xl border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-text">{v.placa}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${v.bloqueio_financeiro && v.bloqueio_documentacao ? 'badge-bloqueado' : 'badge-liberado'}`}>
                        {v.bloqueio_financeiro && v.bloqueio_documentacao ? '🔒 Bloqueado' : '✅ Livre'}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted">{v.marca_modelo}</p>
                    <div className="flex gap-3 mt-2 text-xs text-text-muted">
                      <span>Fin: {v.bloqueio_financeiro ? '🔴' : '🟢'}</span>
                      <span>Doc: {v.bloqueio_documentacao ? '🔴' : '🟢'}</span>
                    </div>
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
