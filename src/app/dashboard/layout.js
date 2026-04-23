'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useTheme } from '@/hooks/useTheme';
import { FUNCOES } from '@/lib/constants';
import { 
  LayoutDashboard, Upload, AlertTriangle, ShoppingCart, Lock, Shield, Users, UserCog,
  LogOut, Menu, X, Wifi, WifiOff, Sun, Moon, Crown
} from 'lucide-react';

const ICON_MAP = { LayoutDashboard, Upload, AlertTriangle, ShoppingCart, Lock, Shield, Users, UserCog, Crown };

export default function DashboardLayout({ children }) {
  const { user, colaborador, loading, logout } = useAuth();
  const { filteredNavItems, canAccess, isMaster } = usePermissions();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // Route protection
  useEffect(() => {
    if (!loading && user && colaborador && !canAccess(pathname)) {
      const { DEFAULT_ROUTE } = require('@/lib/constants');
      const fallback = DEFAULT_ROUTE[colaborador.funcao] || '/dashboard';
      router.replace(fallback);
    }
  }, [pathname, loading, user, colaborador, canAccess, router]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const funcaoInfo = FUNCOES[colaborador?.funcao] || { label: colaborador?.funcao || 'Usuário', color: '#6366f1' };
  const displayName = colaborador?.nome || user.email;

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen bg-bg flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-surface border-r border-border fixed h-full z-30">
        {/* Logo */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-text">Agent Sync Block</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                {online ? (
                  <><Wifi className="w-3 h-3 text-success" /><span className="text-xs text-success">Online</span></>
                ) : (
                  <><WifiOff className="w-3 h-3 text-danger" /><span className="text-xs text-danger">Offline</span></>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {filteredNavItems.map(item => {
            const Icon = ICON_MAP[item.icon];
            const isActive = pathname === item.href;
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                  isActive 
                    ? 'bg-primary/10 text-primary border border-primary/20' 
                    : 'text-text-muted hover:text-text hover:bg-surface-2'
                }`}
              >
                {Icon && <Icon className="w-4.5 h-4.5" />}
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User / Logout */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: funcaoInfo.color }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text truncate">{displayName}</p>
              <p className="text-xs text-text-muted truncate">
                {isMaster && <span className="text-purple-400">★ </span>}
                {funcaoInfo.label}
              </p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-primary hover:bg-primary/5 transition-all cursor-pointer mb-1"
          >
            {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
            {theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-danger hover:bg-danger/5 transition-all cursor-pointer"
          >
            <LogOut className="w-4.5 h-4.5" />
            Sair
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-surface border-b border-border flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary" />
          <span className="text-sm font-bold text-text">SyncBlock</span>
        </div>
        <div className="flex items-center gap-3">
          {online ? <Wifi className="w-4 h-4 text-success" /> : <WifiOff className="w-4 h-4 text-danger" />}
          <button onClick={toggleTheme} className="text-text-muted hover:text-primary cursor-pointer">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-text-muted cursor-pointer">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setSidebarOpen(false)} />
          <aside className="md:hidden fixed top-14 left-0 w-72 h-[calc(100%-3.5rem)] bg-surface border-r border-border z-50 flex flex-col">
            {/* User Info */}
            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-3 px-2 py-1">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: funcaoInfo.color }}>
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{displayName}</p>
                  <p className="text-xs text-text-muted truncate">{funcaoInfo.label}</p>
                </div>
              </div>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {filteredNavItems.map(item => {
                const Icon = ICON_MAP[item.icon];
                const isActive = pathname === item.href;
                return (
                  <button
                    key={item.href}
                    onClick={() => { router.push(item.href); setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text hover:bg-surface-2'
                    }`}
                  >
                    {Icon && <Icon className="w-5 h-5" />}
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-border">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-text-muted hover:text-danger hover:bg-danger/5 transition-all cursor-pointer"
              >
                <LogOut className="w-5 h-5" />
                Sair
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Main Content */}
      <main className="flex-1 md:ml-64 mt-14 md:mt-0 min-h-screen">
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex items-center justify-around h-16 z-40">
        {filteredNavItems.slice(0, 5).map(item => {
          const Icon = ICON_MAP[item.icon];
          const isActive = pathname === item.href;
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`flex flex-col items-center gap-1 px-2 py-1 transition-all cursor-pointer ${
                isActive ? 'text-primary' : 'text-text-muted'
              }`}
            >
              {Icon && <Icon className="w-5 h-5" />}
              <span className="text-[10px] font-medium">{item.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
