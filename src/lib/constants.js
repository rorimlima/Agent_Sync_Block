export const SETORES = {
  financeiro: { label: 'Financeiro', color: '#6366f1', icon: 'DollarSign' },
  documentacao: { label: 'Documentação', color: '#f59e0b', icon: 'FileText' },
  agente: { label: 'Agente', color: '#10b981', icon: 'Shield' },
};

export const SETOR_CREDENTIALS = {
  financeiro: { email: 'financeiro@agentsync.com', password: 'financeiro' },
  documentacao: { email: 'documentacao@agentsync.com', password: 'documento' },
  agente: { email: 'agente@agentsync.com', password: 'agente' },
};

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', roles: ['financeiro', 'documentacao', 'agente'] },
  { href: '/dashboard/importar', label: 'Importar Dados', icon: 'Upload', roles: ['financeiro'] },
  { href: '/dashboard/inadimplencia', label: 'Inadimplência', icon: 'AlertTriangle', roles: ['financeiro', 'documentacao'] },
  { href: '/dashboard/vendas', label: 'Vendas', icon: 'ShoppingCart', roles: ['financeiro', 'documentacao'] },
  { href: '/dashboard/bloqueados', label: 'Bloqueados', icon: 'Lock', roles: ['financeiro', 'documentacao', 'agente'] },
  { href: '/dashboard/agente', label: 'Agente', icon: 'Shield', roles: ['agente'] },
];
