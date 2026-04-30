'use client';
import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [colaborador, setColaborador] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastAuthCheckRef = useRef(0);

  // Safety timer — força reset do loading de auth se ficar travado por mais de 45s
  useEffect(() => {
    if (loading) {
      const safetyTimer = setTimeout(() => {
        setLoading(false);
      }, 45000);
      return () => clearTimeout(safetyTimer);
    }
  }, [loading]);

  // Visibilitychange — reset auth loading quando o usuário volta para a aba
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastAuthCheckRef.current;
        // Se faz mais de 30s, forçar reset do loading e revalidar sessão
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
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Fetch colaborador profile from DB (with sessionStorage cache)
  const fetchColaborador = useCallback(async (authUser) => {
    if (!authUser) {
      setColaborador(null);
      return null;
    }

    // Tentar cache rápido do sessionStorage primeiro
    try {
      const cached = sessionStorage.getItem('asb-colab');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.auth_user_id === authUser.id) {
          setColaborador(parsed);
          // Revalidar em background (non-blocking)
          supabase.from('colaboradores').select('*').eq('auth_user_id', authUser.id).single()
            .then(({ data }) => {
              if (data) {
                setColaborador(data);
                try { sessionStorage.setItem('asb-colab', JSON.stringify(data)); } catch {}
              }
            });
          return parsed;
        }
      }
    } catch {}

    const { data, error } = await supabase
      .from('colaboradores')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .single();

    if (error || !data) {
      setColaborador(null);
      return null;
    }
    setColaborador(data);
    try { sessionStorage.setItem('asb-colab', JSON.stringify(data)); } catch {}
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
