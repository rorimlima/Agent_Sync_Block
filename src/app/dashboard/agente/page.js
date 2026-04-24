'use client';
import { useState, useRef } from 'react';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import { Shield, Camera, Send, Loader2, Image, MapPin, Clock } from 'lucide-react';

export default function AgentePage() {
  const { setor, user, hasRole } = useAuth();
  const { data: bloqueados } = useRealtime('veiculos_bloqueados', { filter: { status_final: 'VEÍCULO BLOQUEADO' } });
  const { data: ocorrencias, refetch } = useRealtime('ocorrencias_agente', { orderBy: 'created_at', orderAsc: false });
  const [selectedVeiculo, setSelectedVeiculo] = useState(null);
  const [observacao, setObservacao] = useState('');
  const [fotos, setFotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

  if (!hasRole(['master', 'agente'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito ao Agente</div>;
  }

  const handleFotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const urls = [];
    for (const file of files) {
      const ext = file.name.split('.').pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('ocorrencias').upload(path, file);
      if (!error) {
        const { data } = supabase.storage.from('ocorrencias').getPublicUrl(path);
        urls.push(data.publicUrl);
      }
    }
    setFotos(prev => [...prev, ...urls]);
    setUploading(false);
    e.target.value = '';
  };

  const enviarOcorrencia = async () => {
    if (!selectedVeiculo || !observacao.trim()) return;
    setSending(true);
    await supabase.from('ocorrencias_agente').insert({
      bloqueio_id: selectedVeiculo.id,
      placa: selectedVeiculo.placa,
      observacao: observacao.trim(),
      fotos,
      agente_id: user.id,
    });
    await supabase.from('audit_logs').insert({
      acao: 'OCORRENCIA',
      setor: 'agente',
      detalhes: `Ocorrência registrada — Placa: ${selectedVeiculo.placa} | ${fotos.length} foto(s)`,
      user_id: user.id,
      user_email: user.email,
    });
    setObservacao('');
    setFotos([]);
    setSelectedVeiculo(null);
    setSending(false);
    refetch();
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-text flex items-center gap-2">
          <Shield className="w-6 h-6 text-success" /> Painel do Agente
        </h1>
        <p className="text-text-muted text-sm mt-1">Atuação em campo</p>
      </div>

      {/* Veículos para atuar */}
      <div>
        <h2 className="text-sm font-semibold text-text-muted mb-2">Veículos Bloqueados ({bloqueados.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {bloqueados.map(b => (
            <button
              key={b.id}
              onClick={() => setSelectedVeiculo(b)}
              className={`glass-card p-4 text-left cursor-pointer transition-all ${selectedVeiculo?.id === b.id ? 'border-primary ring-1 ring-primary' : 'hover:border-border-2'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-lg font-bold text-text font-mono">{b.placa}</span>
                <span className="badge-bloqueado text-xs px-2 py-1 rounded-lg">🔒</span>
              </div>
              {b.chassi && <p className="text-xs text-text-muted font-mono">Chassi: {b.chassi}</p>}
              <p className="text-xs text-text-muted">{b.marca_modelo || '-'}</p>
            </button>
          ))}
          {bloqueados.length === 0 && <p className="text-sm text-text-muted col-span-2 text-center py-6">Nenhum veículo bloqueado</p>}
        </div>
      </div>

      {/* Formulário de Ocorrência */}
      {selectedVeiculo && (
        <div className="glass-card p-4 md:p-5 border-primary/30">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Registrar Ocorrência — {selectedVeiculo.placa}
          </h2>

          <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handleFotoUpload} />

          {/* Fotos */}
          <div className="mb-4">
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full py-4 border-2 border-dashed border-border rounded-xl text-text-muted hover:border-primary hover:text-primary transition-all cursor-pointer flex items-center justify-center gap-2">
              {uploading ? <><Loader2 className="w-5 h-5 animate-spin" /> Enviando...</> : <><Camera className="w-5 h-5" /> Tirar Foto / Selecionar</>}
            </button>
            {fotos.length > 0 && (
              <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                {fotos.map((url, i) => (
                  <img key={i} src={url} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0 border border-border" />
                ))}
              </div>
            )}
          </div>

          {/* Observação */}
          <textarea
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            rows={3}
            placeholder="Descreva a ocorrência..."
            className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary resize-none mb-4"
          />

          <button onClick={enviarOcorrencia} disabled={!observacao.trim() || sending} className="w-full py-3 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : <><Send className="w-4 h-4" /> Registrar Ocorrência</>}
          </button>
        </div>
      )}

      {/* Histórico de Ocorrências */}
      <div className="glass-card p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-text">Minhas Ocorrências</h2>
        </div>
        <div className="space-y-3">
          {ocorrencias.filter(o => o.agente_id === user.id).map(o => (
            <div key={o.id} className="p-3 bg-surface-2 rounded-xl border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-text font-mono">{o.placa}</span>
                <span className="text-xs text-text-muted">{formatDateTime(o.created_at)}</span>
              </div>
              <p className="text-sm text-text-muted">{o.observacao}</p>
              {o.fotos && o.fotos.length > 0 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  {o.fotos.map((url, i) => (
                    <img key={i} src={url} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0 border border-border" />
                  ))}
                </div>
              )}
            </div>
          ))}
          {ocorrencias.filter(o => o.agente_id === user.id).length === 0 && (
            <p className="text-sm text-text-muted text-center py-4">Nenhuma ocorrência registrada</p>
          )}
        </div>
      </div>
    </div>
  );
}
