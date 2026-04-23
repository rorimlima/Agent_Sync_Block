'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_ROUTE } from '@/lib/constants';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { login, user, colaborador } = useAuth();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (user && colaborador) {
      router.replace(DEFAULT_ROUTE[colaborador.funcao] || '/dashboard');
    }
  }, [user, colaborador, router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!firstName.trim()) { setError('Digite o primeiro nome'); return; }
    if (!lastName.trim()) { setError('Digite o segundo nome'); return; }
    if (!password) { setError('Digite sua senha'); return; }
    setLoading(true);
    setError('');
    try {
      const email = `${firstName.trim().toLowerCase()}.${lastName.trim().toLowerCase()}@agentsync.com`;
      const result = await login(email, password);
      router.push(DEFAULT_ROUTE[result.colaborador.funcao] || '/dashboard');
    } catch (err) {
      setError(err.message || 'Credenciais inválidas');
    } finally {
      setLoading(false);
    }
  };

  const fn = firstName.trim();
  const ln = lastName.trim();
  const userPreview = fn || ln
    ? `${fn || '…'}.${ln || '…'}`
    : null;

  return (
    <div className={`lp ${mounted ? 'lp--in' : ''}`}>
      {/* Left — Branding Panel */}
      <div className="lp__brand">
        <div className="lp__brand-bg">
          {[...Array(3)].map((_, i) => <div key={i} className={`lp__ring lp__ring--${i + 1}`} />)}
          <div className="lp__particles">
            {[...Array(20)].map((_, i) => (
              <div key={i} className="lp__dot" style={{
                left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 6}s`, animationDuration: `${4 + Math.random() * 4}s`,
              }} />
            ))}
          </div>
        </div>
        <div className="lp__brand-content">
          <div className="lp__logo">
            <svg viewBox="0 0 48 48" fill="none" className="lp__logo-svg">
              <rect x="4" y="4" width="40" height="40" rx="12" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
              <path d="M24 12L14 20v12l10 6 10-6V20L24 12z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none"/>
              <path d="M24 18v8m0 4v0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <circle cx="24" cy="32" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <h1 className="lp__title">Agent Sync<br/><span>Block</span></h1>
          <p className="lp__tagline">Sistema inteligente de gestão<br/>e controle de acesso</p>
          <div className="lp__features">
            {['Controle em tempo real', 'Gestão de bloqueios', 'Acesso por função'].map((t, i) => (
              <div key={i} className="lp__feat">
                <div className="lp__feat-dot" />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — Login Form */}
      <div className="lp__form-wrap">
        <div className="lp__card">
          <div className="lp__card-head">
            <h2>Bem-vindo</h2>
            <p>Insira suas credenciais para acessar o sistema</p>
          </div>

          <form onSubmit={handleLogin} className="lp__form">
            {/* Name Row */}
            <div className="lp__row">
              <div className="lp__field">
                <label htmlFor="fn">Primeiro nome</label>
                <input id="fn" type="text" value={firstName}
                  onChange={e => { setFirstName(e.target.value); setError(''); }}
                  placeholder="Primeiro nome" autoComplete="given-name" autoFocus />
              </div>
              <span className="lp__sep">.</span>
              <div className="lp__field">
                <label htmlFor="ln">Segundo nome</label>
                <input id="ln" type="text" value={lastName}
                  onChange={e => { setLastName(e.target.value); setError(''); }}
                  placeholder="Segundo nome" autoComplete="family-name" />
              </div>
            </div>

            {/* User preview */}
            {userPreview && (
              <div className="lp__preview">
                <span className="lp__preview-label">Usuário</span>
                <span className="lp__preview-val">{userPreview}</span>
              </div>
            )}

            {/* Password */}
            <div className="lp__field">
              <label htmlFor="pw">Senha</label>
              <div className="lp__pw-wrap">
                <input id="pw" type={showPass ? 'text' : 'password'} value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="••••••••" autoComplete="current-password" />
                <button type="button" className="lp__pw-eye" tabIndex={-1}
                  onClick={() => setShowPass(!showPass)}>
                  {showPass ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="lp__error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading} className="lp__btn">
              {loading
                ? <><Loader2 size={18} className="lp__spin" /> Entrando...</>
                : 'Entrar'}
            </button>
          </form>

          <p className="lp__foot">v2.0 — Controle de Acesso por Função</p>
        </div>
      </div>

      <style jsx>{`
        /* ═══ Layout ═══ */
        .lp{display:flex;min-height:100vh;background:#06060e;overflow:hidden}

        /* ═══ Brand Panel ═══ */
        .lp__brand{
          position:relative;flex:1;display:none;
          align-items:center;justify-content:center;
          overflow:hidden;
        }
        @media(min-width:900px){.lp__brand{display:flex}}

        .lp__brand-bg{position:absolute;inset:0;background:linear-gradient(160deg,#06060e 0%,#0d0d1a 40%,#100e20 100%)}

        /* Animated rings */
        .lp__ring{
          position:absolute;border-radius:50%;
          border:1px solid rgba(99,102,241,.08);
          animation:ringPulse 8s ease-in-out infinite;
        }
        .lp__ring--1{width:500px;height:500px;top:50%;left:50%;transform:translate(-50%,-50%);animation-delay:0s}
        .lp__ring--2{width:340px;height:340px;top:50%;left:50%;transform:translate(-50%,-50%);animation-delay:2s;border-color:rgba(139,92,246,.06)}
        .lp__ring--3{width:180px;height:180px;top:50%;left:50%;transform:translate(-50%,-50%);animation-delay:4s;border-color:rgba(99,102,241,.1)}

        @keyframes ringPulse{
          0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}
          50%{transform:translate(-50%,-50%) scale(1.15);opacity:.4}
        }

        /* Floating particles */
        .lp__particles{position:absolute;inset:0}
        .lp__dot{
          position:absolute;width:2px;height:2px;border-radius:50%;
          background:rgba(129,140,248,.5);
          animation:floatDot linear infinite;
        }
        @keyframes floatDot{
          0%{opacity:0;transform:translateY(0)}
          20%{opacity:1}
          80%{opacity:1}
          100%{opacity:0;transform:translateY(-60px)}
        }

        /* Brand content */
        .lp__brand-content{
          position:relative;z-index:2;text-align:center;padding:3rem;
          opacity:0;transform:translateX(-30px);
          transition:opacity .8s ease .3s,transform .8s ease .3s;
        }
        .lp--in .lp__brand-content{opacity:1;transform:translateX(0)}

        .lp__logo{
          display:inline-flex;align-items:center;justify-content:center;
          width:72px;height:72px;border-radius:20px;margin-bottom:1.5rem;
          background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.12));
          border:1px solid rgba(99,102,241,.15);
          backdrop-filter:blur(10px);
        }
        .lp__logo-svg{width:36px;height:36px;color:#818cf8}

        .lp__title{
          font-size:2.4rem;font-weight:800;line-height:1.1;
          color:#fff;letter-spacing:-.03em;margin:0;
        }
        .lp__title span{
          background:linear-gradient(135deg,#818cf8,#a78bfa);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;
          background-clip:text;
        }
        .lp__tagline{
          margin-top:.75rem;font-size:.9rem;color:rgba(255,255,255,.4);
          line-height:1.5;
        }
        .lp__features{
          margin-top:2rem;display:flex;flex-direction:column;gap:.6rem;
          align-items:center;
        }
        .lp__feat{display:flex;align-items:center;gap:.5rem;color:rgba(255,255,255,.45);font-size:.8rem}
        .lp__feat-dot{width:5px;height:5px;border-radius:50%;background:#6366f1;opacity:.7}

        /* ═══ Form Panel ═══ */
        .lp__form-wrap{
          flex:1;display:flex;align-items:center;justify-content:center;
          padding:2rem 1.5rem;position:relative;
          background:linear-gradient(180deg,#08081a 0%,#0b0b18 100%);
        }
        @media(min-width:900px){
          .lp__form-wrap{
            max-width:520px;
            border-left:1px solid rgba(99,102,241,.06);
          }
        }

        /* ═══ Card ═══ */
        .lp__card{
          width:100%;max-width:400px;
          opacity:0;transform:translateY(24px);
          transition:opacity .6s ease .2s,transform .6s ease .2s;
        }
        .lp--in .lp__card{opacity:1;transform:translateY(0)}

        .lp__card-head{margin-bottom:2rem}
        .lp__card-head h2{
          font-size:1.6rem;font-weight:700;color:#f0f0f5;
          letter-spacing:-.02em;margin:0 0 .4rem;
        }
        .lp__card-head p{font-size:.85rem;color:rgba(255,255,255,.35);margin:0}

        /* ═══ Form ═══ */
        .lp__form{display:flex;flex-direction:column;gap:1.25rem}

        .lp__row{display:flex;align-items:flex-end;gap:0}
        .lp__row .lp__field{flex:1;min-width:0}
        .lp__sep{
          padding:0 .4rem .7rem;font-size:1.4rem;font-weight:800;
          color:#6366f1;line-height:1;
        }
        @media(max-width:420px){
          .lp__row{flex-direction:column;gap:1rem}
          .lp__sep{display:none}
        }

        /* Fields */
        .lp__field label{
          display:block;font-size:.7rem;font-weight:600;
          text-transform:uppercase;letter-spacing:.06em;
          color:rgba(255,255,255,.3);margin-bottom:.4rem;
        }
        .lp__field input{
          width:100%;padding:.75rem 1rem;
          background:rgba(255,255,255,.04);
          border:1.5px solid rgba(255,255,255,.07);
          border-radius:10px;color:#f0f0f5;font-size:.9rem;
          font-family:inherit;outline:none;
          transition:border-color .2s,background .2s,box-shadow .2s;
        }
        .lp__field input::placeholder{color:rgba(255,255,255,.15);font-size:.82rem}
        .lp__field input:focus{
          border-color:rgba(99,102,241,.5);
          background:rgba(99,102,241,.04);
          box-shadow:0 0 0 3px rgba(99,102,241,.08);
        }

        /* Password wrapper */
        .lp__pw-wrap{position:relative}
        .lp__pw-wrap input{padding-right:2.5rem}
        .lp__pw-eye{
          position:absolute;right:10px;top:50%;transform:translateY(-50%);
          background:none;border:none;color:rgba(255,255,255,.25);
          cursor:pointer;padding:4px;display:flex;
          transition:color .2s;
        }
        .lp__pw-eye:hover{color:rgba(255,255,255,.6)}

        /* Preview badge */
        .lp__preview{
          display:flex;align-items:center;gap:.6rem;
          padding:.45rem .8rem;border-radius:8px;
          background:rgba(99,102,241,.06);
          border:1px solid rgba(99,102,241,.1);
          margin-top:-.25rem;
        }
        .lp__preview-label{
          font-size:.65rem;font-weight:600;text-transform:uppercase;
          letter-spacing:.05em;color:rgba(255,255,255,.25);
        }
        .lp__preview-val{
          font-size:.8rem;font-weight:600;color:#818cf8;
          font-family:'SF Mono',SFMono-Regular,Consolas,monospace;
        }

        /* Error */
        .lp__error{
          display:flex;align-items:center;gap:.45rem;
          padding:.65rem .85rem;border-radius:10px;
          background:rgba(239,68,68,.08);
          border:1px solid rgba(239,68,68,.15);
          color:#f87171;font-size:.82rem;
          animation:shake .35s ease;
        }
        @keyframes shake{
          0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}
          50%{transform:translateX(5px)}75%{transform:translateX(-3px)}
        }

        /* Button */
        .lp__btn{
          width:100%;padding:.85rem;margin-top:.5rem;
          background:linear-gradient(135deg,#6366f1 0%,#7c3aed 50%,#6366f1 100%);
          background-size:200% auto;
          border:none;border-radius:12px;
          color:#fff;font-size:.92rem;font-weight:700;font-family:inherit;
          cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.5rem;
          transition:background-position .4s ease,transform .15s,box-shadow .3s;
          position:relative;overflow:hidden;
        }
        .lp__btn::after{
          content:'';position:absolute;inset:0;
          background:linear-gradient(135deg,transparent 40%,rgba(255,255,255,.08) 50%,transparent 60%);
          background-size:200% auto;
          animation:shimmer 3s ease-in-out infinite;
        }
        @keyframes shimmer{
          0%{background-position:200% center}
          100%{background-position:-200% center}
        }
        .lp__btn:hover:not(:disabled){
          background-position:right center;
          transform:translateY(-1px);
          box-shadow:0 8px 30px rgba(99,102,241,.25);
        }
        .lp__btn:active:not(:disabled){transform:translateY(0)}
        .lp__btn:disabled{opacity:.6;cursor:not-allowed}
        .lp__spin{animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}

        /* Footer */
        .lp__foot{
          margin-top:2.5rem;text-align:center;
          font-size:.68rem;color:rgba(255,255,255,.15);
          letter-spacing:.03em;
        }

        /* ═══ Mobile: show mini brand ═══ */
        @media(max-width:899px){
          .lp{flex-direction:column}
          .lp__form-wrap{
            flex:1;background:linear-gradient(180deg,#08081a,#0b0b18);
          }
          .lp__card-head::before{
            content:'Agent Sync Block';
            display:block;font-size:1.1rem;font-weight:800;
            color:#818cf8;margin-bottom:1.2rem;letter-spacing:-.01em;
          }
        }
      `}</style>
    </div>
  );
}
