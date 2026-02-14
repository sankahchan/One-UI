import React, { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { ConfirmDialog } from '../../components/organisms/ConfirmDialog';
import { useToast } from '../../hooks/useToast';

interface ApiKey {
  id: number;
  name: string;
  permissions: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
  plainKey?: string;
  admin?: { username: string };
}

const AVAILABLE_SCOPES: Array<{ id: string; label: string; description: string }> = [
  { id: 'users:read', label: 'Users: Read', description: 'List users, stats, sessions, devices.' },
  { id: 'users:write', label: 'Users: Write', description: 'Create/update users, rotate/revoke keys, reorder access keys.' },
  { id: 'inbounds:read', label: 'Inbounds: Read', description: 'List inbound profiles and templates.' },
  { id: 'inbounds:write', label: 'Inbounds: Write', description: 'Create/update/delete inbounds and apply presets.' },
  { id: 'groups:read', label: 'Groups: Read', description: 'List groups and policies.' },
  { id: 'groups:write', label: 'Groups: Write', description: 'Create/update groups and membership.' },
  { id: 'system:read', label: 'System: Read', description: 'Read system stats, health, and versions.' },
  { id: 'logs:read', label: 'Logs: Read', description: 'Read system/connection logs.' },
  { id: 'search:read', label: 'Search: Read', description: 'Use global search endpoints.' }
];

const ApiKeysSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeDialogKey, setRevokeDialogKey] = useState<ApiKey | null>(null);
  const [scopeMode, setScopeMode] = useState<'full' | 'custom'>('custom');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['users:read', 'inbounds:read', 'groups:read', 'system:read']);

  const { data: apiKeys, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const response = await apiClient.get('/api-keys');
      return response.data?.data as ApiKey[];
    }
  });

  const createKey = useMutation({
    mutationFn: async (payload: { name: string; permissions: string[] }) => {
      const response = await apiClient.post('/api-keys', payload);
      return response.data?.data as ApiKey;
    },
    onSuccess: (data) => {
      setCreatedKey(data.plainKey || null);
      setNewKeyName('');
      setIsCreating(false);
      toast.success(t('apiKeys.createdTitle', { defaultValue: 'API key created' }), t('apiKeys.createdBody', { defaultValue: `Key "${data.name}" is ready to use.` }));
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error: any) => {
      toast.error(t('apiKeys.createFailedTitle', { defaultValue: 'Create API key failed' }), error?.message || t('apiKeys.createFailedBody', { defaultValue: 'Failed to create API key' }));
    }
  });

  const revokeKey = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/api-keys/${id}`);
    },
    onSuccess: () => {
      toast.success(t('apiKeys.revokedTitle', { defaultValue: 'API key revoked' }), t('apiKeys.revokedBody', { defaultValue: 'The selected key was revoked successfully.' }));
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error: any) => {
      toast.error(t('apiKeys.revokeFailedTitle', { defaultValue: 'Revoke API key failed' }), error?.message || t('apiKeys.revokeFailedBody', { defaultValue: 'Failed to revoke API key' }));
    }
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('common.copied', { defaultValue: 'Copied' }), t('apiKeys.copiedBody', { defaultValue: 'API key copied to clipboard.' }));
    } catch {
      toast.error(t('common.error', { defaultValue: 'Error' }), t('apiKeys.copyFailedBody', { defaultValue: 'Unable to copy to clipboard.' }));
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return Array.from(next);
    });
  };

  const effectiveScopes = scopeMode === 'custom' ? selectedScopes : [];
  const canCreate = newKeyName.trim().length > 0 && (scopeMode === 'full' || effectiveScopes.length > 0);

  return (
    <div className="space-y-6">
      {createdKey && (
        <Card>
          <div className="flex items-start gap-4 rounded-lg bg-green-50 p-4 dark:bg-green-900/20 dark:border dark:border-green-900/50">
            <div className="flex-1">
              <h4 className="font-semibold text-green-800 dark:text-green-300">{t('apiKeys.keyCreatedTitle', { defaultValue: 'API Key Created!' })}</h4>
              <p className="mt-1 text-sm text-green-700 dark:text-green-400">{t('apiKeys.keyCreatedBody', { defaultValue: "Copy this key now. It won't be shown again." })}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-200">{createdKey}</code>
                <Button variant="secondary" onClick={() => { void copyToClipboard(createdKey); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <button onClick={() => setCreatedKey(null)} className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300">×</button>
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('apiKeys.title', { defaultValue: 'API Keys' })}</h3>
          <Button onClick={() => setIsCreating(true)} disabled={isCreating}>
            <Plus className="mr-2 h-4 w-4" />
            {t('apiKeys.create', { defaultValue: 'Create Key' })}
          </Button>
        </div>

        {isCreating && (
          <div className="mb-4 flex gap-2 rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
            <Input
              placeholder={t('apiKeys.namePlaceholder', { defaultValue: "Key name (e.g., 'automation')" })}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={() => createKey.mutate({ name: newKeyName, permissions: effectiveScopes })}
              loading={createKey.isPending}
              disabled={!canCreate}
            >
              {t('common.create', { defaultValue: 'Create' })}
            </Button>
            <Button variant="secondary" onClick={() => { setIsCreating(false); setNewKeyName(''); }}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        )}

        {isCreating ? (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/20">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('apiKeys.scopesTitle', { defaultValue: 'Scopes' })}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('apiKeys.scopesHint', { defaultValue: 'Limit what this key can access. For full access, choose Full.' })}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setScopeMode('custom')}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  scopeMode === 'custom' ? 'bg-brand-500 text-white shadow-soft' : 'border border-line/70 bg-card/70 text-muted hover:text-foreground'
                }`}
              >
                {t('apiKeys.scopesCustom', { defaultValue: 'Custom' })}
              </button>
              <button
                type="button"
                onClick={() => setScopeMode('full')}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  scopeMode === 'full' ? 'bg-brand-500 text-white shadow-soft' : 'border border-line/70 bg-card/70 text-muted hover:text-foreground'
                }`}
              >
                {t('apiKeys.scopesFull', { defaultValue: 'Full' })}
              </button>
            </div>

            {scopeMode === 'custom' ? (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {AVAILABLE_SCOPES.map((scope) => (
                  <label key={scope.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope.id)}
                      onChange={() => toggleScope(scope.id)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-gray-900 dark:text-white">{scope.label}</span>
                      <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">{scope.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                {t('apiKeys.scopesFullHint', { defaultValue: 'Full access keys can call any permitted API routes. Avoid sharing widely.' })}
              </p>
            )}
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-gray-500 dark:text-gray-400">{t('common.loading', { defaultValue: 'Loading...' })}</p>
        ) : !apiKeys?.length ? (
          <p className="text-gray-500 dark:text-gray-400">{t('apiKeys.none', { defaultValue: 'No API keys created yet.' })}</p>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div key={key.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{key.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('apiKeys.createdAt', { defaultValue: 'Created' })} {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt && ` • Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {Array.isArray(key.permissions) && key.permissions.length > 0
                      ? `${t('apiKeys.scopes', { defaultValue: 'Scopes' })}: ${key.permissions.join(', ')}`
                      : t('apiKeys.scopesFull', { defaultValue: 'Full' })}
                  </p>
                </div>
                <Button
                  variant="danger"
                  onClick={() => {
                    setRevokeDialogKey(key);
                  }}
                  loading={revokeKey.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{t('apiKeys.usageTitle', { defaultValue: 'Usage' })}</h3>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">{t('apiKeys.usageBody', { defaultValue: 'Include your API key in the X-API-Key header:' })}</p>
        <pre className="overflow-x-auto rounded-lg bg-gray-100 p-4 text-sm dark:bg-gray-800 dark:text-gray-200">
          {`curl -H "X-API-Key: oneui_your_key_here" \\
  https://your-domain.com/api/users`}
        </pre>
      </Card>

      <ConfirmDialog
        open={Boolean(revokeDialogKey)}
        title={t('apiKeys.revokeTitle', { defaultValue: 'Revoke API key?' })}
        description={revokeDialogKey ? `This will permanently revoke "${revokeDialogKey.name}". Clients using it will lose access immediately.` : undefined}
        confirmLabel={t('apiKeys.revokeConfirm', { defaultValue: 'Revoke key' })}
        tone="danger"
        loading={revokeKey.isPending}
        onCancel={() => {
          if (!revokeKey.isPending) {
            setRevokeDialogKey(null);
          }
        }}
        onConfirm={() => {
          if (!revokeDialogKey) {
            return;
          }
          revokeKey.mutate(revokeDialogKey.id, {
            onSettled: () => {
              setRevokeDialogKey(null);
            }
          });
        }}
      />
    </div>
  );
};

export default ApiKeysSettings;
