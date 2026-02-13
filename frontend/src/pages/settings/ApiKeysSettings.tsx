import React, { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

const ApiKeysSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeDialogKey, setRevokeDialogKey] = useState<ApiKey | null>(null);

  const { data: apiKeys, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const response = await apiClient.get('/api-keys');
      return response.data?.data as ApiKey[];
    }
  });

  const createKey = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiClient.post('/api-keys', { name });
      return response.data?.data as ApiKey;
    },
    onSuccess: (data) => {
      setCreatedKey(data.plainKey || null);
      setNewKeyName('');
      setIsCreating(false);
      toast.success('API key created', `Key "${data.name}" is ready to use.`);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error: any) => {
      toast.error('Create API key failed', error?.message || 'Failed to create API key');
    }
  });

  const revokeKey = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/api-keys/${id}`);
    },
    onSuccess: () => {
      toast.success('API key revoked', 'The selected key was revoked successfully.');
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error: any) => {
      toast.error('Revoke API key failed', error?.message || 'Failed to revoke API key');
    }
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard', 'API key copied to clipboard.');
    } catch {
      toast.error('Copy failed', 'Unable to copy to clipboard.');
    }
  };

  return (
    <div className="space-y-6">
      {createdKey && (
        <Card>
          <div className="flex items-start gap-4 rounded-lg bg-green-50 p-4 dark:bg-green-900/20 dark:border dark:border-green-900/50">
            <div className="flex-1">
              <h4 className="font-semibold text-green-800 dark:text-green-300">API Key Created!</h4>
              <p className="mt-1 text-sm text-green-700 dark:text-green-400">Copy this key now. It won't be shown again.</p>
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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">API Keys</h3>
          <Button onClick={() => setIsCreating(true)} disabled={isCreating}>
            <Plus className="mr-2 h-4 w-4" />
            Create Key
          </Button>
        </div>

        {isCreating && (
          <div className="mb-4 flex gap-2 rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
            <Input
              placeholder="Key name (e.g., 'automation')"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1"
            />
            <Button onClick={() => createKey.mutate(newKeyName)} loading={createKey.isPending} disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button variant="secondary" onClick={() => { setIsCreating(false); setNewKeyName(''); }}>
              Cancel
            </Button>
          </div>
        )}

        {isLoading ? (
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        ) : !apiKeys?.length ? (
          <p className="text-gray-500 dark:text-gray-400">No API keys created yet.</p>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div key={key.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{key.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt && ` • Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
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
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Usage</h3>
        <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Include your API key in the X-API-Key header:</p>
        <pre className="overflow-x-auto rounded-lg bg-gray-100 p-4 text-sm dark:bg-gray-800 dark:text-gray-200">
          {`curl -H "X-API-Key: oneui_your_key_here" \\
  https://your-domain.com/api/users`}
        </pre>
      </Card>

      <ConfirmDialog
        open={Boolean(revokeDialogKey)}
        title="Revoke API key?"
        description={revokeDialogKey ? `This will permanently revoke "${revokeDialogKey.name}". Clients using it will lose access immediately.` : undefined}
        confirmLabel="Revoke key"
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
