'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useTheme } from '@/hooks/useTheme';
import { FUNCOES } from '@/lib/constants';
import { 
  LayoutDashboard, Upload, AlertTriangle, ShoppingCart, Lock, Shield, Users, UserCog,
  LogOut, Menu, X, Wifi, WifiOff, Sun, Moon, Crown, KeyRound, Eye, EyeOff, CheckCircle2, ClipboardList, ShieldAlert
} from 'lucide-react';

const ICON_MAP = { LayoutDashboard, Upload, AlertTriangle, ShoppingCart, Lock, Shield, Users, UserCog, Crown, ClipboardList, ShieldAlert };

export default function DashboardLayout({ children }) {
  const { user, colaborador, loading, logout, changePassword } = useAuth();
  const { filteredNavItems, canAccess, isMaster } = usePermissions();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [online, setOnline] = useState(true);

  // Change Password Modal
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [cpNewPwd, setCpNewPwd] = useState('');
  const [cpConfirmPwd, setCpConfirmPwd] = useState('');
  const [cpShowNew, setCpShowNew] = useState(false);
  const [cpShowConfirm, setCpShowConfirm] = useState(false);
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState(false);

  const openChangePwd = () => {
    setCpNewPwd(''); setCpConfirmPwd('');
    setCpError(''); setCpSuccess(false);
    setCpLoading(false);
    setShowChangePassword(true);
    setSidebarOpen(false);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (cpNewPwd.length < 6) { setCpError('A senha deve ter pelo menos 6 caracteres.'); return; }
    if (cpNewPwd !== cpConfirmPwd) { setCpError('As senhas não coincidem.'); return; }
    setCpLoading(true); setCpError('');
    try {
      await changePassword(cpNewPwd);
      setCpSuccess(true);
      setTimeout(() => setShowChangePassword(false), 2000);
    } catch (err) {
      setCpError(err.message || 'Erro ao alterar senha.');
    } finally {
      setCpLoading(false);
    }
  };

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
            onClick={openChangePwd}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-primary hover:bg-primary/5 transition-all cursor-pointer mb-1"
          >
            <KeyRound className="w-4.5 h-4.5" />
            Mudar Senha
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
                onClick={openChangePwd}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-text-muted hover:text-primary hover:bg-primary/5 transition-all cursor-pointer mb-1"
              >
                <KeyRound className="w-5 h-5" />
                Mudar Senha
              </button>
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

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && setShowChangePassword(false)}>
          <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
                  <KeyRound className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-text">Mudar Senha</h2>
                  <p className="text-xs text-text-muted">Defina uma nova senha para sua conta</p>
                </div>
              </div>
              <button onClick={() => setShowChangePassword(false)} className="text-text-muted hover:text-text transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleChangePassword} className="p-5 space-y-4">
              {cpSuccess ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="w-14 h-14 rounded-full bg-success/20 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-success" />
                  </div>
                  <p className="text-base font-semibold text-text">Senha alterada!</p>
                  <p className="text-sm text-text-muted text-center">Sua senha foi atualizada com sucesso.</p>
                </div>
              ) : (
                <>
                  {/* New Password */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-muted">Nova Senha</label>
                    <div className="relative">
                      <input
                        type={cpShowNew ? 'text' : 'password'}
                        value={cpNewPwd}
                        onChange={(e) => { setCpNewPwd(e.target.value); setCpError(''); }}
                        placeholder="Mínimo 6 caracteres"
                        required
                        className="w-full px-4 py-2.5 pr-10 rounded-xl bg-bg border border-border text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary transition-colors"
                      />
                      <button type="button" onClick={() => setCpShowNew(!cpShowNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text cursor-pointer">
                        {cpShowNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-muted">Confirmar Nova Senha</label>
                    <div className="relative">
                      <input
                        type={cpShowConfirm ? 'text' : 'password'}
                        value={cpConfirmPwd}
                        onChange={(e) => { setCpConfirmPwd(e.target.value); setCpError(''); }}
                        placeholder="Repita a nova senha"
                        required
                        className="w-full px-4 py-2.5 pr-10 rounded-xl bg-bg border border-border text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary transition-colors"
                      />
                      <button type="button" onClick={() => setCpShowConfirm(!cpShowConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text cursor-pointer">
                        {cpShowConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Password strength hint */}
                  {cpNewPwd.length > 0 && (
                    <div className="flex items-center gap-2">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                          cpNewPwd.length >= (i + 1) * 2
                            ? cpNewPwd.length < 8 ? 'bg-warning' : 'bg-success'
                            : 'bg-border'
                        }`} />
                      ))}
                      <span className="text-xs text-text-muted ml-1">
                        {cpNewPwd.length < 6 ? 'Fraca' : cpNewPwd.length < 10 ? 'Média' : 'Forte'}
                      </span>
                    </div>
                  )}

                  {/* Error */}
                  {cpError && (
                    <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{cpError}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => setShowChangePassword(false)}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-text-muted hover:bg-surface-2 transition-all cursor-pointer">
                      Cancelar
                    </button>
                    <button type="submit" disabled={cpLoading}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2">
                      {cpLoading ? (
                        <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Alterando...</>
                      ) : 'Alterar Senha'}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      )}


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
