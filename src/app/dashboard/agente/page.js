'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useSyncTable, useMutate } from '@/hooks/useSyncEngine';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import { Shield, Camera, Send, Loader2, MapPin, Clock } from 'lucide-react';

// ─── fetchWithRetry: retry exponencial para fetch nativo ─────────────────────
const fetchWithRetry = async (url, options, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (err) {
      if (err.name === 'AbortError') throw err; // Não retenta se foi abortado
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      console.warn(`[Agent] Tentativa ${attempt} falhou, retentando em ${delay}ms`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
};

export default function AgentePage() {
  const { setor, user, hasRole } = useAuth();
  const { mutate } = useMutate();
  const { data: bloqueados, loading: bloqueadosLoading } = useSyncTable('veiculos_bloqueados', {
    filter: (b) => b.status_final === 'VEÍCULO BLOQUEADO',
  });
  const { data: ocorrencias } = useSyncTable('ocorrencias_agente', {
    orderBy: 'created_at',
    orderAsc: false,
  });

  const [selectedVeiculo, setSelectedVeiculo] = useState(null);
  const [observacao, setObservacao] = useState('');
  const [fotos, setFotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fileRef = useRef(null);
  const abortControllerRef = useRef(null);

  // ── AbortController robusto ───────────────────────────────────────────────
  const createFreshController = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    return abortControllerRef.current;
  }, []);

  // ── visibilitychange + focus — reset se travado ───────────────────────────
  useEffect(() => {
    const resetState = () => {
      if (document.visibilityState === 'visible') {
        abortControllerRef.current?.abort();
        setSending(false);
        setUploading(false);
        setErrorMsg('');
      }
    };
    // visibilitychange cobre troca de aba
    document.addEventListener('visibilitychange', resetState);
    // focus cobre Alt+Tab e volta de outra janela (especialmente Windows)
    window.addEventListener('focus', resetState);
    return () => {
      document.removeEventListener('visibilitychange', resetState);
      window.removeEventListener('focus', resetState);
    };
  }, []);

  // ── Safety timer escalonado (20s avisa, 45s força reset) ─────────────────
  useEffect(() => {
    if (!sending) return;
    const warnTimer = setTimeout(() => {
      console.warn('[Agent] Loading longo detectado (20s)');
    }, 20000);
    const killTimer = setTimeout(() => {
      console.error('[Agent] Safety timer atingido — forçando reset');
      abortControllerRef.current?.abort();
      setSending(false);
      setErrorMsg('A conexão expirou. Por favor, tente novamente.');
    }, 45000);
    return () => {
      clearTimeout(warnTimer);
      clearTimeout(killTimer);
    };
  }, [sending]);

  // ── Cleanup ao desmontar ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  if (!hasRole(['master', 'agente'])) {
    return <div className="text-center py-20 text-text-muted">Acesso restrito ao Agente</div>;
  }

  const handleFotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setErrorMsg('');
    const urls = [];
    for (const file of files) {
      const ext = file.name.split('.').pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('ocorrencias').upload(path, file);
      if (!error) {
        const { data } = supabase.storage.from('ocorrencias').getPublicUrl(path);
        urls.push(data.publicUrl);
      } else {
        console.error('[Agent] Erro ao enviar foto:', error.message);
      }
    }
    setFotos(prev => [...prev, ...urls]);
    setUploading(false);
    e.target.value = '';
  };

  const enviarOcorrencia = async () => {
    if (!selectedVeiculo || !observacao.trim()) return;
    setSending(true);
    setErrorMsg('');

    const controller = createFreshController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // Mutação Optimistic — UI atualiza INSTANTANEAMENTE
      await mutate('ocorrencias_agente', 'INSERT', {
        bloqueio_id: selectedVeiculo.id,
        placa: selectedVeiculo.placa,
        observacao: observacao.trim(),
        fotos,
        agente_id: user.id,
      });

      // Audit log via mutation queue (non-blocking)
      await mutate('audit_logs', 'INSERT', {
        acao: 'OCORRENCIA',
        setor: 'agente',
        detalhes: `Ocorrência registrada — Placa: ${selectedVeiculo.placa} | ${fotos.length} foto(s)`,
        user_id: user.id,
        user_email: user.email,
      });

      setObservacao('');
      setFotos([]);
      setSelectedVeiculo(null);
      // SEM refetch — UI já atualizou via Optimistic UI!
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('[Agent] Envio abortado por timeout ou inatividade');
        setErrorMsg('Tempo limite excedido. Tente novamente.');
      } else {
        console.error('[Agent] Erro ao enviar ocorrência:', err);
        setErrorMsg(err.message || 'Erro ao enviar. Tente novamente.');
      }
    } finally {
      clearTimeout(timeoutId);
      setSending(false);
    }
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
        <h2 className="text-sm font-semibold text-text-muted mb-2">
          Veículos Bloqueados ({bloqueadosLoading ? '...' : bloqueados.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {bloqueados.map(b => (
            <button
              key={b.id}
              onClick={() => { setSelectedVeiculo(b); setErrorMsg(''); }}
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
          {!bloqueadosLoading && bloqueados.length === 0 && (
            <p className="text-sm text-text-muted col-span-2 text-center py-6">Nenhum veículo bloqueado</p>
          )}
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
            className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary resize-none mb-3"
          />

          {/* Mensagem de erro */}
          {errorMsg && (
            <p className="text-xs text-danger mb-3 bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">{errorMsg}</p>
          )}

          <button
            onClick={enviarOcorrencia}
            disabled={!observacao.trim() || sending || uploading}
            className="w-full py-3 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
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
          {ocorrencias.filter(o => o.agente_id === user?.id).map(o => (
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
          {ocorrencias.filter(o => o.agente_id === user?.id).length === 0 && (
            <p className="text-sm text-text-muted text-center py-4">Nenhuma ocorrência registrada</p>
          )}
        </div>
      </div>
    </div>
  );
}
