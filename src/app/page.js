'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_ROUTE } from '@/lib/constants';

export default function HomePage() {
  const router = useRouter();
  const { user, colaborador, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (user && colaborador) {
        const route = DEFAULT_ROUTE[colaborador.funcao] || '/dashboard';
        router.replace(route);
      } else {
        router.replace('/login');
      }
    }
  }, [user, colaborador, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-text-muted text-sm">Carregando...</p>
      </div>
    </div>
  );
}
