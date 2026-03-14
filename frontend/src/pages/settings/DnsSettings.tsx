import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useDnsConfig, useUpdateDnsConfig } from '../../hooks/useXray';
import { useToast } from '../../hooks/useToast';
import type { DnsServer } from '../../api/xray';

const DnsSettings: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: config, isLoading } = useDnsConfig();
  const updateMutation = useUpdateDnsConfig();

  const [enabled, setEnabled] = useState(false);
  const [servers, setServers] = useState<DnsServer[]>([]);
  const [queryStrategy, setQueryStrategy] = useState<'UseIP' | 'UseIPv4' | 'UseIPv6'>('UseIP');
  const [clientIp, setClientIp] = useState('');
  const [disableCache, setDisableCache] = useState(false);
  const [disableFallback, setDisableFallback] = useState(false);

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setServers(config.servers || []);
      setQueryStrategy(config.queryStrategy || 'UseIP');
      setClientIp(config.clientIp || '');
      setDisableCache(config.disableCache || false);
      setDisableFallback(config.disableFallback || false);
    }
  }, [config]);

  const addServer = useCallback(() => {
    setServers((prev) => [...prev, { address: '', port: 53, domains: [], expectIPs: [] }]);
  }, []);

  const removeServer = useCallback((index: number) => {
    setServers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateServer = useCallback((index: number, field: keyof DnsServer, value: string | number | string[]) => {
    setServers((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await updateMutation.mutateAsync({
        enabled,
        servers: servers.filter((s) => s.address.trim()),
        queryStrategy,
        clientIp,
        disableCache,
        disableFallback,
        apply: true
      });
      toast.success(t('dns.saved', { defaultValue: 'DNS configuration saved' }));
    } catch (error: unknown) {
      toast.error((error as Error)?.message || 'Failed to save DNS config');
    }
  }, [enabled, servers, queryStrategy, clientIp, disableCache, disableFallback, updateMutation, toast, t]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-600 dark:border-t-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('dns.title', { defaultValue: 'DNS Configuration' })}
          </h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {enabled ? t('dns.enabled', { defaultValue: 'Enabled' }) : t('dns.disabled', { defaultValue: 'Disabled' })}
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="toggle-checkbox h-5 w-9 rounded-full bg-gray-300 transition checked:bg-blue-500 appearance-none relative cursor-pointer after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition checked:after:translate-x-4 dark:bg-gray-600"
            />
          </label>
        </div>

        {enabled && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('dns.servers', { defaultValue: 'DNS Servers' })}
                </h4>
                <Button size="sm" variant="ghost" onClick={addServer}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('dns.addServer', { defaultValue: 'Add Server' })}
                </Button>
              </div>
              {servers.map((server, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/50"
                >
                  <Input
                    placeholder={t('dns.addressPlaceholder', { defaultValue: 'Address (e.g. 8.8.8.8 or https://dns.google/dns-query)' })}
                    value={server.address}
                    onChange={(e) => updateServer(index, 'address', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder={t('dns.port', { defaultValue: 'Port' })}
                    type="number"
                    value={server.port}
                    onChange={(e) => updateServer(index, 'port', parseInt(e.target.value) || 53)}
                    className="w-20"
                  />
                  <button
                    type="button"
                    onClick={() => removeServer(index)}
                    className="p-1.5 text-gray-400 hover:text-rose-400 transition dark:text-gray-500 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {servers.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">
                  {t('dns.noServers', { defaultValue: 'No DNS servers configured. Click "Add Server" to add one.' })}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {t('dns.queryStrategy', { defaultValue: 'Query Strategy' })}
                </label>
                <select
                  value={queryStrategy}
                  onChange={(e) => setQueryStrategy(e.target.value as 'UseIP' | 'UseIPv4' | 'UseIPv6')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="UseIP">UseIP (Dual Stack)</option>
                  <option value="UseIPv4">UseIPv4</option>
                  <option value="UseIPv6">UseIPv6</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {t('dns.clientIp', { defaultValue: 'Client IP' })}
                </label>
                <Input
                  placeholder={t('dns.clientIpPlaceholder', { defaultValue: 'Optional (e.g. 1.2.3.4)' })}
                  value={clientIp}
                  onChange={(e) => setClientIp(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={disableCache}
                  onChange={(e) => setDisableCache(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                {t('dns.disableCache', { defaultValue: 'Disable Cache' })}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={disableFallback}
                  onChange={(e) => setDisableFallback(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                {t('dns.disableFallback', { defaultValue: 'Disable Fallback' })}
              </label>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            <Save className="h-4 w-4 mr-1.5" />
            {updateMutation.isPending
              ? t('dns.saving', { defaultValue: 'Saving...' })
              : t('dns.save', { defaultValue: 'Save DNS Config' })}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default DnsSettings;
