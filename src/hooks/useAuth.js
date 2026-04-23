'use client';
import { useState, useEffect, createContext, useContext } from 'react';
import { supabase } from '@/lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [setor, setSetor] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setSetor(session.user.user_metadata?.setor || null);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setSetor(session.user.user_metadata?.setor || null);
      } else {
        setUser(null);
        setSetor(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (setorKey, password) => {
    const { SETOR_CREDENTIALS } = await import('@/lib/constants');
    const cred = SETOR_CREDENTIALS[setorKey];
    if (!cred) throw new Error('Setor inválido');

    if (password !== cred.password.toString()) {
      throw new Error('Senha incorreta');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cred.email,
      password: cred.password,
    });

    if (error) throw error;

    // Log de login
    await supabase.from('audit_logs').insert({
      acao: 'LOGIN',
      setor: setorKey,
      detalhes: `Login do setor ${setorKey}`,
      user_id: data.user.id,
      user_email: data.user.email,
    });

    return data;
  };

  const logout = async () => {
    if (user) {
      await supabase.from('audit_logs').insert({
        acao: 'LOGOUT',
        setor: setor,
        detalhes: `Logout do setor ${setor}`,
        user_id: user.id,
        user_email: user.email,
      });
    }
    await supabase.auth.signOut();
  };

  const hasRole = (roles) => {
    if (!setor) return false;
    if (typeof roles === 'string') return setor === roles;
    return roles.includes(setor);
  };

  return (
    <AuthContext.Provider value={{ user, setor, loading, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
