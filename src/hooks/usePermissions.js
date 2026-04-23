'use client';
import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { PERMISSION_MAP, NAV_ITEMS } from '@/lib/constants';

export function usePermissions() {
  const { colaborador } = useAuth();
  const funcao = colaborador?.funcao;

  const allowedRoutes = useMemo(() => {
    if (!funcao) return [];
    return PERMISSION_MAP[funcao] || [];
  }, [funcao]);

  const canAccess = (route) => {
    if (!funcao) return false;
    if (funcao === 'master') return true;
    return allowedRoutes.some(r => route === r || route.startsWith(r + '/'));
  };

  const filteredNavItems = useMemo(() => {
    if (!funcao) return [];
    return NAV_ITEMS.filter(item => item.roles.includes(funcao));
  }, [funcao]);

  const isMaster = funcao === 'master';

  return {
    funcao,
    allowedRoutes,
    canAccess,
    filteredNavItems,
    isMaster,
  };
}
