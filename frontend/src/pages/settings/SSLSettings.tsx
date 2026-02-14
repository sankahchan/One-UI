import React from 'react';
import { Shield } from 'lucide-react';
import { useForm } from 'react-hook-form';
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

interface SSLInfo {
  enabled: boolean;
  domain?: string;
  notAfter?: string;
  daysRemaining?: number;
}

interface SSLIssueForm {
  domain: string;
  cloudflareEmail: string;
  cloudflareApiKey: string;
}

const SSLSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  const { data: sslInfo } = useQuery({
    queryKey: ['ssl-info'],
    queryFn: async () => (await apiClient.get('/ssl/info')) as ApiResponse<SSLInfo>
  });

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<SSLIssueForm>();

  const issueSSL = useMutation({
    mutationFn: async (data: SSLIssueForm) => {
      await apiClient.post('/ssl/issue', data);
    },
    onSuccess: () => {
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('sslSettings.toast.issued', { defaultValue: 'SSL certificate issued successfully.' })
      );
      void queryClient.invalidateQueries({ queryKey: ['ssl-info'] });
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('sslSettings.toast.issueFailed', { defaultValue: 'Failed to issue SSL certificate' })
      );
    }
  });

  const renewSSL = useMutation({
    mutationFn: async (domain: string) => {
      await apiClient.post('/ssl/renew', { domain });
    },
    onSuccess: () => {
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('sslSettings.toast.renewed', { defaultValue: 'SSL certificate renewed successfully.' })
      );
      void queryClient.invalidateQueries({ queryKey: ['ssl-info'] });
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('sslSettings.toast.renewFailed', { defaultValue: 'Failed to renew SSL certificate' })
      );
    }
  });

  const info = sslInfo?.data;

  return (
    <div className="space-y-6">
      {info?.enabled ? (
        <Card>
          <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            {t('sslSettings.current.title', { defaultValue: 'Current certificate' })}
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">{t('sslSettings.current.domain', { defaultValue: 'Domain' })}:</span>
              <span className="font-medium dark:text-gray-200">{info.domain || t('common.na', { defaultValue: 'N/A' })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">{t('sslSettings.current.validUntil', { defaultValue: 'Valid until' })}:</span>
              <span className="font-medium dark:text-gray-200">
                {info.notAfter ? new Date(info.notAfter).toLocaleDateString() : t('common.na', { defaultValue: 'N/A' })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">{t('sslSettings.current.daysRemaining', { defaultValue: 'Days remaining' })}:</span>
              <span className={`font-medium ${(info.daysRemaining || 0) < 30 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {typeof info.daysRemaining === 'number'
                  ? t('sslSettings.current.daysRemainingValue', { defaultValue: '{{count}} days', count: info.daysRemaining })
                  : t('common.na', { defaultValue: 'N/A' })}
              </span>
            </div>
          </div>
          <Button
            className="mt-4 w-full"
            variant="secondary"
            onClick={() => renewSSL.mutate(info.domain || '')}
            loading={renewSSL.isPending}
            disabled={!info.domain}
          >
            {t('sslSettings.current.renew', { defaultValue: 'Renew certificate' })}
          </Button>
        </Card>
      ) : null}

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {info?.enabled
            ? t('sslSettings.issue.title.enabled', { defaultValue: 'Issue new certificate' })
            : t('sslSettings.issue.title.disabled', { defaultValue: 'Issue SSL certificate' })}
        </h3>
        <form onSubmit={handleSubmit((data) => issueSSL.mutate(data))} className="space-y-4">
          <Input
            label={t('sslSettings.form.domainLabel', { defaultValue: 'Domain' })}
            {...register('domain', { required: t('sslSettings.form.domainRequired', { defaultValue: 'Domain is required' }) })}
            error={errors.domain?.message}
            placeholder={t('sslSettings.form.domainPlaceholder', { defaultValue: 'yourdomain.com' })}
          />

          <Input
            label={t('sslSettings.form.cloudflareEmailLabel', { defaultValue: 'Cloudflare email' })}
            type="email"
            {...register('cloudflareEmail', {
              required: t('sslSettings.form.cloudflareEmailRequired', { defaultValue: 'Cloudflare email is required' })
            })}
            error={errors.cloudflareEmail?.message}
            placeholder={t('sslSettings.form.cloudflareEmailPlaceholder', { defaultValue: 'your@email.com' })}
          />

          <Input
            label={t('sslSettings.form.cloudflareApiKeyLabel', { defaultValue: 'Cloudflare API key' })}
            type="password"
            {...register('cloudflareApiKey', {
              required: t('sslSettings.form.cloudflareApiKeyRequired', { defaultValue: 'API key is required' })
            })}
            error={errors.cloudflareApiKey?.message}
            placeholder={t('sslSettings.form.cloudflareApiKeyPlaceholder', { defaultValue: 'Your Cloudflare API key' })}
          />

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/20">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>{t('sslSettings.issue.noteTitle', { defaultValue: 'Note' })}:</strong>{' '}
              {t('sslSettings.issue.noteBody', {
                defaultValue:
                  'This will issue a wildcard certificate for *.yourdomain.com using Cloudflare DNS validation. Make sure your domain nameservers point to Cloudflare.'
              })}
            </p>
          </div>

          <Button type="submit" className="w-full" loading={issueSSL.isPending}>
            <Shield className="mr-2 h-4 w-4" />
            {t('sslSettings.issue.submit', { defaultValue: 'Issue certificate' })}
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default SSLSettings;
