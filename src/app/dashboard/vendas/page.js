'use client';
import { useState } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/utils';
import { exportToCSV } from '@/lib/export';
import { ShoppingCart, Search, Lock, Unlock, LockOpen, Loader2, Download, Filter, X, Shield, FileText } from 'lucide-react';

export default function VendasPage() {
  const { setor, user, hasRole } = useAuth();
  const { data: vendas, refetch } = useRealtime('vendas', { orderBy: 'created_at', orderAsc: false });
  const [search, setSearch] = useState('');
  const [filterBloqueio, setFilterBloqueio] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [loadingId, setLoadingId] = useState(null);

  if (!hasRole(['financeiro', 'documentacao'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  const filtered = vendas.filter(v => {
    const s = search.toLowerCase();
    const matchSearch = !search ||
      v.cod_cliente?.toLowerCase().includes(s) ||
      v.razao_social?.toLowerCase().includes(s) ||
      v.placa?.toLowerCase().includes(s) ||
      v.chassi?.toLowerCase().includes(s) ||
      v.marca_modelo?.toLowerCase().includes(s) ||
      String(v.valor_venda_cents || '').includes(s);

    let matchBloqueio = true;
    if (filterBloqueio === 'bloqueado') matchBloqueio = v.bloqueio_financeiro && v.bloqueio_documentacao;
    else if (filterBloqueio === 'bloq_fin') matchBloqueio = v.bloqueio_financeiro === true;
    else if (filterBloqueio === 'bloq_doc') matchBloqueio = v.bloqueio_documentacao === true;
    else if (filterBloqueio === 'livre') matchBloqueio = !v.bloqueio_financeiro && !v.bloqueio_documentacao;

    return matchSearch && matchBloqueio;
  });

  const toggleBloqueio = async (venda, tipo) => {
    setLoadingId(venda.id + tipo);
    const field = tipo === 'financeiro' ? 'bloqueio_financeiro' : 'bloqueio_documentacao';
    const newValue = !venda[field];

    await supabase.from('vendas').update({ [field]: newValue }).eq('id', venda.id);

    // Verificar bloqueio duplo para atualizar veiculos_bloqueados
    const otherField = tipo === 'financeiro' ? 'bloqueio_documentacao' : 'bloqueio_financeiro';
    const dualBlock = newValue && venda[otherField];
    if (dualBlock && venda.placa) {
      await supabase.from('veiculos_bloqueados').upsert({
        placa: venda.placa, cod_cliente: venda.cod_cliente,
        status_final: 'VEÍCULO BLOQUEADO', razao_social: venda.razao_social,
      }, { onConflict: 'placa' });
    }

    await supabase.from('audit_logs').insert({
      acao: newValue ? 'BLOQUEIO' : 'DESBLOQUEIO', setor,
      detalhes: `${newValue ? 'Bloqueio' : 'Desbloqueio'} ${tipo} — Placa: ${venda.placa} | ${venda.razao_social || venda.cod_cliente}`,
      user_id: user.id, user_email: user.email,
    });

    setLoadingId(null);
    refetch();
  };

  const activeFilters = [filterBloqueio].filter(Boolean).length;

  const BloqueioBtn = ({ venda, tipo }) => {
    const field = tipo === 'financeiro' ? 'bloqueio_financeiro' : 'bloqueio_documentacao';
    const isBlocked = venda[field];
    const canToggle = (tipo === 'financeiro' && setor === 'financeiro') || (tipo === 'documentacao' && setor === 'documentacao');
    const isLoading = loadingId === venda.id + tipo;
    const Icon = tipo === 'financeiro' ? Shield : FileText;
    const label = tipo === 'financeiro' ? 'Fin' : 'Doc';

    if (!canToggle) {
      return (
        <div className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${isBlocked ? 'bg-danger/8 text-danger border border-danger/15' : 'bg-success/8 text-success border border-success/15'}`}>
          <Icon className="w-3 h-3" />
          {isBlocked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
        </div>
      );
    }

    return (
      <button onClick={() => toggleBloqueio(venda, tipo)} disabled={isLoading}
        className={`group relative inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
          isBlocked
            ? 'bg-gradient-to-r from-danger/15 to-danger/5 text-danger border border-danger/25 hover:from-danger/25 hover:to-danger/15 hover:border-danger/40 hover:shadow-[0_0_15px_rgba(239,68,68,0.15)]'
            : 'bg-gradient-to-r from-success/15 to-success/5 text-success border border-success/25 hover:from-success/25 hover:to-success/15 hover:border-success/40 hover:shadow-[0_0_15px_rgba(34,197,94,0.15)]'
        }`}>
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <>
            <Icon className="w-3.5 h-3.5" />
            {isBlocked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
            <span className="hidden lg:inline">{isBlocked ? `Desbloquear ${label}` : `Bloquear ${label}`}</span>
          </>
        )}
      </button>
    );
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
          { key: 'chassi', label: 'Chassi' },
          { key: 'marca_modelo', label: 'Modelo' },
          { key: 'valor_venda_cents', label: 'Valor', format: 'currency' },
          { key: 'bloqueio_financeiro', label: 'Bloq. Financeiro' },
          { key: 'bloqueio_documentacao', label: 'Bloq. Documentação' },
        ], 'vendas')} className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary text-xs rounded-xl hover:bg-primary/20 transition-all cursor-pointer">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {/* Search + Filter Toggle */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por placa, chassi, razão social, código, modelo, valor..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all border ${showFilters || activeFilters > 0 ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface text-text-muted border-border hover:border-primary/30'}`}>
          <Filter className="w-4 h-4" />
          Filtros {activeFilters > 0 && <span className="w-5 h-5 flex items-center justify-center bg-primary text-white text-[10px] rounded-full font-bold">{activeFilters}</span>}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="glass-card p-4 flex flex-wrap gap-3 items-center">
          <select value={filterBloqueio} onChange={e => setFilterBloqueio(e.target.value)}
            className="px-3 py-2 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary">
            <option value="">Status bloqueio</option>
            <option value="bloqueado">🚫 Bloqueado (duplo)</option>
            <option value="bloq_fin">🔒 Bloq. Financeiro</option>
            <option value="bloq_doc">🔒 Bloq. Documentação</option>
            <option value="livre">✅ Livre</option>
          </select>
          {activeFilters > 0 && (
            <button onClick={() => setFilterBloqueio('')}
              className="flex items-center gap-1 px-3 py-2 text-xs text-danger bg-danger/10 rounded-xl hover:bg-danger/20 cursor-pointer transition-all">
              <X className="w-3 h-3" /> Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden md:block glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50">
              <th className="text-left py-3 px-3 text-text-muted font-medium">Código</th>
              <th className="text-left py-3 px-3 text-text-muted font-medium">Razão Social</th>
              <th className="text-left py-3 px-3 text-text-muted font-medium">Placa</th>
              <th className="text-left py-3 px-3 text-text-muted font-medium">Chassi</th>
              <th className="text-left py-3 px-3 text-text-muted font-medium">Modelo</th>
              <th className="text-right py-3 px-3 text-text-muted font-medium">Valor</th>
              <th className="text-center py-3 px-3 text-text-muted font-medium">Financeiro</th>
              <th className="text-center py-3 px-3 text-text-muted font-medium">Documentação</th>
              <th className="text-center py-3 px-3 text-text-muted font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(v => {
              const dualBlock = v.bloqueio_financeiro && v.bloqueio_documentacao;
              return (
                <tr key={v.id} className={`border-b border-border/50 transition-colors ${dualBlock ? 'bg-danger/3 hover:bg-danger/6' : 'hover:bg-surface-2/30'}`}>
                  <td className="py-3 px-3 text-text font-mono font-bold text-xs">{v.cod_cliente}</td>
                  <td className="py-3 px-3 text-text font-medium text-xs">{v.razao_social || '-'}</td>
                  <td className="py-3 px-3 text-text font-mono font-bold">{v.placa || '-'}</td>
                  <td className="py-3 px-3 text-text-muted font-mono text-xs">{v.chassi || '-'}</td>
                  <td className="py-3 px-3 text-text-muted text-xs">{v.marca_modelo || '-'}</td>
                  <td className="py-3 px-3 text-right text-text font-medium">{formatCurrency(v.valor_venda_cents)}</td>
                  <td className="py-3 px-3 text-center"><BloqueioBtn venda={v} tipo="financeiro" /></td>
                  <td className="py-3 px-3 text-center"><BloqueioBtn venda={v} tipo="documentacao" /></td>
                  <td className="py-3 px-3 text-center">
                    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-semibold ${dualBlock ? 'bg-danger/10 text-danger border border-danger/20' : v.bloqueio_financeiro || v.bloqueio_documentacao ? 'bg-warning/10 text-warning border border-warning/20' : 'bg-success/10 text-success border border-success/20'}`}>
                      {dualBlock ? <><Lock className="w-3 h-3" /> BLOQUEADO</> : v.bloqueio_financeiro || v.bloqueio_documentacao ? <><Lock className="w-3 h-3" /> PARCIAL</> : <><LockOpen className="w-3 h-3" /> LIVRE</>}
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
          const partial = v.bloqueio_financeiro || v.bloqueio_documentacao;
          return (
            <div key={v.id} className={`glass-card p-4 ${dualBlock ? 'border-danger/20' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-text font-mono">{v.placa || '-'}</span>
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-semibold ${dualBlock ? 'bg-danger/10 text-danger' : partial ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                  {dualBlock ? <><Lock className="w-3 h-3" /> BLOQUEADO</> : partial ? <><Lock className="w-3 h-3" /> PARCIAL</> : <><LockOpen className="w-3 h-3" /> LIVRE</>}
                </span>
              </div>
              <p className="text-sm font-medium text-text">{v.razao_social || v.cod_cliente}</p>
              {v.chassi && <p className="text-xs text-text-muted font-mono">Chassi: {v.chassi}</p>}
              <p className="text-xs text-text-muted">{v.marca_modelo}</p>
              <p className="text-sm font-bold text-text mt-1">{formatCurrency(v.valor_venda_cents)}</p>
              <div className="flex gap-2 mt-3">
                <BloqueioBtn venda={v} tipo="financeiro" />
                <BloqueioBtn venda={v} tipo="documentacao" />
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && <p className="text-center text-text-muted py-10">Nenhuma venda encontrada</p>}
    </div>
  );
}
