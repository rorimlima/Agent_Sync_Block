export const FUNCOES = {
  master: { label: 'Master', color: '#8b5cf6', icon: 'Crown' },
  financeiro: { label: 'Financeiro', color: '#6366f1', icon: 'DollarSign' },
  documentacao: { label: 'Documentação', color: '#f59e0b', icon: 'FileText' },
  agente: { label: 'Agente', color: '#10b981', icon: 'Shield' },
};

// Map of allowed routes per function
export const PERMISSION_MAP = {
  master: [
    '/dashboard',
    '/dashboard/importar',
    '/dashboard/clientes',
    '/dashboard/inadimplencia',
    '/dashboard/vendas',
    '/dashboard/bloqueados',
    '/dashboard/agente',
    '/dashboard/colaboradores',
    '/dashboard/logs',
  ],
  financeiro: [
    '/dashboard',
    '/dashboard/importar',
    '/dashboard/vendas',
    '/dashboard/inadimplencia',
    '/dashboard/clientes',
    '/dashboard/logs',
  ],
  documentacao: [
    '/dashboard',
    '/dashboard/vendas',
  ],
  agente: [
    '/dashboard/bloqueados',
  ],
};

// Default redirect per function after login
export const DEFAULT_ROUTE = {
  master: '/dashboard',
  financeiro: '/dashboard',
  documentacao: '/dashboard',
  agente: '/dashboard/bloqueados',
};

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', roles: ['master', 'financeiro', 'documentacao'] },
  { href: '/dashboard/importar', label: 'Importar Dados', icon: 'Upload', roles: ['master', 'financeiro'] },
  { href: '/dashboard/clientes', label: 'Clientes', icon: 'Users', roles: ['master', 'financeiro'] },
  { href: '/dashboard/inadimplencia', label: 'Inadimplência', icon: 'AlertTriangle', roles: ['master', 'financeiro'] },
  { href: '/dashboard/vendas', label: 'Vendas', icon: 'ShoppingCart', roles: ['master', 'financeiro', 'documentacao'] },
  { href: '/dashboard/bloqueados', label: 'Bloqueados', icon: 'Lock', roles: ['master', 'financeiro', 'documentacao', 'agente'] },
  { href: '/dashboard/agente', label: 'Agente', icon: 'Shield', roles: ['master', 'agente'] },
  { href: '/dashboard/colaboradores', label: 'Colaboradores', icon: 'UserCog', roles: ['master'] },
  { href: '/dashboard/logs', label: 'Logs de Atividade', icon: 'ClipboardList', roles: ['master', 'financeiro'] },
];
