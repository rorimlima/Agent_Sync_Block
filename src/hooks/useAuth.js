'use client';
import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [colaborador, setColaborador] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch colaborador profile from DB
  const fetchColaborador = useCallback(async (authUser) => {
    if (!authUser) {
      setColaborador(null);
      return null;
    }
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
    return data;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        await fetchColaborador(session.user);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        await fetchColaborador(session.user);
      } else {
        setUser(null);
        setColaborador(null);
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

    // Audit log
    await supabase.from('audit_logs').insert({
      acao: 'LOGIN',
      setor: colab.funcao,
      detalhes: `Login de ${colab.nome} (${colab.funcao})`,
      user_id: data.user.id,
      user_email: data.user.email,
    });

    return { user: data.user, colaborador: colab };
  };

  const changePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;

    // Audit log
    if (user && colaborador) {
      await supabase.from('audit_logs').insert({
        acao: 'TROCA_SENHA',
        setor: colaborador.funcao,
        detalhes: `${colaborador.nome} alterou a própria senha`,
        user_id: user.id,
        user_email: user.email,
      });
    }
  };

  const logout = async () => {
    if (user && colaborador) {
      await supabase.from('audit_logs').insert({
        acao: 'LOGOUT',
        setor: colaborador.funcao,
        detalhes: `Logout de ${colaborador.nome} (${colaborador.funcao})`,
        user_id: user.id,
        user_email: user.email,
      });
    }
    setUser(null);
    setColaborador(null);
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
