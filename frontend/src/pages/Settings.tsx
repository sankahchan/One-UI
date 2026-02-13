import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Shield, Database, Bell, Server, Key, Activity, RefreshCw, Lock, Palette, Webhook } from 'lucide-react';
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

type SettingsTab = 'ssl' | 'security' | 'branding' | 'telegram' | 'notifications' | 'backup' | 'system' | 'apikeys' | 'logs' | 'tools';

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
  'tools'
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
      { key: 'ssl', label: 'SSL Certificate', icon: Shield, superOnly: false },
      { key: 'security', label: 'Security', icon: Lock, superOnly: false },
      { key: 'branding', label: 'Branding', icon: Palette, superOnly: true },
      { key: 'telegram', label: t('settings.telegram'), icon: Bell, superOnly: false },
      { key: 'notifications', label: 'Notifications', icon: Webhook, superOnly: true },
      { key: 'backup', label: t('settings.backup'), icon: Database, superOnly: false },
      { key: 'system', label: t('settings.system'), icon: Server, superOnly: false },
      { key: 'apikeys', label: t('settings.apiKeys'), icon: Key, superOnly: false },
      { key: 'logs', label: t('logs.title'), icon: Activity, superOnly: false },
      { key: 'tools', label: 'Tools', icon: RefreshCw, superOnly: true }
    ] as const),
    [t]
  );
  const visibleTabs = tabs.filter((tab) => !tab.superOnly || isSuperAdmin);
  const firstVisibleTab = visibleTabs[0]?.key || 'ssl';

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('settings.title')}</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">Configure your panel settings</p>
      </div>

      <div className="flex space-x-2 border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors whitespace-nowrap ${activeTab === key
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
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
        </Suspense>
      </div>
    </div>
  );
};

export const SettingsPage = Settings;
