import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Database, Bell, Server, Key, Activity, RefreshCw, Lock, Palette, Webhook, ChevronLeft, ChevronRight, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { Skeleton } from '../components/atoms/Skeleton';
import { useAuthStore } from '../store/authStore';

const SSLSettings = lazy(() => import('./settings/SSLSettings'));
const SecuritySettings = lazy(() => import('./settings/SecuritySettings'));
const BrandingSettings = lazy(() => import('./settings/BrandingSettings'));
const TelegramSettings = lazy(() => import('./settings/TelegramSettings'));
const NotificationsSettings = lazy(() => import('./settings/NotificationsSettings'));
const BackupSettings = lazy(() => import('./settings/BackupSettings'));
const SystemSettings = lazy(() => import('./settings/SystemSettings'));
const ApiKeysSettings = lazy(() => import('./settings/ApiKeysSettings'));
const ConnectionLogsSettings = lazy(() => import('./settings/ConnectionLogsSettings'));
const ToolsSettings = lazy(() => import('./settings/ToolsSettings'));
const DnsSettings = lazy(() => import('./settings/DnsSettings'));

type SettingsTab = 'ssl' | 'security' | 'branding' | 'telegram' | 'notifications' | 'backup' | 'system' | 'apikeys' | 'logs' | 'tools' | 'dns';

const SETTINGS_TAB_KEYS: SettingsTab[] = [
  'ssl',
  'security',
  'branding',
  'telegram',
  'notifications',
  'backup',
  'system',
  'apikeys',
  'logs',
  'tools',
  'dns'
];

function isSettingsTab(value: string | null): value is SettingsTab {
  if (!value) {
    return false;
  }
  return SETTINGS_TAB_KEYS.includes(value as SettingsTab);
}

const TabSkeleton: React.FC = () => (
  <div className="space-y-4">
    <Skeleton className="h-6 w-48" />
    <Skeleton className="h-40 w-full rounded-2xl" />
    <Skeleton className="h-40 w-full rounded-2xl" />
  </div>
);

export const Settings: React.FC = () => {
  const { t } = useTranslation();
  const admin = useAuthStore((state) => state.admin);
  const isSuperAdmin = admin?.role === 'SUPER_ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>('ssl');

  const tabs = useMemo(
    () => ([
      { key: 'ssl', label: t('settings.ssl', { defaultValue: 'SSL Certificate' }), icon: Shield, superOnly: false },
      { key: 'security', label: t('settings.security', { defaultValue: 'Security' }), icon: Lock, superOnly: false },
      { key: 'branding', label: t('settings.branding', { defaultValue: 'Branding' }), icon: Palette, superOnly: true },
      { key: 'telegram', label: t('settings.telegram'), icon: Bell, superOnly: false },
      { key: 'notifications', label: t('settings.notifications', { defaultValue: 'Notifications' }), icon: Webhook, superOnly: true },
      { key: 'backup', label: t('settings.backup'), icon: Database, superOnly: false },
      { key: 'system', label: t('settings.system'), icon: Server, superOnly: false },
      { key: 'apikeys', label: t('settings.apiKeys'), icon: Key, superOnly: false },
      { key: 'logs', label: t('logs.title'), icon: Activity, superOnly: false },
      { key: 'tools', label: t('settings.tools', { defaultValue: 'Tools' }), icon: RefreshCw, superOnly: true },
      { key: 'dns', label: t('settings.dns', { defaultValue: 'DNS' }), icon: Globe, superOnly: false }
    ] as const),
    [t]
  );
  const visibleTabs = tabs.filter((tab) => !tab.superOnly || isSuperAdmin);
  const firstVisibleTab = visibleTabs[0]?.key || 'ssl';
  const tabsScrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateTabOverflowState = useCallback(() => {
    const container = tabsScrollerRef.current;
    if (!container) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    setCanScrollLeft(container.scrollLeft > 4);
    setCanScrollRight(container.scrollLeft < maxScrollLeft - 4);
  }, []);

  useEffect(() => {
    const queryTab = searchParams.get('tab');
    if (isSettingsTab(queryTab)) {
      const tabDefinition = tabs.find((tab) => tab.key === queryTab);
      const allowed = Boolean(tabDefinition) && (!tabDefinition?.superOnly || isSuperAdmin);
      if (allowed) {
        if (queryTab !== activeTab) {
          setActiveTab(queryTab);
        }
        return;
      }
    }

    const currentDefinition = tabs.find((tab) => tab.key === activeTab);
    const currentAllowed = Boolean(currentDefinition) && (!currentDefinition?.superOnly || isSuperAdmin);
    if (!currentAllowed && activeTab !== firstVisibleTab) {
      setActiveTab(firstVisibleTab);
      const next = new URLSearchParams(searchParams);
      next.set('tab', firstVisibleTab);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, activeTab, tabs, isSuperAdmin, firstVisibleTab, setSearchParams]);

  useEffect(() => {
    updateTabOverflowState();

    const container = tabsScrollerRef.current;
    if (!container) {
      return undefined;
    }

    const handleScroll = () => updateTabOverflowState();
    const handleResize = () => updateTabOverflowState();

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [updateTabOverflowState, visibleTabs.length]);

  useEffect(() => {
    const container = tabsScrollerRef.current;
    if (!container) {
      return;
    }

    const activeButton = container.querySelector<HTMLButtonElement>(`button[data-settings-tab="${activeTab}"]`);
    if (!activeButton) {
      return;
    }

    activeButton.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  }, [activeTab, visibleTabs.length]);

  const setTab = (tab: SettingsTab) => {
    const tabDefinition = tabs.find((item) => item.key === tab);
    if (!tabDefinition || (tabDefinition.superOnly && !isSuperAdmin)) {
      return;
    }

    setActiveTab(tab);

    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    if (tab !== 'system') {
      next.delete('section');
    }
    setSearchParams(next, { replace: true });
  };

  const scrollTabsBy = (direction: 'left' | 'right') => {
    const container = tabsScrollerRef.current;
    if (!container) {
      return;
    }

    const amount = Math.max(180, container.clientWidth * 0.6);
    container.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth'
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('settings.title')}</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">{t('settings.subtitle', { defaultValue: 'Configure your panel settings' })}</p>
      </div>

      <div className="sticky top-0 z-20 -mx-1 px-1 py-1 md:static md:mx-0 md:px-0 md:py-0">
        <div className="relative">
          {canScrollLeft ? (
            <div className="pointer-events-none absolute inset-y-1 left-0 w-8 rounded-l-2xl bg-gradient-to-r from-white/95 to-transparent dark:from-gray-950/95 md:hidden" />
          ) : null}
          {canScrollRight ? (
            <div className="pointer-events-none absolute inset-y-1 right-0 w-8 rounded-r-2xl bg-gradient-to-l from-white/95 to-transparent dark:from-gray-950/95 md:hidden" />
          ) : null}

          {canScrollLeft ? (
            <button
              type="button"
              onClick={() => scrollTabsBy('left')}
              className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-gray-200/80 bg-white/90 p-1.5 text-gray-500 shadow-sm backdrop-blur hover:text-gray-900 dark:border-gray-700/80 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:text-white md:hidden"
              aria-label={t('settings.tabs.scrollLeft', { defaultValue: 'Scroll tabs left' })}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
          {canScrollRight ? (
            <button
              type="button"
              onClick={() => scrollTabsBy('right')}
              className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-gray-200/80 bg-white/90 p-1.5 text-gray-500 shadow-sm backdrop-blur hover:text-gray-900 dark:border-gray-700/80 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:text-white md:hidden"
              aria-label={t('settings.tabs.scrollRight', { defaultValue: 'Scroll tabs right' })}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null}

          <div
            ref={tabsScrollerRef}
            className="flex snap-x snap-mandatory gap-1 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white/80 p-1 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/70"
          >
            {visibleTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                data-settings-tab={key}
                onClick={() => setTab(key)}
                aria-current={activeTab === key ? 'page' : undefined}
                className={`flex shrink-0 snap-start items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${activeTab === key
                  ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/80 dark:hover:text-gray-200'
                  }`}
              >
                <Icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'ssl' ? <SSLSettings /> : null}
          {activeTab === 'security' ? <SecuritySettings /> : null}
          {activeTab === 'branding' ? <BrandingSettings /> : null}
          {activeTab === 'telegram' ? <TelegramSettings /> : null}
          {activeTab === 'notifications' ? <NotificationsSettings /> : null}
          {activeTab === 'backup' ? <BackupSettings /> : null}
          {activeTab === 'system' ? <SystemSettings /> : null}
          {activeTab === 'apikeys' ? <ApiKeysSettings /> : null}
          {activeTab === 'logs' ? <ConnectionLogsSettings /> : null}
          {activeTab === 'tools' ? <ToolsSettings /> : null}
          {activeTab === 'dns' ? <DnsSettings /> : null}
        </Suspense>
      </div>
    </div>
  );
};

export const SettingsPage = Settings;
