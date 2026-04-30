'use client';
import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const AuthContext = createContext(null);

const CACHE_VERSION = 'v2';

const saveToCache = (key, data) => {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      version: CACHE_VERSION,
      timestamp: Date.now(),
      data,
    }));
  } catch { /* ignorar */ }
};

const loadFromCache = (key, maxAgeMs = 86400000) => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key));
    if (!cached) return null;
    if (cached.version !== CACHE_VERSION) return null;
    if (Date.now() - cached.timestamp > maxAgeMs) return null;
    return cached.data;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [colaborador, setColaborador] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastAuthCheckRef = useRef(0);

  // Safety timer escalonado — avisa em 20s, força reset em 45s
  useEffect(() => {
    if (!loading) return;
    
    const warnTimer = setTimeout(() => {
      console.warn('[Agent Sync] Loading de auth longo detectado (20s)');
    }, 20000);
    
    const killTimer = setTimeout(() => {
      console.error('[Agent Sync] Safety timer de auth atingido — forçando reset');
      setLoading(false);
    }, 45000);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(killTimer);
    };
  }, [loading]);

  // Visibilitychange + Focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastAuthCheckRef.current;
        if (elapsed > 30000) {
          setLoading(false);
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
              setUser(session.user);
            }
          });
        }
      }
    };
    
    const handleFocus = () => {
      const elapsed = Date.now() - lastAuthCheckRef.current;
      if (elapsed > 30000) {
        setLoading(false);
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user) {
            setUser(session.user);
          }
        });
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Fetch colaborador profile from DB (with sessionStorage cache)
  const fetchColaborador = useCallback(async (authUser) => {
    if (!authUser) {
      setColaborador(null);
      return null;
    }

    // Tentar cache rápido do sessionStorage primeiro (com validação)
    const cached = loadFromCache('asb-colab');
    if (cached && cached.auth_user_id === authUser.id) {
      setColaborador(cached);
      // Revalidar em background (non-blocking) com retry
      const maxRetries = 3;
      (async () => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const { data } = await supabase.from('colaboradores').select('*').eq('auth_user_id', authUser.id).single();
            if (data && data.funcao) { // validação simples
              setColaborador(data);
              saveToCache('asb-colab', data);
            }
            break;
          } catch (err) {
            if (attempt === maxRetries) break;
            await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
          }
        }
      })();
      return cached;
    }

    let data = null;
    let error = null;
    const maxRetries = 3;
    
    // Fetch with retry
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const res = await supabase
        .from('colaboradores')
        .select('*')
        .eq('auth_user_id', authUser.id)
        .single();
        
      data = res.data;
      error = res.error;
      
      if (!error) break;
      if (attempt === maxRetries) break;
      await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
    }

    if (error || !data || !data.funcao) {
      console.error('[Agent Sync] Erro ou dados incompletos ao buscar colaborador:', error || 'Dados faltantes');
      setColaborador(null);
      return null;
    }
    
    setColaborador(data);
    saveToCache('asb-colab', data);
    return data;
  }, []);

  useEffect(() => {
    // Inicialização rápida: checar sessão existente
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        await fetchColaborador(session.user);
      }
      setLoading(false);
      lastAuthCheckRef.current = Date.now();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        await fetchColaborador(session.user);
      } else {
        setUser(null);
        setColaborador(null);
        try { sessionStorage.removeItem('asb-colab'); } catch {}
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchColaborador]);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message.includes('Invalid login')) {
        throw new Error('Email ou senha incorretos');
      }
      throw error;
    }

    // Fetch colaborador profile
    const colab = await fetchColaborador(data.user);

    if (!colab) {
      await supabase.auth.signOut();
      throw new Error('Colaborador não encontrado no sistema');
    }

    if (!colab.ativo) {
      await supabase.auth.signOut();
      throw new Error('Sua conta está bloqueada. Contate o administrador.');
    }

    // Audit log (non-blocking)
    supabase.from('audit_logs').insert({
      acao: 'LOGIN',
      setor: colab.funcao,
      detalhes: `Login de ${colab.nome} (${colab.funcao})`,
      user_id: data.user.id,
      user_email: data.user.email,
    }).then(() => {});

    return { user: data.user, colaborador: colab };
  };

  const changePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;

    // Audit log (non-blocking)
    if (user && colaborador) {
      supabase.from('audit_logs').insert({
        acao: 'TROCA_SENHA',
        setor: colaborador.funcao,
        detalhes: `${colaborador.nome} alterou a própria senha`,
        user_id: user.id,
        user_email: user.email,
      }).then(() => {});
    }
  };

  const logout = async () => {
    if (user && colaborador) {
      // Non-blocking audit
      supabase.from('audit_logs').insert({
        acao: 'LOGOUT',
        setor: colaborador.funcao,
        detalhes: `Logout de ${colaborador.nome} (${colaborador.funcao})`,
        user_id: user.id,
        user_email: user.email,
      }).then(() => {});
    }
    setUser(null);
    setColaborador(null);
    try { sessionStorage.removeItem('asb-colab'); } catch {}
    await supabase.auth.signOut();
  };

  const hasRole = (roles) => {
    if (!colaborador?.funcao) return false;
    if (typeof roles === 'string') return colaborador.funcao === roles;
    return roles.includes(colaborador.funcao);
  };

  return (
    <AuthContext.Provider value={{ user, colaborador, setor: colaborador?.funcao, loading, login, logout, hasRole, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
