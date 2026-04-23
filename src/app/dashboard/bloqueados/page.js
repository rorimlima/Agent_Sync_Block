'use client';
import { useState } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { exportToCSV } from '@/lib/export';
import { Lock, Search, Unlock, Loader2, X, Download } from 'lucide-react';

export default function BloqueadosPage() {
  const { setor, user } = useAuth();
  const { data: bloqueados, refetch } = useRealtime('veiculos_bloqueados', { orderBy: 'bloqueado_em', orderAsc: false });
  const [search, setSearch] = useState('');
  const [filterPlaca, setFilterPlaca] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [desbloqTipo, setDesbloqTipo] = useState('');
  const [loading, setLoading] = useState(false);

  const filtered = bloqueados.filter(b => {
    const matchSearch = !search || b.placa?.toLowerCase().includes(search.toLowerCase()) || b.cod_cliente?.toLowerCase().includes(search.toLowerCase()) || b.razao_social?.toLowerCase().includes(search.toLowerCase());
    const matchPlaca = !filterPlaca || b.final_placa === filterPlaca;
    return matchSearch && matchPlaca;
  });

  const openDesbloqueio = (item, tipo) => {
    setSelected(item);
    setDesbloqTipo(tipo);
    setMotivo('');
    setShowModal(true);
  };

  const confirmarDesbloqueio = async () => {
    if (!motivo.trim()) return;
    setLoading(true);
    const updates = {};
    if (desbloqTipo === 'financeiro') updates.status_financeiro = 'LIBERADO';
    if (desbloqTipo === 'documentacao') updates.status_documentacao = 'LIBERADO';
    updates.status_final = 'LIBERADO';
    updates.motivo_desbloqueio = motivo;
    updates.desbloqueado_por = user.id;
    updates.desbloqueado_em = new Date().toISOString();

    await supabase.from('veiculos_bloqueados').update(updates).eq('id', selected.id);

    // Atualizar a venda correspondente
    if (selected.venda_id) {
      const vendaUpdate = {};
      if (desbloqTipo === 'financeiro') vendaUpdate.bloqueio_financeiro = false;
      if (desbloqTipo === 'documentacao') vendaUpdate.bloqueio_documentacao = false;
      await supabase.from('vendas').update(vendaUpdate).eq('id', selected.venda_id);
    }

    await supabase.from('audit_logs').insert({
      acao: 'DESBLOQUEIO',
      setor,
      detalhes: `Desbloqueio ${desbloqTipo} — Placa: ${selected.placa} | Motivo: ${motivo}`,
      user_id: user.id,
      user_email: user.email,
    });

    setShowModal(false);
    setLoading(false);
    refetch();
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
            <Lock className="w-6 h-6 text-danger" /> Veículos Bloqueados
          </h1>
          <p className="text-text-muted text-sm mt-1">{filtered.length} veículos</p>
        </div>
        <button onClick={() => exportToCSV(filtered, [
          { key: 'placa', label: 'Placa' },
          { key: 'marca_modelo', label: 'Modelo' },
          { key: 'chassi', label: 'Chassi' },
          { key: 'razao_social', label: 'Razão Social' },
          { key: 'status_financeiro', label: 'Status Financeiro' },
          { key: 'status_documentacao', label: 'Status Documentação' },
          { key: 'status_final', label: 'Status Final' },
        ], 'veiculos_bloqueados')} className="flex items-center gap-2 px-3 py-2 bg-danger/10 text-danger text-xs rounded-xl hover:bg-danger/20 transition-all cursor-pointer">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar placa, cliente..." className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
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
              <th className="text-left py-3 px-4 text-text-muted font-medium">Placa</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Modelo</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Chassi</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Cliente</th>
              <th className="text-center py-3 px-4 text-text-muted font-medium">Financeiro</th>
              <th className="text-center py-3 px-4 text-text-muted font-medium">Documentação</th>
              <th className="text-center py-3 px-4 text-text-muted font-medium">Status Final</th>
              <th className="text-center py-3 px-4 text-text-muted font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id} className="border-b border-border/50 hover:bg-surface-2/30">
                <td className="py-3 px-4 text-text font-mono font-bold">{b.placa}</td>
                <td className="py-3 px-4 text-text-muted text-xs">{b.marca_modelo || '-'}</td>
                <td className="py-3 px-4 text-text-muted font-mono text-xs">{b.chassi || '-'}</td>
                <td className="py-3 px-4 text-text">{b.razao_social || b.cod_cliente}</td>
                <td className="py-3 px-4 text-center">
                  <span className={`text-xs px-2 py-1 rounded-lg ${b.status_financeiro === 'BLOQUEADO' ? 'badge-bloqueado' : 'badge-liberado'}`}>
                    {b.status_financeiro}
                  </span>
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={`text-xs px-2 py-1 rounded-lg ${b.status_documentacao === 'BLOQUEADO' ? 'badge-bloqueado' : 'badge-liberado'}`}>
                    {b.status_documentacao}
                  </span>
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={`text-xs px-2 py-1 rounded-lg font-bold ${b.status_final === 'VEÍCULO BLOQUEADO' ? 'badge-bloqueado' : 'badge-liberado'}`}>
                    {b.status_final}
                  </span>
                </td>
                <td className="py-3 px-4 text-center">
                  <div className="flex gap-1 justify-center">
                    {setor === 'financeiro' && b.status_financeiro === 'BLOQUEADO' && (
                      <button onClick={() => openDesbloqueio(b, 'financeiro')} className="px-2 py-1 bg-success/10 text-success text-xs rounded-lg hover:bg-success/20 cursor-pointer">
                        <Unlock className="w-3 h-3 inline mr-1" />Fin.
                      </button>
                    )}
                    {setor === 'documentacao' && b.status_documentacao === 'BLOQUEADO' && (
                      <button onClick={() => openDesbloqueio(b, 'documentacao')} className="px-2 py-1 bg-success/10 text-success text-xs rounded-lg hover:bg-success/20 cursor-pointer">
                        <Unlock className="w-3 h-3 inline mr-1" />Doc.
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {filtered.map(b => (
          <div key={b.id} className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-text font-mono">{b.placa}</span>
              <span className={`text-xs px-2 py-1 rounded-lg font-bold ${b.status_final === 'VEÍCULO BLOQUEADO' ? 'badge-bloqueado' : 'badge-liberado'}`}>
                {b.status_final === 'VEÍCULO BLOQUEADO' ? '🔒 BLOQUEADO' : '✅ LIBERADO'}
              </span>
            </div>
            <p className="text-xs text-text-muted">{b.marca_modelo || '-'}</p>
            {b.chassi && <p className="text-xs text-text-muted font-mono">Chassi: {b.chassi}</p>}
            <p className="text-xs text-text">{b.razao_social || b.cod_cliente}</p>
            <div className="flex gap-2 mt-2 text-xs">
              <span className={b.status_financeiro === 'BLOQUEADO' ? 'text-danger' : 'text-success'}>Fin: {b.status_financeiro}</span>
              <span className={b.status_documentacao === 'BLOQUEADO' ? 'text-danger' : 'text-success'}>Doc: {b.status_documentacao}</span>
            </div>
            <div className="flex gap-2 mt-3">
              {setor === 'financeiro' && b.status_financeiro === 'BLOQUEADO' && (
                <button onClick={() => openDesbloqueio(b, 'financeiro')} className="flex-1 py-2.5 bg-success/10 text-success border border-success/20 rounded-xl text-xs font-medium cursor-pointer">
                  <Unlock className="w-3 h-3 inline mr-1" /> Desbloquear Fin.
                </button>
              )}
              {setor === 'documentacao' && b.status_documentacao === 'BLOQUEADO' && (
                <button onClick={() => openDesbloqueio(b, 'documentacao')} className="flex-1 py-2.5 bg-success/10 text-success border border-success/20 rounded-xl text-xs font-medium cursor-pointer">
                  <Unlock className="w-3 h-3 inline mr-1" /> Desbloquear Doc.
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-center text-text-muted py-10">Nenhum veículo bloqueado</p>}

      {/* Modal Desbloqueio */}
      {showModal && selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="glass-card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text">Desbloquear Veículo</h3>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-surface-2 rounded-xl p-3 mb-4">
              <p className="text-sm text-text font-bold">{selected.placa} — {selected.marca_modelo}</p>
              <p className="text-xs text-text-muted">Tipo: Desbloqueio {desbloqTipo}</p>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-text-muted mb-2">Motivo do desbloqueio *</label>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} placeholder="Descreva o motivo..." className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary resize-none" />
            </div>
            <button onClick={confirmarDesbloqueio} disabled={!motivo.trim() || loading} className="w-full py-3 bg-success hover:bg-success/80 text-white font-semibold rounded-xl transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</> : <><Unlock className="w-4 h-4" /> Confirmar Desbloqueio</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
