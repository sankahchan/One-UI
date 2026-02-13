import React from 'react';
import { Shield } from 'lucide-react';
import { useForm } from 'react-hook-form';
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
      toast.success('Certificate issued', 'SSL certificate issued successfully.');
      void queryClient.invalidateQueries({ queryKey: ['ssl-info'] });
    },
    onError: (error: any) => {
      toast.error('Issue failed', error?.message || 'Failed to issue SSL certificate');
    }
  });

  const renewSSL = useMutation({
    mutationFn: async (domain: string) => {
      await apiClient.post('/ssl/renew', { domain });
    },
    onSuccess: () => {
      toast.success('Certificate renewed', 'SSL certificate renewed successfully.');
      void queryClient.invalidateQueries({ queryKey: ['ssl-info'] });
    },
    onError: (error: any) => {
      toast.error('Renew failed', error?.message || 'Failed to renew SSL certificate');
    }
  });

  const info = sslInfo?.data;

  return (
    <div className="space-y-6">
      {info?.enabled ? (
        <Card>
          <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Current Certificate</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Domain:</span>
              <span className="font-medium dark:text-gray-200">{info.domain || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Valid Until:</span>
              <span className="font-medium dark:text-gray-200">{info.notAfter ? new Date(info.notAfter).toLocaleDateString() : 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Days Remaining:</span>
              <span className={`font-medium ${(info.daysRemaining || 0) < 30 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {info.daysRemaining ?? 'N/A'} days
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
            Renew Certificate
          </Button>
        </Card>
      ) : null}

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {info?.enabled ? 'Issue New Certificate' : 'Issue SSL Certificate'}
        </h3>
        <form onSubmit={handleSubmit((data) => issueSSL.mutate(data))} className="space-y-4">
          <Input
            label="Domain *"
            {...register('domain', { required: 'Domain is required' })}
            error={errors.domain?.message}
            placeholder="yourdomain.com"
          />

          <Input
            label="Cloudflare Email *"
            type="email"
            {...register('cloudflareEmail', { required: 'Cloudflare email is required' })}
            error={errors.cloudflareEmail?.message}
            placeholder="your@email.com"
          />

          <Input
            label="Cloudflare Global API Key *"
            type="password"
            {...register('cloudflareApiKey', { required: 'API key is required' })}
            error={errors.cloudflareApiKey?.message}
            placeholder="Your Cloudflare Global API Key"
          />

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/20">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Note:</strong> This will issue a wildcard certificate for *.yourdomain.com using Cloudflare DNS
              validation. Make sure your domain nameservers point to Cloudflare.
            </p>
          </div>

          <Button type="submit" className="w-full" loading={issueSSL.isPending}>
            <Shield className="mr-2 h-4 w-4" />
            Issue Certificate
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default SSLSettings;
