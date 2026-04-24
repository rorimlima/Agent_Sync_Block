'use client';
import { useState } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { exportToCSV } from '@/lib/export';
import { exportBloqueadosPDF } from '@/lib/exportBloqueadosPDF';
import { Lock, Search, Unlock, Loader2, X, Download, Shield, FileText, ShieldAlert, LockOpen, FileDown } from 'lucide-react';

export default function BloqueadosPage() {
  const { setor, user } = useAuth();
  const isAgente = setor === 'agente';

  // Agente: só vê veículos com status_final = VEÍCULO BLOQUEADO (ambos setores)
  const realtimeOpts = isAgente
    ? { orderBy: 'bloqueado_em', orderAsc: false, filter: { status_final: 'VEÍCULO BLOQUEADO' } }
    : { orderBy: 'bloqueado_em', orderAsc: false };

  const { data: bloqueados, refetch } = useRealtime('veiculos_bloqueados', realtimeOpts);
  const [search, setSearch] = useState('');
  const [filterPlaca, setFilterPlaca] = useState('');
  const [activeTab, setActiveTab] = useState('bloqueado'); // 'bloqueado' | 'parcial'
  const [showModal, setShowModal] = useState(false);
  const [modalAction, setModalAction] = useState(''); // 'desbloqueio' | 'bloqueio'
  const [selected, setSelected] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [actionTipo, setActionTipo] = useState('');
  const [loading, setLoading] = useState(false);

  // Separate data by status
  const totalBloqueados = bloqueados.filter(b => b.status_final === 'VEÍCULO BLOQUEADO');
  const totalParciais = bloqueados.filter(b => b.status_final === 'PARCIAL');

  const currentData = isAgente ? bloqueados : (activeTab === 'bloqueado' ? totalBloqueados : totalParciais);

  // Extrair último dígito numérico da placa (ignora letras)
  const getLastDigit = (placa) => {
    if (!placa) return null;
    const nums = placa.replace(/[^0-9]/g, '');
    return nums.length > 0 ? nums[nums.length - 1] : null;
  };

  const filtered = currentData.filter(b => {
    const s = search.toLowerCase();
    const matchSearch = !search ||
      b.placa?.toLowerCase().includes(s) ||
      b.chassi?.toLowerCase().includes(s) ||
      b.marca_modelo?.toLowerCase().includes(s) ||
      (!isAgente && (b.cod_cliente?.toLowerCase().includes(s) || b.razao_social?.toLowerCase().includes(s)));
    const matchPlaca = !filterPlaca || getLastDigit(b.placa) === filterPlaca;
    return matchSearch && matchPlaca;
  });

  const openAction = (item, tipo, action) => {
    setSelected(item);
    setActionTipo(tipo);
    setModalAction(action);
    setMotivo('');
    setShowModal(true);
  };

  const confirmarAcao = async () => {
    if (!motivo.trim()) return;
    setLoading(true);

    try {
      if (modalAction === 'desbloqueio') {
        // DESBLOQUEANDO um setor
        const updates = {};
        if (actionTipo === 'financeiro') updates.status_financeiro = 'LIBERADO';
        if (actionTipo === 'documentacao') updates.status_documentacao = 'LIBERADO';

        const otherField = actionTipo === 'financeiro' ? 'status_documentacao' : 'status_financeiro';
        const otherStillBlocked = selected[otherField] === 'BLOQUEADO';
        updates.status_final = otherStillBlocked ? 'PARCIAL' : 'LIBERADO';
        updates.motivo_desbloqueio = motivo;
        updates.desbloqueado_por = user.id;
        updates.desbloqueado_em = new Date().toISOString();

        const { error: bloqErr } = await supabase
          .from('veiculos_bloqueados').update(updates).eq('id', selected.id);
        if (bloqErr) { alert(`Erro: ${bloqErr.message}`); setLoading(false); return; }

        // Atualizar venda
        if (selected.venda_id) {
          const vendaUpdate = { updated_at: new Date().toISOString() };
          if (actionTipo === 'financeiro') vendaUpdate.bloqueio_financeiro = false;
          if (actionTipo === 'documentacao') vendaUpdate.bloqueio_documentacao = false;
          await supabase.from('vendas').update(vendaUpdate).eq('id', selected.venda_id);
        }

        await supabase.from('audit_logs').insert({
          acao: 'DESBLOQUEIO', setor,
          detalhes: `Desbloqueio ${actionTipo} — Placa: ${selected.placa} | Motivo: ${motivo}`,
          user_id: user.id, user_email: user.email,
        });

      } else if (modalAction === 'bloqueio') {
        // BLOQUEANDO o setor que faltava (PARCIAL → BLOQUEADO)
        const updates = {};
        if (actionTipo === 'financeiro') updates.status_financeiro = 'BLOQUEADO';
        if (actionTipo === 'documentacao') updates.status_documentacao = 'BLOQUEADO';
        updates.status_final = 'VEÍCULO BLOQUEADO';

        const { error: bloqErr } = await supabase
          .from('veiculos_bloqueados').update(updates).eq('id', selected.id);
        if (bloqErr) { alert(`Erro: ${bloqErr.message}`); setLoading(false); return; }

        // Atualizar venda
        if (selected.venda_id) {
          const vendaUpdate = { updated_at: new Date().toISOString() };
          if (actionTipo === 'financeiro') vendaUpdate.bloqueio_financeiro = true;
          if (actionTipo === 'documentacao') vendaUpdate.bloqueio_documentacao = true;
          await supabase.from('vendas').update(vendaUpdate).eq('id', selected.venda_id);
        }

        await supabase.from('audit_logs').insert({
          acao: 'BLOQUEIO', setor,
          detalhes: `Bloqueio ${actionTipo} — Placa: ${selected.placa} | Motivo: ${motivo}`,
          user_id: user.id, user_email: user.email,
        });
      }

      // Invalidar cache
      try {
        localStorage.removeItem('cache_ts_vendas');
        localStorage.removeItem('cache_ts_veiculos_bloqueados');
      } catch {}

      setShowModal(false);
      await refetch();
    } catch (err) {
      console.error('Erro:', err);
      alert('Erro inesperado. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  // Action buttons for each row
  const ActionBtns = ({ b }) => {
    const canFin = setor === 'master' || setor === 'financeiro';
    const canDoc = setor === 'master' || setor === 'documentacao';
    return (
      <div className="flex gap-1 justify-center flex-wrap">
        {/* Desbloquear botões */}
        {canFin && b.status_financeiro === 'BLOQUEADO' && (
          <button onClick={() => openAction(b, 'financeiro', 'desbloqueio')}
            className="px-2 py-1.5 bg-success/10 text-success text-xs rounded-lg hover:bg-success/20 cursor-pointer transition-all border border-success/20">
            <Unlock className="w-3 h-3 inline mr-1" />Liberar Fin.
          </button>
        )}
        {canDoc && b.status_documentacao === 'BLOQUEADO' && (
          <button onClick={() => openAction(b, 'documentacao', 'desbloqueio')}
            className="px-2 py-1.5 bg-success/10 text-success text-xs rounded-lg hover:bg-success/20 cursor-pointer transition-all border border-success/20">
            <Unlock className="w-3 h-3 inline mr-1" />Liberar Doc.
          </button>
        )}
        {/* Bloquear botões — aparecem apenas para o setor que falta bloquear */}
        {canFin && b.status_financeiro !== 'BLOQUEADO' && b.status_final !== 'LIBERADO' && (
          <button onClick={() => openAction(b, 'financeiro', 'bloqueio')}
            className="px-2 py-1.5 bg-danger/10 text-danger text-xs rounded-lg hover:bg-danger/20 cursor-pointer transition-all border border-danger/20">
            <Lock className="w-3 h-3 inline mr-1" />Bloquear Fin.
          </button>
        )}
        {canDoc && b.status_documentacao !== 'BLOQUEADO' && b.status_final !== 'LIBERADO' && (
          <button onClick={() => openAction(b, 'documentacao', 'bloqueio')}
            className="px-2 py-1.5 bg-danger/10 text-danger text-xs rounded-lg hover:bg-danger/20 cursor-pointer transition-all border border-danger/20">
            <Lock className="w-3 h-3 inline mr-1" />Bloquear Doc.
          </button>
        )}
      </div>
    );
  };

  const StatusBadge = ({ status }) => {
    if (status === 'VEÍCULO BLOQUEADO') return <span className="text-xs px-2 py-1 rounded-lg font-bold bg-danger/15 text-danger border border-danger/25">🔒 BLOQUEADO</span>;
    if (status === 'PARCIAL') return <span className="text-xs px-2 py-1 rounded-lg font-bold bg-warning/15 text-warning border border-warning/25">⚠️ PARCIAL</span>;
    return <span className="text-xs px-2 py-1 rounded-lg font-bold bg-success/15 text-success border border-success/25">✅ LIBERADO</span>;
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
        {!isAgente && (
          <div className="flex gap-2">
            <button onClick={async () => {
                try {
                  await exportBloqueadosPDF(totalBloqueados, totalParciais);
                } catch (err) {
                  console.error('Erro ao gerar PDF:', err);
                  alert('Erro ao gerar PDF: ' + err.message);
                }
              }}
              className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary text-xs rounded-xl hover:bg-primary/20 transition-all cursor-pointer">
              <FileDown className="w-4 h-4" /> Exportar PDF
            </button>
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
        )}
      </div>

      {/* Tabs — only for non-agents */}
      {!isAgente && (
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('bloqueado')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-all border ${
              activeTab === 'bloqueado'
                ? 'bg-danger/10 text-danger border-danger/30 shadow-[0_0_12px_rgba(239,68,68,0.1)]'
                : 'bg-surface text-text-muted border-border hover:border-danger/30'
            }`}>
            <Lock className="w-4 h-4" />
            Bloqueados
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'bloqueado' ? 'bg-danger/20 text-danger' : 'bg-surface-2 text-text-muted'}`}>
              {totalBloqueados.length}
            </span>
          </button>
          <button onClick={() => setActiveTab('parcial')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-all border ${
              activeTab === 'parcial'
                ? 'bg-warning/10 text-warning border-warning/30 shadow-[0_0_12px_rgba(245,158,11,0.1)]'
                : 'bg-surface text-text-muted border-border hover:border-warning/30'
            }`}>
            <ShieldAlert className="w-4 h-4" />
            Parciais
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'parcial' ? 'bg-warning/20 text-warning' : 'bg-surface-2 text-text-muted'}`}>
              {totalParciais.length}
            </span>
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={isAgente ? 'Buscar placa, chassi, modelo...' : 'Buscar placa, cliente...'}
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary" />
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
              {!isAgente && <th className="text-left py-3 px-4 text-text-muted font-medium">Cliente</th>}
              {!isAgente && <th className="text-center py-3 px-4 text-text-muted font-medium">Financeiro</th>}
              {!isAgente && <th className="text-center py-3 px-4 text-text-muted font-medium">Documentação</th>}
              {!isAgente && <th className="text-center py-3 px-4 text-text-muted font-medium">Status</th>}
              {!isAgente && <th className="text-center py-3 px-4 text-text-muted font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id} className={`border-b border-border/50 transition-colors ${
                b.status_final === 'VEÍCULO BLOQUEADO' ? 'bg-danger/3 hover:bg-danger/6' :
                b.status_final === 'PARCIAL' ? 'bg-warning/3 hover:bg-warning/6' : 'hover:bg-surface-2/30'
              }`}>
                <td className="py-3 px-4 text-text font-mono font-bold">{b.placa}</td>
                <td className="py-3 px-4 text-text-muted text-xs">{b.marca_modelo || '-'}</td>
                <td className="py-3 px-4 text-text-muted font-mono text-xs">{b.chassi || '-'}</td>
                {!isAgente && <td className="py-3 px-4 text-text">{b.razao_social || b.cod_cliente}</td>}
                {!isAgente && (
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs px-2 py-1 rounded-lg ${b.status_financeiro === 'BLOQUEADO' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                      {b.status_financeiro}
                    </span>
                  </td>
                )}
                {!isAgente && (
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs px-2 py-1 rounded-lg ${b.status_documentacao === 'BLOQUEADO' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                      {b.status_documentacao}
                    </span>
                  </td>
                )}
                {!isAgente && (
                  <td className="py-3 px-4 text-center"><StatusBadge status={b.status_final} /></td>
                )}
                {!isAgente && (
                  <td className="py-3 px-4 text-center"><ActionBtns b={b} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {filtered.map(b => (
          <div key={b.id} className={`glass-card p-4 ${
            b.status_final === 'VEÍCULO BLOQUEADO' ? 'border-danger/20' :
            b.status_final === 'PARCIAL' ? 'border-warning/20' : ''
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-text font-mono">{b.placa}</span>
              {isAgente ? (
                <span className="bg-danger/15 text-danger text-xs px-2 py-1 rounded-lg font-bold border border-danger/25">🔒 BLOQUEADO</span>
              ) : (
                <StatusBadge status={b.status_final} />
              )}
            </div>
            <p className="text-xs text-text-muted">{b.marca_modelo || '-'}</p>
            {b.chassi && <p className="text-xs text-text-muted font-mono">Chassi: {b.chassi}</p>}
            {!isAgente && <p className="text-xs text-text mt-1">{b.razao_social || b.cod_cliente}</p>}
            {!isAgente && (
              <>
                <div className="flex gap-2 mt-2 text-xs">
                  <span className={b.status_financeiro === 'BLOQUEADO' ? 'text-danger' : 'text-success'}>
                    <Shield className="w-3 h-3 inline mr-0.5" />Fin: {b.status_financeiro}
                  </span>
                  <span className={b.status_documentacao === 'BLOQUEADO' ? 'text-danger' : 'text-success'}>
                    <FileText className="w-3 h-3 inline mr-0.5" />Doc: {b.status_documentacao}
                  </span>
                </div>
                <div className="mt-3"><ActionBtns b={b} /></div>
              </>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-10">
          {isAgente ? (
            <><Lock className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-40" /><p className="text-text-muted text-sm">Nenhum veículo bloqueado</p></>
          ) : activeTab === 'bloqueado' ? (
            <><Lock className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-40" /><p className="text-text-muted text-sm">Nenhum veículo com bloqueio total (ambos setores)</p></>
          ) : (
            <><ShieldAlert className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-40" /><p className="text-text-muted text-sm">Nenhum veículo com bloqueio parcial</p></>
          )}
        </div>
      )}

      {/* Modal Bloqueio/Desbloqueio */}
      {!isAgente && showModal && selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="glass-card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text">
                {modalAction === 'bloqueio' ? '🔒 Bloquear Veículo' : '🔓 Desbloquear Veículo'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className={`rounded-xl p-3 mb-4 ${modalAction === 'bloqueio' ? 'bg-danger/5 border border-danger/15' : 'bg-success/5 border border-success/15'}`}>
              <p className="text-sm text-text font-bold">{selected.placa} — {selected.marca_modelo}</p>
              <p className="text-xs text-text-muted mt-1">
                {modalAction === 'bloqueio' ? `Bloquear ${actionTipo}` : `Desbloquear ${actionTipo}`}
              </p>
              <div className="flex gap-2 mt-2 text-xs">
                <span className={selected.status_financeiro === 'BLOQUEADO' ? 'text-danger' : 'text-success'}>Fin: {selected.status_financeiro}</span>
                <span className={selected.status_documentacao === 'BLOQUEADO' ? 'text-danger' : 'text-success'}>Doc: {selected.status_documentacao}</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-text-muted mb-2">Motivo *</label>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} placeholder="Descreva o motivo..."
                className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary resize-none" />
            </div>
            <button onClick={confirmarAcao} disabled={!motivo.trim() || loading}
              className={`w-full py-3 font-semibold rounded-xl transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 ${
                modalAction === 'bloqueio'
                  ? 'bg-danger hover:bg-danger/80 text-white'
                  : 'bg-success hover:bg-success/80 text-white'
              }`}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</> :
                modalAction === 'bloqueio' ? <><Lock className="w-4 h-4" /> Confirmar Bloqueio</> :
                <><Unlock className="w-4 h-4" /> Confirmar Desbloqueio</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
