import React, { useState } from 'react';
import { RefreshCw, Copy } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';

const ToolsSettings: React.FC = () => {
  const toast = useToast();
  const { t } = useTranslation();
  const [results, setResults] = useState<any[]>([]);
  const [dnsForm, setDnsForm] = useState({
    domain: '',
    type: 'A',
    content: '',
    proxied: true
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post('/settings/cdn-scan', {});
      return data.data;
    },
    onSuccess: (data) => {
      setResults(data);
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error.response?.data?.message || error.message || t('toolsSettings.toast.scanFailed', { defaultValue: 'Scan failed' })
      );
    }
  });

  const dnsMutation = useMutation({
    mutationFn: async (data: typeof dnsForm) => {
      const { data: res } = await apiClient.post('/settings/cloudflare/dns', data);
      return res;
    },
    onSuccess: () => {
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('toolsSettings.toast.dnsUpdated', { defaultValue: 'DNS record updated successfully.' })
      );
      setDnsForm({ ...dnsForm, domain: '', content: '' });
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error.response?.data?.message || error.message || t('toolsSettings.toast.dnsUpdateFailed', { defaultValue: 'DNS update failed' })
      );
    }
  });

  return (
    <Card>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            {t('toolsSettings.title', { defaultValue: 'Tools & utilities' })}
          </h3>
        </div>
        {/* Cloudflare DNS Manager */}
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <h4 className="text-base font-medium text-gray-900 dark:text-white">
            {t('toolsSettings.dns.title', { defaultValue: 'Cloudflare DNS record manager' })}
          </h4>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('toolsSettings.dns.subtitle', { defaultValue: 'Quickly add or update DNS records in your Cloudflare account.' })}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label={t('toolsSettings.dns.domainLabel', { defaultValue: 'Domain' })}
              value={dnsForm.domain}
              onChange={(e) => setDnsForm({ ...dnsForm, domain: e.target.value })}
              placeholder={t('toolsSettings.dns.domainPlaceholder', { defaultValue: 'sub.example.com' })}
            />
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('toolsSettings.dns.typeLabel', { defaultValue: 'Type' })}
              </label>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                value={dnsForm.type}
                onChange={(e) => setDnsForm({ ...dnsForm, type: e.target.value })}
              >
                <option value="A">A</option>
                <option value="AAAA">AAAA</option>
                <option value="CNAME">CNAME</option>
              </select>
            </div>
            <Input
              label={t('toolsSettings.dns.contentLabel', { defaultValue: 'Content' })}
              value={dnsForm.content}
              onChange={(e) => setDnsForm({ ...dnsForm, content: e.target.value })}
              placeholder={t('toolsSettings.dns.contentPlaceholder', { defaultValue: '1.2.3.4' })}
            />
            <div className="flex items-center pt-8">
              <input
                type="checkbox"
                id="proxied"
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:focus:ring-blue-400"
                checked={dnsForm.proxied}
                onChange={(e) => setDnsForm({ ...dnsForm, proxied: e.target.checked })}
              />
              <label htmlFor="proxied" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">
                {t('toolsSettings.dns.proxiedLabel', { defaultValue: 'Proxied' })}
              </label>
            </div>
          </div>
          <div className="mt-4">
            <Button
              onClick={() => dnsMutation.mutate(dnsForm)}
              loading={dnsMutation.isPending}
              disabled={!dnsForm.domain || !dnsForm.content}
            >
              {t('toolsSettings.dns.updateButton', { defaultValue: 'Update record' })}
            </Button>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            {t('toolsSettings.cdnScan.title', { defaultValue: 'Cloudflare CDN IP scanner' })}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('toolsSettings.cdnScan.subtitle', {
              defaultValue: 'Scan for the best performing Cloudflare IPs for your location. This helps optimize speed and latency.'
            })}
          </p>

          <div className="mt-4">
            <Button
              onClick={() => mutation.mutate()}
              loading={mutation.isPending}
              icon={<RefreshCw className={`h-4 w-4 ${mutation.isPending ? 'animate-spin' : ''}`} />}
            >
              {t('toolsSettings.cdnScan.startButton', { defaultValue: 'Start scan' })}
            </Button>
          </div>

          {results.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      {t('toolsSettings.cdnScan.table.ip', { defaultValue: 'IP address' })}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      {t('toolsSettings.cdnScan.table.latency', { defaultValue: 'Latency' })}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      {t('common.action', { defaultValue: 'Action' })}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                  {results.slice(0, 10).map((res: any, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{res.ip}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${res.latency < 100 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                          res.latency < 200 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                            'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                          }`}>
                          {res.latency} ms
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(res.ip);
                            toast.success(
                              t('common.success', { defaultValue: 'Success' }),
                              t('toolsSettings.toast.ipCopied', { defaultValue: 'IP copied to clipboard.' })
                            );
                          }}
                          className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default ToolsSettings;
