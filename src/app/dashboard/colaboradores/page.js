'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/lib/supabase';
import { FUNCOES } from '@/lib/constants';
import {
  UserPlus, Search, Edit3, Trash2, ShieldOff, ShieldCheck,
  X, Loader2, AlertCircle, CheckCircle, UserCog, Crown,
  DollarSign, FileText, Shield
} from 'lucide-react';

const FUNCAO_ICONS = { master: Crown, financeiro: DollarSign, documentacao: FileText, agente: Shield };

export default function ColaboradoresPage() {
  const { user, colaborador } = useAuth();
  const { isMaster } = usePermissions();
  const router = useRouter();

  const [colaboradores, setColaboradores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterFuncao, setFilterFuncao] = useState('');
  const [filterAtivo, setFilterAtivo] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingColab, setEditingColab] = useState(null);
  const [formData, setFormData] = useState({ nome: '', email: '', senha: '', funcao: 'financeiro', ativo: true });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Toast
  const [toast, setToast] = useState(null);

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const abortControllerRef = useRef(null);

  // Visibilitychange — reset loading states quando o usuário volta para a aba
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        abortControllerRef.current?.abort();
        setFormLoading(false);
        setDeleteLoading(false);
        setLoading(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Safety timer — força reset de formLoading se ficar travado por mais de 45s
  useEffect(() => {
    if (formLoading) {
      const safetyTimer = setTimeout(() => {
        abortControllerRef.current?.abort();
        setFormLoading(false);
      }, 45000);
      return () => clearTimeout(safetyTimer);
    }
  }, [formLoading]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchColaboradores = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('colaboradores')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setColaboradores(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isMaster) {
      router.replace('/dashboard');
      return;
    }
    fetchColaboradores();
  }, [isMaster, router, fetchColaboradores]);

  // Filter
  const filtered = colaboradores.filter(c => {
    const matchSearch = !search || 
      c.nome.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const matchFuncao = !filterFuncao || c.funcao === filterFuncao;
    const matchAtivo = filterAtivo === '' || c.ativo === (filterAtivo === 'true');
    return matchSearch && matchFuncao && matchAtivo;
  });

  // Open create modal
  const openCreate = () => {
    setEditingColab(null);
    setFormData({ nome: '', email: '', senha: '', funcao: 'financeiro', ativo: true });
    setFormError('');
    setShowModal(true);
  };

  // Open edit modal
  const openEdit = (colab) => {
    setEditingColab(colab);
    setFormData({ nome: colab.nome, email: colab.email, senha: '', funcao: colab.funcao, ativo: colab.ativo });
    setFormError('');
    setShowModal(true);
  };

  // Create colaborador via edge function (uses admin API)
  const handleCreate = async () => {
    if (!formData.nome.trim()) { setFormError('Nome é obrigatório'); return; }
    if (!formData.email.trim()) { setFormError('Email é obrigatório'); return; }
    if (!formData.senha || formData.senha.length < 6) { setFormError('Senha deve ter pelo menos 6 caracteres'); return; }

    setFormLoading(true);
    setFormError('');

    // AbortController com timeout de 30s
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setFormError('Sessão expirada. Faça login novamente.');
        setFormLoading(false);
        clearTimeout(timeoutId);
        return;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-colaborador`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            nome: formData.nome.trim(),
            email: formData.email.trim(),
            senha: formData.senha,
            funcao: formData.funcao,
            ativo: formData.ativo,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setFormError(result.error || 'Erro ao criar colaborador');
        setFormLoading(false);
        return;
      }

      showToast(`Colaborador ${formData.nome} criado com sucesso!`);
      setShowModal(false);
      await fetchColaboradores();
    } catch (err) {
      if (err.name === 'AbortError') {
        setFormError('Tempo limite excedido. Tente novamente.');
      } else {
        setFormError(err.message || 'Erro inesperado');
      }
    } finally {
      clearTimeout(timeoutId);
      setFormLoading(false);
    }
  };

  // Update colaborador
  const handleUpdate = async () => {
    if (!formData.nome.trim()) { setFormError('Nome é obrigatório'); return; }

    setFormLoading(true);
    setFormError('');

    try {
      const updateData = {
        nome: formData.nome.trim(),
        funcao: formData.funcao,
        ativo: formData.ativo,
      };

      const { error } = await supabase
        .from('colaboradores')
        .update(updateData)
        .eq('id', editingColab.id);

      if (error) {
        setFormError(error.message);
        setFormLoading(false);
        return;
      }

      showToast(`Colaborador ${formData.nome} atualizado!`);
      setShowModal(false);
      await fetchColaboradores();
    } catch (err) {
      setFormError(err.message || 'Erro inesperado');
    } finally {
      setFormLoading(false);
    }
  };

  // Toggle ativo
  const toggleAtivo = async (colab) => {
    const newAtivo = !colab.ativo;
    const { error } = await supabase
      .from('colaboradores')
      .update({ ativo: newAtivo })
      .eq('id', colab.id);

    if (!error) {
      showToast(`${colab.nome} foi ${newAtivo ? 'ativado' : 'bloqueado'}`);
      await fetchColaboradores();
    }
  };

  // Delete colaborador
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);

    try {
      // Delete from colaboradores (cascade will handle auth.users if configured)
      const { error } = await supabase
        .from('colaboradores')
        .delete()
        .eq('id', deleteTarget.id);

      if (error) {
        showToast('Erro ao excluir: ' + error.message, 'error');
      } else {
        showToast(`${deleteTarget.nome} foi excluído`);
        await fetchColaboradores();
      }
    } catch (err) {
      showToast('Erro ao excluir', 'error');
    } finally {
      setDeleteLoading(false);
      setDeleteTarget(null);
    }
  };

  if (!isMaster) return null;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text flex items-center gap-2">
            <UserCog className="w-6 h-6 text-primary" />
            Colaboradores
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Gerencie os usuários e permissões do sistema
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl font-medium text-sm transition-all cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          Novo Colaborador
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Buscar por nome ou email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-text text-sm placeholder-text-muted focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <select
            value={filterFuncao}
            onChange={(e) => setFilterFuncao(e.target.value)}
            className="px-3 py-2.5 bg-surface border border-border rounded-xl text-text text-sm focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="">Todas funções</option>
            {Object.entries(FUNCOES).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
          </select>
          <select
            value={filterAtivo}
            onChange={(e) => setFilterAtivo(e.target.value)}
            className="px-3 py-2.5 bg-surface border border-border rounded-xl text-text text-sm focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="">Todos status</option>
            <option value="true">Ativo</option>
            <option value="false">Bloqueado</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(FUNCOES).map(([key, val]) => {
          const FIcon = FUNCAO_ICONS[key];
          const count = colaboradores.filter(c => c.funcao === key).length;
          return (
            <div key={key} className="glass-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: val.color + '20' }}>
                <FIcon className="w-5 h-5" style={{ color: val.color }} />
              </div>
              <div>
                <p className="text-lg font-bold text-text">{count}</p>
                <p className="text-xs text-text-muted">{val.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <UserCog className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nenhum colaborador encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Nome</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Email</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Função</th>
                  <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(colab => {
                  const funcaoInfo = FUNCOES[colab.funcao] || { label: colab.funcao, color: '#6366f1' };
                  const FIcon = FUNCAO_ICONS[colab.funcao] || Shield;
                  const isSelf = colab.auth_user_id === user?.id;

                  return (
                    <tr key={colab.id} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: funcaoInfo.color }}>
                            {colab.nome.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text truncate">
                              {colab.nome}
                              {isSelf && <span className="text-xs text-primary ml-1">(você)</span>}
                            </p>
                            <p className="text-xs text-text-muted truncate sm:hidden">{colab.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-sm text-text-muted">{colab.email}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium" style={{ backgroundColor: funcaoInfo.color + '15', color: funcaoInfo.color }}>
                          <FIcon className="w-3 h-3" />
                          {funcaoInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {colab.ativo ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-success/10 text-success">
                            <div className="w-1.5 h-1.5 rounded-full bg-success" />
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-danger/10 text-danger">
                            <div className="w-1.5 h-1.5 rounded-full bg-danger" />
                            Bloqueado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(colab)}
                            className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-all cursor-pointer"
                            title="Editar"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleAtivo(colab)}
                            className={`p-2 rounded-lg transition-all cursor-pointer ${
                              colab.ativo 
                                ? 'text-text-muted hover:text-warning hover:bg-warning/10' 
                                : 'text-text-muted hover:text-success hover:bg-success/10'
                            }`}
                            title={colab.ativo ? 'Bloquear' : 'Desbloquear'}
                          >
                            {colab.ativo ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() => setDeleteTarget(colab)}
                              className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-all cursor-pointer"
                              title="Excluir"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setShowModal(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="glass-card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-text">
                  {editingColab ? 'Editar Colaborador' : 'Novo Colaborador'}
                </h2>
                <button onClick={() => setShowModal(false)} className="p-1 text-text-muted hover:text-text cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Nome */}
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Nome</label>
                  <input
                    type="text"
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-text text-sm focus:outline-none focus:border-primary transition-colors"
                    placeholder="Nome completo"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-text text-sm focus:outline-none focus:border-primary transition-colors"
                    placeholder="email@exemplo.com"
                    disabled={!!editingColab}
                  />
                  {editingColab && <p className="text-xs text-text-muted mt-1">Email não pode ser alterado</p>}
                </div>

                {/* Senha (only for create) */}
                {!editingColab && (
                  <div>
                    <label className="block text-sm font-medium text-text-muted mb-1">Senha</label>
                    <input
                      type="password"
                      value={formData.senha}
                      onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                      className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-text text-sm focus:outline-none focus:border-primary transition-colors"
                      placeholder="Mínimo 6 caracteres"
                    />
                  </div>
                )}

                {/* Função */}
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Função</label>
                  <select
                    value={formData.funcao}
                    onChange={(e) => setFormData({ ...formData, funcao: e.target.value })}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-text text-sm focus:outline-none focus:border-primary cursor-pointer"
                  >
                    {Object.entries(FUNCOES).map(([key, val]) => (
                      <option key={key} value={key}>{val.label}</option>
                    ))}
                  </select>
                </div>

                {/* Status */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-text-muted">Status:</label>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, ativo: !formData.ativo })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                      formData.ativo ? 'bg-success' : 'bg-border-2'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.ativo ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                  <span className={`text-sm ${formData.ativo ? 'text-success' : 'text-text-muted'}`}>
                    {formData.ativo ? 'Ativo' : 'Bloqueado'}
                  </span>
                </div>

                {/* Error */}
                {formError && (
                  <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {formError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowModal(false)}
                    className="flex-1 py-2.5 bg-surface border border-border rounded-xl text-text text-sm font-medium hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={editingColab ? handleUpdate : handleCreate}
                    disabled={formLoading}
                    className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {formLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Salvando...
                      </span>
                    ) : editingColab ? 'Salvar Alterações' : 'Criar Colaborador'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setDeleteTarget(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="glass-card w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
              <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-danger" />
              </div>
              <h3 className="text-lg font-bold text-text mb-2">Excluir Colaborador</h3>
              <p className="text-sm text-text-muted mb-6">
                Tem certeza que deseja excluir <strong className="text-text">{deleteTarget.nome}</strong>? Esta ação não pode ser desfeita.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2.5 bg-surface border border-border rounded-xl text-text text-sm font-medium hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteLoading}
                  className="flex-1 py-2.5 bg-danger hover:bg-danger-hover text-white rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {deleteLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </span>
                  ) : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all animate-slide-up ${
          toast.type === 'error' 
            ? 'bg-danger text-white' 
            : 'bg-success text-white'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
