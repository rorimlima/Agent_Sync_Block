'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { SETORES } from '@/lib/constants';
import { DollarSign, FileText, Shield, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

const ICONS = { DollarSign, FileText, Shield };

export default function LoginPage() {
  const [setor, setSetor] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!setor) { setError('Selecione um setor'); return; }
    if (!password) { setError('Digite a senha'); return; }

    setLoading(true);
    setError('');
    try {
      await login(setor, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err.message || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      {/* Background gradient */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="glass-card w-full max-w-md p-8 relative z-10">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-4">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-text">Agent Sync Block</h1>
          <p className="text-text-muted text-sm mt-1">Gestão de Inadimplência e Bloqueio</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          {/* Setor Select */}
          <div>
            <label className="block text-sm font-medium text-text-muted mb-2">Setor</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SETORES).map(([key, val]) => {
                const Icon = ICONS[val.icon];
                const isActive = setor === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setSetor(key); setError(''); }}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      isActive 
                        ? 'border-primary bg-primary/10 text-primary shadow-lg shadow-primary/10' 
                        : 'border-border bg-surface hover:border-border-2 text-text-muted hover:text-text'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{val.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Senha */}
          <div>
            <label className="block text-sm font-medium text-text-muted mb-2">Senha</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Digite a senha do setor"
                className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-text placeholder-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Entrando...
              </span>
            ) : 'Entrar'}
          </button>
        </form>

        <p className="text-center text-text-muted text-xs mt-6">
          v1.0 — Sincronização em tempo real
        </p>
      </div>
    </div>
  );
}
