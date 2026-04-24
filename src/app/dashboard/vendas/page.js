'use client';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/utils';
import { exportToCSV } from '@/lib/export';
import { ShoppingCart, Search, Lock, Unlock, LockOpen, Loader2, Download, Filter, X, Shield, FileText, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 50;

export default function VendasPage() {
  const { setor, user, hasRole } = useAuth();
  const { data: vendas, refetch } = useRealtime('vendas', { orderBy: 'created_at', orderAsc: false });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBloqueio, setFilterBloqueio] = useState('');
  const [filterFinalPlaca, setFilterFinalPlaca] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Debounce search to avoid filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1); // Reset to page 1 on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterBloqueio]);

  if (!hasRole(['master', 'financeiro', 'documentacao'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito</div>;
  }

  // Stable filtered data using useMemo to avoid recalc on unrelated renders
  // Extrair último dígito numérico da placa
  const getPlacaFinalDigit = (placa) => {
    if (!placa) return null;
    const nums = placa.replace(/[^0-9]/g, '');
    return nums.length > 0 ? nums[nums.length - 1] : null;
  };

  const filtered = useMemo(() => {
    const s = debouncedSearch.trim().toLowerCase();
    return vendas.filter(v => {
      // Search filter — prioridade: placa e chassi primeiro
      let matchSearch = true;
      if (s) {
        matchSearch =
          (v.placa && v.placa.toLowerCase().includes(s)) ||
          (v.chassi && v.chassi.toLowerCase().includes(s)) ||
          (v.cod_cliente && v.cod_cliente.toLowerCase().includes(s)) ||
          (v.razao_social && v.razao_social.toLowerCase().includes(s)) ||
          (v.marca_modelo && v.marca_modelo.toLowerCase().includes(s));
      }

      // Bloqueio filter
      let matchBloqueio = true;
      if (filterBloqueio === 'bloqueado') matchBloqueio = v.bloqueio_financeiro && v.bloqueio_documentacao;
      else if (filterBloqueio === 'bloq_fin') matchBloqueio = v.bloqueio_financeiro === true;
      else if (filterBloqueio === 'bloq_doc') matchBloqueio = v.bloqueio_documentacao === true;
      else if (filterBloqueio === 'livre') matchBloqueio = !v.bloqueio_financeiro && !v.bloqueio_documentacao;

      // Final de placa filter
      let matchFinalPlaca = true;
      if (filterFinalPlaca !== '') {
        matchFinalPlaca = getPlacaFinalDigit(v.placa) === filterFinalPlaca;
      }

      return matchSearch && matchBloqueio && matchFinalPlaca;
    });
  }, [vendas, debouncedSearch, filterBloqueio, filterFinalPlaca]);

  // Paginated data
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const toggleBloqueio = async (venda, tipo) => {
    setLoadingId(venda.id + tipo);
    const field = tipo === 'financeiro' ? 'bloqueio_financeiro' : 'bloqueio_documentacao';
    const otherField = tipo === 'financeiro' ? 'bloqueio_documentacao' : 'bloqueio_financeiro';
    const newValue = !venda[field];

    try {
      // 1) Atualizar a venda no Supabase IMEDIATAMENTE
      const { error: vendaErr } = await supabase
        .from('vendas')
        .update({ [field]: newValue, updated_at: new Date().toISOString() })
        .eq('id', venda.id);

      if (vendaErr) {
        console.error('Erro ao atualizar venda:', vendaErr);
        alert(`Erro ao salvar bloqueio: ${vendaErr.message}`);
        setLoadingId(null);
        return;
      }

      // 2) Sincronizar veiculos_bloqueados — criar/atualizar registro para QUALQUER bloqueio ativo
      if (venda.placa) {
        if (newValue) {
          // BLOQUEANDO: criar ou atualizar registro em veiculos_bloqueados
          const statusFinanceiro = tipo === 'financeiro' ? 'BLOQUEADO' : (venda[otherField] ? 'BLOQUEADO' : 'LIBERADO');
          const statusDocumentacao = tipo === 'documentacao' ? 'BLOQUEADO' : (venda[otherField] ? 'BLOQUEADO' : 'LIBERADO');
          // PARCIAL = apenas 1 setor bloqueado, VEÍCULO BLOQUEADO = ambos bloqueados
          const bothBlocked = statusFinanceiro === 'BLOQUEADO' && statusDocumentacao === 'BLOQUEADO';
          const statusFinal = bothBlocked ? 'VEÍCULO BLOQUEADO' : 'PARCIAL';

          const { error: bloqErr } = await supabase.from('veiculos_bloqueados').upsert({
            placa: venda.placa,
            final_placa: venda.placa?.slice(-1) || null,
            cod_cliente: venda.cod_cliente,
            chassi: venda.chassi || null,
            marca_modelo: venda.marca_modelo || null,
            razao_social: venda.razao_social || null,
            venda_id: venda.id,
            status_financeiro: statusFinanceiro,
            status_documentacao: statusDocumentacao,
            status_final: statusFinal,
            bloqueado_em: new Date().toISOString(),
          }, { onConflict: 'placa' });

          if (bloqErr) {
            console.error('Erro ao criar bloqueio:', bloqErr);
            alert(`Erro ao registrar veículo bloqueado: ${bloqErr.message}`);
          }
        } else {
          // DESBLOQUEANDO: atualizar status do setor correspondente
          const statusField = tipo === 'financeiro' ? 'status_financeiro' : 'status_documentacao';
          const otherStillBlocked = venda[otherField] === true;

          if (otherStillBlocked) {
            // Outro setor ainda bloqueado — rebaixa para PARCIAL
            const { error: updErr } = await supabase.from('veiculos_bloqueados')
              .update({ [statusField]: 'LIBERADO', status_final: 'PARCIAL' })
              .eq('placa', venda.placa);
            if (updErr) console.error('Erro ao atualizar status bloqueio:', updErr);
          } else {
            // Nenhum setor bloqueado — liberar completamente
            const { error: updErr } = await supabase.from('veiculos_bloqueados')
              .update({
                [statusField]: 'LIBERADO',
                status_final: 'LIBERADO',
                motivo_desbloqueio: `Desbloqueio ${tipo} via vendas`,
                desbloqueado_por: user.id,
                desbloqueado_em: new Date().toISOString(),
              })
              .eq('placa', venda.placa);
            if (updErr) console.error('Erro ao liberar veículo:', updErr);
          }
        }
      }

      // 3) Registrar log de auditoria
      await supabase.from('audit_logs').insert({
        acao: newValue ? 'BLOQUEIO' : 'DESBLOQUEIO',
        setor,
        detalhes: `${newValue ? 'Bloqueio' : 'Desbloqueio'} ${tipo} — Placa: ${venda.placa} | ${venda.razao_social || venda.cod_cliente}`,
        user_id: user.id,
        user_email: user.email,
      });

      // 4) Invalidar cache para forçar dados frescos
      try {
        localStorage.removeItem('cache_ts_vendas');
        localStorage.removeItem('cache_ts_veiculos_bloqueados');
      } catch {}

      // 5) Refetch dados frescos do servidor
      await refetch();
    } catch (err) {
      console.error('Erro inesperado ao processar bloqueio:', err);
      alert('Erro inesperado ao processar bloqueio. Verifique sua conexão.');
    } finally {
      setLoadingId(null);
    }
  };

  const activeFilters = [filterBloqueio, filterFinalPlaca].filter(Boolean).length;

  const BloqueioBtn = ({ venda, tipo }) => {
    const field = tipo === 'financeiro' ? 'bloqueio_financeiro' : 'bloqueio_documentacao';
    const isBlocked = venda[field];
    const canToggle = setor === 'master' || (tipo === 'financeiro' && setor === 'financeiro') || (tipo === 'documentacao' && setor === 'documentacao');
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
          <p className="text-text-muted text-sm mt-1">
            {debouncedSearch || filterBloqueio
              ? <><span className="text-primary font-semibold">{filtered.length}</span> de {vendas.length} registros</>
              : <>{vendas.length} registros</>
            }
          </p>
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
            placeholder="Buscar por placa, chassi, código, razão social, modelo..."
            className="w-full pl-10 pr-10 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary transition-colors" />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text cursor-pointer transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
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
          <select value={filterFinalPlaca} onChange={e => setFilterFinalPlaca(e.target.value)}
            className="px-3 py-2 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-primary">
            <option value="">Final de placa</option>
            {[0,1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={String(n)}>Final {n}</option>)}
          </select>
          {activeFilters > 0 && (
            <button onClick={() => { setFilterBloqueio(''); setFilterFinalPlaca(''); }}
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
              <th className="text-left py-3 px-3 text-text-muted font-medium">Data Venda</th>
              <th className="text-right py-3 px-3 text-text-muted font-medium">Valor</th>
              <th className="text-center py-3 px-3 text-text-muted font-medium">Financeiro</th>
              <th className="text-center py-3 px-3 text-text-muted font-medium">Documentação</th>
              <th className="text-center py-3 px-3 text-text-muted font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {paginatedData.map(v => {
              const dualBlock = v.bloqueio_financeiro && v.bloqueio_documentacao;
              return (
                <tr key={v.id} className={`border-b border-border/50 transition-colors ${dualBlock ? 'bg-danger/3 hover:bg-danger/6' : 'hover:bg-surface-2/30'}`}>
                  <td className="py-3 px-3 text-text font-mono font-bold text-xs">{v.cod_cliente}</td>
                  <td className="py-3 px-3 text-text font-medium text-xs">{v.razao_social || '-'}</td>
                  <td className="py-3 px-3 text-text font-mono font-bold">{v.placa || '-'}</td>
                  <td className="py-3 px-3 text-text-muted font-mono text-xs">{v.chassi || '-'}</td>
                  <td className="py-3 px-3 text-text-muted text-xs">{v.data_venda ? formatDate(v.data_venda) : '-'}</td>
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
        {paginatedData.map(v => {
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
              {v.data_venda && <p className="text-xs text-text-muted">Data: {formatDate(v.data_venda)}</p>}
              <p className="text-sm font-bold text-text mt-1">{formatCurrency(v.valor_venda_cents)}</p>
              <div className="flex gap-2 mt-3">
                <BloqueioBtn venda={v} tipo="financeiro" />
                <BloqueioBtn venda={v} tipo="documentacao" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filtered.length === 0 && (
        <div className="text-center py-10">
          <Search className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-40" />
          <p className="text-text-muted text-sm">
            {debouncedSearch
              ? <>Nenhuma venda encontrada para <strong className="text-text">&quot;{debouncedSearch}&quot;</strong></>
              : 'Nenhuma venda encontrada'
            }
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-text-muted">
            Mostrando {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
              className="p-2 rounded-lg border border-border text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {/* Page numbers */}
            {(() => {
              const pages = [];
              const maxVisible = 5;
              let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
              let end = Math.min(totalPages, start + maxVisible - 1);
              if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

              if (start > 1) {
                pages.push(
                  <button key={1} onClick={() => setCurrentPage(1)}
                    className="w-8 h-8 rounded-lg text-xs font-medium text-text-muted hover:bg-surface-2 cursor-pointer transition-all">1</button>
                );
                if (start > 2) pages.push(<span key="start-ellipsis" className="text-text-muted text-xs px-1">…</span>);
              }

              for (let i = start; i <= end; i++) {
                pages.push(
                  <button key={i} onClick={() => setCurrentPage(i)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                      i === safePage
                        ? 'bg-primary text-white'
                        : 'text-text-muted hover:bg-surface-2'
                    }`}>{i}</button>
                );
              }

              if (end < totalPages) {
                if (end < totalPages - 1) pages.push(<span key="end-ellipsis" className="text-text-muted text-xs px-1">…</span>);
                pages.push(
                  <button key={totalPages} onClick={() => setCurrentPage(totalPages)}
                    className="w-8 h-8 rounded-lg text-xs font-medium text-text-muted hover:bg-surface-2 cursor-pointer transition-all">{totalPages}</button>
                );
              }

              return pages;
            })()}
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage >= totalPages}
              className="p-2 rounded-lg border border-border text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
