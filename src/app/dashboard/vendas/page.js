'use client';
import { useState } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/utils';
import { exportToCSV } from '@/lib/export';
import { ShoppingCart, Search, Lock, Unlock, Loader2, Download } from 'lucide-react';

export default function VendasPage() {
  const { setor, user, hasRole } = useAuth();
  const { data: vendas, refetch } = useRealtime('vendas', { orderBy: 'created_at', orderAsc: false });
  const [search, setSearch] = useState('');
  const [filterPlaca, setFilterPlaca] = useState('');
  const [loadingId, setLoadingId] = useState(null);

  if (!hasRole(['financeiro', 'documentacao'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  const filtered = vendas.filter(v => {
    const matchSearch = !search || v.cod_cliente?.toLowerCase().includes(search.toLowerCase()) || v.razao_social?.toLowerCase().includes(search.toLowerCase()) || v.placa?.toLowerCase().includes(search.toLowerCase()) || v.marca_modelo?.toLowerCase().includes(search.toLowerCase());
    const matchPlaca = !filterPlaca || v.final_placa === filterPlaca;
    return matchSearch && matchPlaca;
  });

  const toggleBloqueio = async (venda, tipo) => {
    setLoadingId(venda.id + tipo);
    const field = tipo === 'financeiro' ? 'bloqueio_financeiro' : 'bloqueio_documentacao';
    const newValue = !venda[field];
    
    await supabase.from('vendas').update({ [field]: newValue }).eq('id', venda.id);
    
    await supabase.from('audit_logs').insert({
      acao: newValue ? 'BLOQUEIO' : 'DESBLOQUEIO',
      setor,
      detalhes: `${newValue ? 'Bloqueio' : 'Desbloqueio'} ${tipo} — Placa: ${venda.placa} | Cliente: ${venda.cod_cliente}`,
      user_id: user.id,
      user_email: user.email,
    });

    setLoadingId(null);
    refetch();
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-primary" /> Vendas
          </h1>
          <p className="text-text-muted text-sm mt-1">{filtered.length} registros</p>
        </div>
        <button onClick={() => exportToCSV(filtered, [
          { key: 'data_venda', label: 'Data', format: 'date' },
          { key: 'cod_cliente', label: 'Código' },
          { key: 'razao_social', label: 'Razão Social' },
          { key: 'placa', label: 'Placa' },
          { key: 'marca_modelo', label: 'Modelo' },
          { key: 'valor_venda_cents', label: 'Valor', format: 'currency' },
          { key: 'bloqueio_financeiro', label: 'Bloq. Financeiro' },
          { key: 'bloqueio_documentacao', label: 'Bloq. Documentação' },
        ], 'vendas')} className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary text-xs rounded-xl hover:bg-primary/20 transition-all cursor-pointer">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar código, nome, placa, modelo..." className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
        </div>
        <select value={filterPlaca} onChange={e => setFilterPlaca(e.target.value)} className="px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary">
          <option value="">Final placa</option>
          {[0,1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={String(n)}>Final {n}</option>)}
        </select>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50">
              <th className="text-left py-3 px-4 text-text-muted font-medium">Data</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Código</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Razão Social</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Placa</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Modelo</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Valor</th>
              <th className="text-center py-3 px-4 text-text-muted font-medium">Fin.</th>
              <th className="text-center py-3 px-4 text-text-muted font-medium">Doc.</th>
              <th className="text-center py-3 px-4 text-text-muted font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(v => {
              const dualBlock = v.bloqueio_financeiro && v.bloqueio_documentacao;
              return (
                <tr key={v.id} className="border-b border-border/50 hover:bg-surface-2/30">
                  <td className="py-3 px-4 text-text-muted text-xs">{formatDate(v.data_venda)}</td>
                  <td className="py-3 px-4 text-text font-mono font-bold">{v.cod_cliente}</td>
                  <td className="py-3 px-4 text-text font-medium">{v.razao_social || '-'}</td>
                  <td className="py-3 px-4 text-text font-mono">{v.placa}</td>
                  <td className="py-3 px-4 text-text-muted">{v.marca_modelo}</td>
                  <td className="py-3 px-4 text-right text-text">{formatCurrency(v.valor_venda_cents)}</td>
                  <td className="py-3 px-4 text-center">
                    {setor === 'financeiro' ? (
                      <button onClick={() => toggleBloqueio(v, 'financeiro')} disabled={loadingId === v.id + 'financeiro'} className={`px-2 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${v.bloqueio_financeiro ? 'badge-bloqueado hover:bg-danger/25' : 'badge-liberado hover:bg-success/25'}`}>
                        {loadingId === v.id + 'financeiro' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : v.bloqueio_financeiro ? '🔒 Bloq' : '🟢 Livre'}
                      </button>
                    ) : (
                      <span className={`text-xs ${v.bloqueio_financeiro ? 'text-danger' : 'text-success'}`}>{v.bloqueio_financeiro ? '🔒' : '🟢'}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {setor === 'documentacao' ? (
                      <button onClick={() => toggleBloqueio(v, 'documentacao')} disabled={loadingId === v.id + 'documentacao'} className={`px-2 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${v.bloqueio_documentacao ? 'badge-bloqueado hover:bg-danger/25' : 'badge-liberado hover:bg-success/25'}`}>
                        {loadingId === v.id + 'documentacao' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : v.bloqueio_documentacao ? '🔒 Bloq' : '🟢 Livre'}
                      </button>
                    ) : (
                      <span className={`text-xs ${v.bloqueio_documentacao ? 'text-danger' : 'text-success'}`}>{v.bloqueio_documentacao ? '🔒' : '🟢'}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs px-2 py-1 rounded-lg ${dualBlock ? 'badge-bloqueado' : 'badge-liberado'}`}>
                      {dualBlock ? '🚫 BLOQUEADO' : '✅ OK'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {filtered.map(v => {
          const dualBlock = v.bloqueio_financeiro && v.bloqueio_documentacao;
          return (
            <div key={v.id} className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-text font-mono">{v.placa}</span>
                <span className={`text-xs px-2 py-1 rounded-lg ${dualBlock ? 'badge-bloqueado' : 'badge-liberado'}`}>
                  {dualBlock ? '🚫 BLOQUEADO' : '✅ OK'}
                </span>
              </div>
              <p className="text-xs text-text-muted">{v.razao_social || v.cod_cliente} | {v.marca_modelo}</p>
              <p className="text-sm font-semibold text-text mt-1">{formatCurrency(v.valor_venda_cents)}</p>
              <div className="flex gap-2 mt-3">
                {setor === 'financeiro' && (
                  <button onClick={() => toggleBloqueio(v, 'financeiro')} className={`flex-1 py-2 rounded-xl text-xs font-medium cursor-pointer ${v.bloqueio_financeiro ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-success/10 text-success border border-success/20'}`}>
                    {v.bloqueio_financeiro ? '🔒 Desbloquear Fin.' : '🔓 Bloquear Fin.'}
                  </button>
                )}
                {setor === 'documentacao' && (
                  <button onClick={() => toggleBloqueio(v, 'documentacao')} className={`flex-1 py-2 rounded-xl text-xs font-medium cursor-pointer ${v.bloqueio_documentacao ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-success/10 text-success border border-success/20'}`}>
                    {v.bloqueio_documentacao ? '🔒 Desbloquear Doc.' : '🔓 Bloquear Doc.'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && <p className="text-center text-text-muted py-10">Nenhuma venda encontrada</p>}
    </div>
  );
}
