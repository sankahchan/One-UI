import React, { useEffect, useState } from 'react';
import { Bell, RefreshCw, Save } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

interface NotificationChannelRoute {
  webhook: boolean;
  telegram: boolean;
  systemLog: boolean;
}

interface NotificationRouteMatrix {
  default: NotificationChannelRoute;
  routes: Record<string, NotificationChannelRoute>;
}

interface NotificationConfig {
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookSecretConfigured: boolean;
  timeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  routeMatrix: NotificationRouteMatrix;
  createdAt?: string;
  updatedAt?: string;
}

interface NotificationAuditRecord {
  id: number;
  adminId?: number | null;
  adminUsername?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
  action: string;
  changedKeys: string[];
  createdAt: string;
}

interface NotificationAuditPayload {
  items: NotificationAuditRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const NotificationsSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('10000');
  const [retryAttempts, setRetryAttempts] = useState('3');
  const [retryDelayMs, setRetryDelayMs] = useState('1000');
  const [defaultRoute, setDefaultRoute] = useState<NotificationChannelRoute>({
    webhook: true,
    telegram: false,
    systemLog: true
  });
  const [routesJson, setRoutesJson] = useState('{}');
  const [jsonError, setJsonError] = useState('');
  const [testChannel, setTestChannel] = useState<'all' | 'webhook' | 'telegram' | 'systemLog'>('all');
  const [testEvent, setTestEvent] = useState('system.notification.test');
  const [testDataJson, setTestDataJson] = useState('{"source":"settings-ui"}');
  const [auditPage, setAuditPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => (await apiClient.get('/settings/notifications')) as ApiResponse<NotificationConfig>
  });

  const auditQuery = useQuery({
    queryKey: ['notification-settings-audit', auditPage],
    queryFn: async () => (
      await apiClient.get('/settings/notifications/audit', {
        params: {
          page: auditPage,
          limit: 10
        }
      })
    ) as ApiResponse<NotificationAuditPayload>,
    staleTime: 30_000
  });

  const settings = data?.data;
  const auditPayload = auditQuery.data?.data;

  useEffect(() => {
    if (!settings) {
      return;
    }

    setWebhookEnabled(Boolean(settings.webhookEnabled));
    setWebhookUrl(settings.webhookUrl || '');
    setTimeoutMs(String(settings.timeoutMs || 10000));
    setRetryAttempts(String(settings.retryAttempts || 3));
    setRetryDelayMs(String(settings.retryDelayMs || 1000));
    setDefaultRoute(settings.routeMatrix?.default || { webhook: true, telegram: false, systemLog: true });
    setRoutesJson(JSON.stringify(settings.routeMatrix?.routes || {}, null, 2));
    setWebhookSecret('');
    setJsonError('');
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let parsedRoutes: Record<string, NotificationChannelRoute>;
      try {
        const parsed = JSON.parse(routesJson || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(
            t('notificationsSettings.errors.routesMustBeObject', { defaultValue: 'Routes JSON must be an object' })
          );
        }
        parsedRoutes = parsed as Record<string, NotificationChannelRoute>;
      } catch (error: any) {
        throw new Error(
          error?.message
          || t('notificationsSettings.errors.invalidRoutesJson', { defaultValue: 'Invalid routes JSON' })
        );
      }

      const payload: Record<string, unknown> = {
        webhookEnabled,
        webhookUrl,
        timeoutMs: Number.parseInt(timeoutMs, 10) || 10000,
        retryAttempts: Number.parseInt(retryAttempts, 10) || 3,
        retryDelayMs: Number.parseInt(retryDelayMs, 10) || 1000,
        defaultRoute,
        routes: parsedRoutes
      };

      if (webhookSecret.trim()) {
        payload.webhookSecret = webhookSecret.trim();
      }

      return (await apiClient.put('/settings/notifications', payload)) as ApiResponse<NotificationConfig>;
    },
    onSuccess: async () => {
      setJsonError('');
      setAuditPage(1);
      await queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['notification-settings-audit'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('notificationsSettings.toast.saved', { defaultValue: 'Notification settings saved.' })
      );
    },
    onError: (error: any) => {
      setJsonError(
        error?.message
        || t('notificationsSettings.errors.saveFailed', { defaultValue: 'Failed to save notification settings' })
      );
    }
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      let parsedData: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(testDataJson || '{}');
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          parsedData = raw as Record<string, unknown>;
        } else {
          throw new Error(
            t('notificationsSettings.errors.testDataMustBeObject', { defaultValue: 'Test data must be a JSON object' })
          );
        }
      } catch (error: any) {
        throw new Error(
          error?.message
          || t('notificationsSettings.errors.invalidTestPayload', { defaultValue: 'Invalid test payload JSON' })
        );
      }

      return (await apiClient.post('/settings/notifications/test', {
        channel: testChannel,
        event: testEvent,
        data: parsedData
      })) as ApiResponse<{ eventId?: string }>;
    },
    onSuccess: (response) => {
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        response.message || t('notificationsSettings.toast.testSent', { defaultValue: 'Notification test sent.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('notificationsSettings.toast.testFailed', { defaultValue: 'Failed to dispatch test notification' })
      );
    }
  });

  const updateDefaultRoute = (field: keyof NotificationChannelRoute, checked: boolean) => {
    setDefaultRoute((current) => ({
      ...current,
      [field]: checked
    }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {t('notificationsSettings.channels.title', { defaultValue: 'Notification channels' })}
        </h3>
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('notificationsSettings.channels.loading', { defaultValue: 'Loading notification settings...' })}
          </p>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  <div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {t('notificationsSettings.channels.lastUpdated', { defaultValue: 'Last updated' })}:
                    </span>{' '}
                    {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t('common.na', { defaultValue: 'N/A' })}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('notificationsSettings.channels.created', { defaultValue: 'Created' })}:{' '}
                    {settings?.createdAt ? new Date(settings.createdAt).toLocaleString() : t('common.na', { defaultValue: 'N/A' })}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
                    void queryClient.invalidateQueries({ queryKey: ['notification-settings-audit'] });
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('common.refresh', { defaultValue: 'Refresh' })}
                </Button>
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={webhookEnabled}
                onChange={(event) => setWebhookEnabled(event.target.checked)}
              />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {t('notificationsSettings.channels.enableWebhook', { defaultValue: 'Enable webhook delivery' })}
              </span>
            </label>

            <Input
              label={t('notificationsSettings.channels.webhookUrlLabel', { defaultValue: 'Webhook URL' })}
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder={t('notificationsSettings.channels.webhookUrlPlaceholder', {
                defaultValue: 'https://your-notify-service.example/webhook'
              })}
            />

            <Input
              label={settings?.webhookSecretConfigured
                ? t('notificationsSettings.channels.webhookSecretKeepLabel', {
                    defaultValue: 'Webhook secret (leave blank to keep existing)'
                  })
                : t('notificationsSettings.channels.webhookSecretLabel', { defaultValue: 'Webhook secret' })}
              type="password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              placeholder={t('notificationsSettings.channels.webhookSecretPlaceholder', {
                defaultValue: 'Enter webhook signing secret'
              })}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                label={t('notificationsSettings.channels.timeoutLabel', { defaultValue: 'Timeout (ms)' })}
                type="number"
                min={1000}
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
              <Input
                label={t('notificationsSettings.channels.retryAttemptsLabel', { defaultValue: 'Retry attempts' })}
                type="number"
                min={1}
                value={retryAttempts}
                onChange={(event) => setRetryAttempts(event.target.value)}
              />
              <Input
                label={t('notificationsSettings.channels.retryDelayLabel', { defaultValue: 'Retry delay (ms)' })}
                type="number"
                min={100}
                value={retryDelayMs}
                onChange={(event) => setRetryDelayMs(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200">
                {t('notificationsSettings.channels.defaultRouteTitle', { defaultValue: 'Default route' })}
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  <input
                    type="checkbox"
                    checked={defaultRoute.webhook}
                    onChange={(event) => updateDefaultRoute('webhook', event.target.checked)}
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    {t('notificationsSettings.channels.route.webhook', { defaultValue: 'Webhook' })}
                  </span>
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  <input
                    type="checkbox"
                    checked={defaultRoute.telegram}
                    onChange={(event) => updateDefaultRoute('telegram', event.target.checked)}
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    {t('notificationsSettings.channels.route.telegram', { defaultValue: 'Telegram' })}
                  </span>
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  <input
                    type="checkbox"
                    checked={defaultRoute.systemLog}
                    onChange={(event) => updateDefaultRoute('systemLog', event.target.checked)}
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    {t('notificationsSettings.channels.route.systemLog', { defaultValue: 'System log' })}
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-200">
                {t('notificationsSettings.channels.routeMatrixLabel', { defaultValue: 'Route matrix (JSON)' })}
              </label>
              <textarea
                className="min-h-[220px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                value={routesJson}
                onChange={(event) => setRoutesJson(event.target.value)}
                placeholder='{"user.*":{"webhook":true,"telegram":false,"systemLog":true}}'
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('notificationsSettings.channels.routeMatrixHelp', {
                  defaultValue: 'Use event names (e.g. auth.login.success) or wildcard prefixes (e.g. user.*).'
                })}
              </p>
            </div>

            {jsonError ? (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
                {jsonError}
              </div>
            ) : null}

            <Button
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              className="w-full sm:w-auto"
            >
              <Save className="mr-2 h-4 w-4" />
              {t('notificationsSettings.channels.saveButton', { defaultValue: 'Save notification settings' })}
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {t('notificationsSettings.test.title', { defaultValue: 'Send test notification' })}
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('notificationsSettings.test.channelLabel', { defaultValue: 'Channel' })}
              </label>
              <select
                value={testChannel}
                onChange={(event) => setTestChannel(event.target.value as typeof testChannel)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                <option value="all">{t('notificationsSettings.test.channelAll', { defaultValue: 'All channels' })}</option>
                <option value="webhook">{t('notificationsSettings.test.channelWebhook', { defaultValue: 'Webhook only' })}</option>
                <option value="telegram">{t('notificationsSettings.test.channelTelegram', { defaultValue: 'Telegram only' })}</option>
                <option value="systemLog">{t('notificationsSettings.test.channelSystemLog', { defaultValue: 'System log only' })}</option>
              </select>
            </div>
            <Input
              label={t('notificationsSettings.test.eventLabel', { defaultValue: 'Event name' })}
              value={testEvent}
              onChange={(event) => setTestEvent(event.target.value)}
              placeholder="system.notification.test"
            />
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => testMutation.mutate()}
                loading={testMutation.isPending}
              >
                <Bell className="mr-2 h-4 w-4" />
                {t('notificationsSettings.test.dispatchButton', { defaultValue: 'Dispatch test' })}
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('notificationsSettings.test.payloadLabel', { defaultValue: 'Test payload (JSON)' })}
            </label>
            <textarea
              value={testDataJson}
              onChange={(event) => setTestDataJson(event.target.value)}
              className="min-h-[120px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('notificationsSettings.audit.title', { defaultValue: 'Notification audit history' })}
          </h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['notification-settings-audit'] })}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('notificationsSettings.audit.refreshButton', { defaultValue: 'Refresh audit' })}
          </Button>
        </div>

        {auditQuery.isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('notificationsSettings.audit.loading', { defaultValue: 'Loading audit history...' })}
          </p>
        ) : !auditPayload?.items?.length ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('notificationsSettings.audit.empty', { defaultValue: 'No audit records yet.' })}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {t('notificationsSettings.audit.table.time', { defaultValue: 'Time' })}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {t('notificationsSettings.audit.table.admin', { defaultValue: 'Admin' })}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {t('notificationsSettings.audit.table.ip', { defaultValue: 'IP' })}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {t('common.action', { defaultValue: 'Action' })}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {t('notificationsSettings.audit.table.changedKeys', { defaultValue: 'Changed keys' })}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {auditPayload.items.map((item) => (
                    <tr key={item.id} className="bg-white dark:bg-gray-900">
                      <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                        {item.adminUsername || t('common.system', { defaultValue: 'system' })}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                        {item.requestIp || t('common.na', { defaultValue: 'N/A' })}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                        {item.action}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                        {item.changedKeys?.length ? item.changedKeys.join(', ') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                size="sm"
                disabled={(auditPayload.pagination.page || 1) <= 1}
                onClick={() => setAuditPage((current) => Math.max(1, current - 1))}
              >
                {t('common.previous', { defaultValue: 'Previous' })}
              </Button>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('notificationsSettings.audit.pageLine', {
                  defaultValue: 'Page {{page}} of {{pages}} ({{total}} total)',
                  page: auditPayload.pagination.page,
                  pages: auditPayload.pagination.totalPages,
                  total: auditPayload.pagination.total
                })}
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={(auditPayload.pagination.page || 1) >= (auditPayload.pagination.totalPages || 1)}
                onClick={() => setAuditPage((current) => current + 1)}
              >
                {t('common.next', { defaultValue: 'Next' })}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default NotificationsSettings;
