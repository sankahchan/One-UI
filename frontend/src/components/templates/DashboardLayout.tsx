import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Layers3,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Radio,
  Settings,
  Users,
  X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { authApi } from '../../api/auth';
import { useXrayUpdatePreflight } from '../../hooks/useXray';
import { useAuthStore } from '../../store/authStore';
import { prefetchRoute } from '../../utils/routePrefetch';
import { Button } from '../atoms/Button';
import { LanguageSwitcher } from '../molecules/LanguageSwitcher';
import { SearchBar } from '../molecules/SearchBar';
import { ThemeToggle } from '../molecules/ThemeToggle';
import { MobileQuickActions } from '../shared/MobileQuickActions';

interface MenuItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const DashboardLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { admin, logout, refreshToken } = useAuthStore();
  const canSeeUpdateHealth = admin?.role === 'SUPER_ADMIN' || admin?.role === 'ADMIN';
  const xrayUpdatePreflightQuery = useXrayUpdatePreflight(canSeeUpdateHealth);
  const xrayUpdatePreflight = xrayUpdatePreflightQuery.data;
  const hasActiveLockIssue = Boolean(
    xrayUpdatePreflight?.checks?.find((check) => check.id === 'update-lock' && !check.ok)
  );
  const hasBlockingFailure = Boolean(
    xrayUpdatePreflight?.checks?.find((check) => check.blocking && !check.ok)
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const handleNavigate = useCallback((path: string) => {
    navigate(path);
    setSidebarOpen(false);
  }, [navigate]);

  const updateHealthBadge = canSeeUpdateHealth ? (
    <button
      type="button"
      onClick={() => handleNavigate('/settings?tab=system&section=xray-updates')}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${xrayUpdatePreflightQuery.isLoading
          ? 'border-line/70 bg-card/70 text-muted'
          : xrayUpdatePreflight?.ready
            ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
            : hasActiveLockIssue
              ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
              : hasBlockingFailure
                ? 'border-amber-500/45 bg-amber-500/15 text-amber-300'
                : 'border-line/70 bg-card/70 text-muted'
        }`}
      title="Xray update preflight status"
    >
      {xrayUpdatePreflightQuery.isLoading ? (
        <>
          <span className="h-2 w-2 animate-pulse rounded-full bg-muted" />
          <span className="hidden md:inline">Checking update health</span>
        </>
      ) : xrayUpdatePreflight?.ready ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Update Ready</span>
        </>
      ) : hasActiveLockIssue ? (
        <>
          <Lock className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Update Locked</span>
        </>
      ) : (
        <>
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Update Needs Fix</span>
        </>
      )}
    </button>
  ) : null;

  const menuItems = useMemo<MenuItem[]>(
    () => [
      { path: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
      { path: '/users', icon: Users, label: t('nav.users') },
      { path: '/groups', icon: Layers3, label: t('nav.groups') },
      { path: '/inbounds', icon: Radio, label: t('nav.inbounds') },
      { path: '/settings', icon: Settings, label: t('nav.settings') }
    ],
    [t]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      for (const item of menuItems) {
        prefetchRoute(item.path, { includeData: false });
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [menuItems]);

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const handleLogout = () => {
    void authApi.logout(refreshToken);
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen text-foreground transition-colors">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-card/80 backdrop-blur-xl lg:hidden">
        <div className="flex w-full items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line/70 bg-card/80 text-muted transition hover:text-foreground"
              aria-label="Toggle navigation"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <button
              onClick={() => handleNavigate('/dashboard')}
              className="rounded-lg px-1 text-left"
            >
              <p className="text-sm font-semibold tracking-wide text-muted">ONE-UI</p>
              <p className="text-base font-bold text-foreground">Control Center</p>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {updateHealthBadge}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex h-screen w-full overflow-hidden">
        <aside
          className={`glass-panel fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
        >
          <div className="flex h-full flex-col">
            <div className="border-b border-line/70 px-6 py-6">
              <button onClick={() => handleNavigate('/dashboard')} className="text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">ONE-UI</p>
                <h1 className="mt-2 text-2xl font-bold text-foreground">Control Center</h1>
              </button>
            </div>

            <div className="border-b border-line/70 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-sm font-bold text-white shadow-soft">
                  {(admin?.username || 'A').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{admin?.username || 'Admin'}</p>
                  <p className="truncate text-xs text-muted">{admin?.role || 'ADMIN'}</p>
                </div>
              </div>
            </div>

            <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-5">
              {menuItems.map(({ path, icon: Icon, label }) => {
                const active = isActive(path);
                return (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    onMouseEnter={() => prefetchRoute(path)}
                    onFocus={() => prefetchRoute(path)}
                    onTouchStart={() => prefetchRoute(path)}
                    className={`group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-all ${active
                        ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-soft'
                        : 'text-muted hover:bg-card hover:text-foreground'
                      }`}
                  >
                    <Icon className={`h-5 w-5 ${active ? 'text-white' : 'text-muted group-hover:text-foreground'}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-line/70 px-4 py-4">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={handleLogout}
              >
                <LogOut className="mr-3 h-5 w-5" />
                {t('nav.logout')}
              </Button>
            </div>
          </div>
        </aside>

        {sidebarOpen ? (
          <button
            className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          />
        ) : null}

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-transparent">
          <div className="sticky top-0 z-30 hidden items-center justify-between border-b border-line/70 bg-card/75 px-6 py-4 backdrop-blur-xl lg:flex xl:px-8">
            <SearchBar />
            <div className="flex items-center gap-3">
              {updateHealthBadge}
              <LanguageSwitcher />
              <ThemeToggle />
              <div className="rounded-xl border border-line/70 bg-card/65 px-3 py-2 text-sm text-muted">
                {t('auth.welcomeBack')}, <strong className="text-foreground">{admin?.username}</strong>
              </div>
            </div>
          </div>

          <div className="mobile-shell px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-card/90 px-2 pb-[calc(env(safe-area-inset-bottom)+0.45rem)] pt-2 backdrop-blur-xl lg:hidden">
        <ul className={`grid gap-1 ${menuItems.length > 4 ? 'grid-cols-5' : 'grid-cols-4'}`}>
          {menuItems.map(({ path, icon: Icon, label }) => {
            const active = isActive(path);
            return (
              <li key={`mobile-${path}`}>
                <button
                  onClick={() => handleNavigate(path)}
                  onMouseEnter={() => prefetchRoute(path)}
                  onFocus={() => prefetchRoute(path)}
                  onTouchStart={() => prefetchRoute(path)}
                  className={`flex w-full flex-col items-center justify-center rounded-xl px-2 py-2.5 text-[11px] font-medium transition-all ${active ? 'bg-brand-500 text-white shadow-soft' : 'text-muted hover:bg-card hover:text-foreground'
                    }`}
                >
                  <Icon className="mb-1 h-4 w-4" />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <MobileQuickActions />
    </div>
  );
};
