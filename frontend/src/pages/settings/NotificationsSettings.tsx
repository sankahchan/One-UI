import React, { useEffect, useState } from 'react';
import { Bell, RefreshCw, Save } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
          throw new Error('Routes JSON must be an object');
        }
        parsedRoutes = parsed as Record<string, NotificationChannelRoute>;
      } catch (error: any) {
        throw new Error(error?.message || 'Invalid routes JSON');
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
      toast.success('Settings saved', 'Notification settings saved.');
    },
    onError: (error: any) => {
      setJsonError(error?.message || 'Failed to save notification settings');
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
          throw new Error('Test data must be a JSON object');
        }
      } catch (error: any) {
        throw new Error(error?.message || 'Invalid test payload JSON');
      }

      return (await apiClient.post('/settings/notifications/test', {
        channel: testChannel,
        event: testEvent,
        data: parsedData
      })) as ApiResponse<{ eventId?: string }>;
    },
    onSuccess: (response) => {
      toast.success('Test sent', response.message || 'Notification test sent.');
    },
    onError: (error: any) => {
      toast.error('Test failed', error?.message || 'Failed to dispatch test notification');
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
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Notification Channels</h3>
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading notification settings...</p>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  <div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">Last updated:</span>{' '}
                    {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : 'N/A'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Created: {settings?.createdAt ? new Date(settings.createdAt).toLocaleString() : 'N/A'}
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
                  Refresh
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
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">Enable webhook delivery</span>
            </label>

            <Input
              label="Webhook URL"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://your-notify-service.example/webhook"
            />

            <Input
              label={settings?.webhookSecretConfigured ? 'Webhook Secret (leave blank to keep existing)' : 'Webhook Secret'}
              type="password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              placeholder="Enter webhook signing secret"
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                label="Timeout (ms)"
                type="number"
                min={1000}
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
              <Input
                label="Retry Attempts"
                type="number"
                min={1}
                value={retryAttempts}
                onChange={(event) => setRetryAttempts(event.target.value)}
              />
              <Input
                label="Retry Delay (ms)"
                type="number"
                min={100}
                value={retryDelayMs}
                onChange={(event) => setRetryDelayMs(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200">Default Route</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  <input
                    type="checkbox"
                    checked={defaultRoute.webhook}
                    onChange={(event) => updateDefaultRoute('webhook', event.target.checked)}
                  />
                  <span className="text-gray-700 dark:text-gray-300">Webhook</span>
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  <input
                    type="checkbox"
                    checked={defaultRoute.telegram}
                    onChange={(event) => updateDefaultRoute('telegram', event.target.checked)}
                  />
                  <span className="text-gray-700 dark:text-gray-300">Telegram</span>
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  <input
                    type="checkbox"
                    checked={defaultRoute.systemLog}
                    onChange={(event) => updateDefaultRoute('systemLog', event.target.checked)}
                  />
                  <span className="text-gray-700 dark:text-gray-300">System Log</span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-200">Route Matrix (JSON)</label>
              <textarea
                className="min-h-[220px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                value={routesJson}
                onChange={(event) => setRoutesJson(event.target.value)}
                placeholder='{"user.*":{"webhook":true,"telegram":false,"systemLog":true}}'
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Use event names (e.g. <code>auth.login.success</code>) or wildcard prefixes (e.g. <code>user.*</code>).
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
              Save Notification Settings
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Send Test Notification</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Channel</label>
              <select
                value={testChannel}
                onChange={(event) => setTestChannel(event.target.value as typeof testChannel)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                <option value="all">All channels</option>
                <option value="webhook">Webhook only</option>
                <option value="telegram">Telegram only</option>
                <option value="systemLog">System log only</option>
              </select>
            </div>
            <Input
              label="Event Name"
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
                Dispatch Test
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Test Payload (JSON)</label>
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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Notification Audit History</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['notification-settings-audit'] })}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Audit
          </Button>
        </div>

        {auditQuery.isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading audit history...</p>
        ) : !auditPayload?.items?.length ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No audit records yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Time</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Admin</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">IP</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Action</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Changed Keys</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {auditPayload.items.map((item) => (
                    <tr key={item.id} className="bg-white dark:bg-gray-900">
                      <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                        {item.adminUsername || 'system'}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                        {item.requestIp || 'N/A'}
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
                Previous
              </Button>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Page {auditPayload.pagination.page} of {auditPayload.pagination.totalPages} ({auditPayload.pagination.total} total)
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={(auditPayload.pagination.page || 1) >= (auditPayload.pagination.totalPages || 1)}
                onClick={() => setAuditPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default NotificationsSettings;
