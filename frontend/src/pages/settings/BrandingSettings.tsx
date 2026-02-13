import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';

interface SubscriptionBranding {
  id: number;
  scope: 'GLOBAL' | 'GROUP' | 'USER';
  enabled: boolean;
  priority: number;
  name: string;
  appName?: string | null;
  supportUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  profileTitle?: string | null;
  profileDescription?: string | null;
  customFooter?: string | null;
  clashProfileName?: string | null;
  userId?: number | null;
  groupId?: number | null;
}

const BrandingSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'GLOBAL' | 'GROUP' | 'USER'>('GLOBAL');
  const [appName, setAppName] = useState('One-UI');
  const [profileTitle, setProfileTitle] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [clashProfileName, setClashProfileName] = useState('');
  const [supportUrl, setSupportUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [userId, setUserId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [priority, setPriority] = useState(100);

  const brandingQuery = useQuery({
    queryKey: ['subscription-branding'],
    queryFn: async () => {
      const response = await apiClient.get('/settings/subscription-branding');
      return (response.data?.brandings || []) as SubscriptionBranding[];
    }
  });

  const createBranding = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name,
        scope,
        appName,
        profileTitle,
        profileDescription,
        clashProfileName,
        supportUrl,
        primaryColor,
        accentColor,
        priority
      };

      if (scope === 'USER' && userId.trim()) {
        payload.userId = Number.parseInt(userId, 10);
      }
      if (scope === 'GROUP' && groupId.trim()) {
        payload.groupId = Number.parseInt(groupId, 10);
      }

      await apiClient.post('/settings/subscription-branding', payload);
    },
    onSuccess: async () => {
      setName('');
      setProfileTitle('');
      setProfileDescription('');
      setClashProfileName('');
      setSupportUrl('');
      setPrimaryColor('');
      setAccentColor('');
      setUserId('');
      setGroupId('');
      setPriority(100);
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success('Branding created', 'Subscription branding profile created successfully.');
    },
    onError: (error: any) => {
      toast.error('Create failed', error?.message || 'Failed to create branding');
    }
  });

  const toggleBranding = useMutation({
    mutationFn: async (branding: SubscriptionBranding) => {
      await apiClient.put(`/settings/subscription-branding/${branding.id}`, {
        enabled: !branding.enabled
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success('Branding updated', 'Branding status updated.');
    },
    onError: (error: any) => {
      toast.error('Update failed', error?.message || 'Failed to update branding status');
    }
  });

  const deleteBranding = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/settings/subscription-branding/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success('Branding deleted', 'Branding profile deleted.');
    },
    onError: (error: any) => {
      toast.error('Delete failed', error?.message || 'Failed to delete branding');
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Subscription Branding</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Customize subscription profile identity by scope (GLOBAL, GROUP, USER).
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Default branding" />
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Scope</label>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as 'GLOBAL' | 'GROUP' | 'USER')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="GLOBAL">GLOBAL</option>
              <option value="GROUP">GROUP</option>
              <option value="USER">USER</option>
            </select>
          </div>
          <Input label="App Name" value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="One-UI" />
          <Input label="Clash Profile Name" value={clashProfileName} onChange={(event) => setClashProfileName(event.target.value)} placeholder="One-UI" />
          <Input label="Profile Title" value={profileTitle} onChange={(event) => setProfileTitle(event.target.value)} placeholder="One-UI Subscription" />
          <Input label="Profile Description" value={profileDescription} onChange={(event) => setProfileDescription(event.target.value)} placeholder="Managed by One-UI" />
          <Input label="Support URL" value={supportUrl} onChange={(event) => setSupportUrl(event.target.value)} placeholder="https://your.domain/support" />
          <Input label="Priority" type="number" value={String(priority)} onChange={(event) => setPriority(Number.parseInt(event.target.value || '100', 10))} />
          <Input label="Primary Color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} placeholder="#3b82f6" />
          <Input label="Accent Color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} placeholder="#6366f1" />
          {scope === 'USER' ? (
            <Input label="User ID" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="1" />
          ) : null}
          {scope === 'GROUP' ? (
            <Input label="Group ID" value={groupId} onChange={(event) => setGroupId(event.target.value)} placeholder="1" />
          ) : null}
        </div>

        <div className="mt-4">
          <Button onClick={() => createBranding.mutate()} loading={createBranding.isPending} disabled={!name.trim()}>
            Create Branding
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Branding Profiles</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Scope</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">App Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Priority</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Enabled</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {(brandingQuery.data || []).map((branding) => (
                <tr key={branding.id}>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{branding.name}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                    {branding.scope}
                    {branding.scope === 'USER' && branding.userId ? ` #${branding.userId}` : ''}
                    {branding.scope === 'GROUP' && branding.groupId ? ` #${branding.groupId}` : ''}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{branding.appName || 'One-UI'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{branding.priority}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleBranding.mutate(branding)}
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        branding.enabled
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {branding.enabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => deleteBranding.mutate(branding.id)} className="text-red-600 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!brandingQuery.isLoading && (brandingQuery.data || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    No branding profile configured
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default BrandingSettings;
