import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Link,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { getPublicIp } from '../api/system';
import type { MieruQuota, MieruUserEntry } from '../api/mieru';
import { Badge } from '../components/atoms/Badge';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { Input } from '../components/atoms/Input';
import {
  useCreateMieruUser,
  useDeleteMieruUser,
  useMieruLogs,
  useMieruOnlineSnapshot,
  useMieruPolicy,
  useMieruProfile,
  useMieruStatus,
  useMieruUserExport,
  useMieruUserSubscriptionUrl,
  useMieruUsers,
  useRestartMieru,
  useSyncMieruUsers,
  useUpdateMieruProfile,
  useUpdateMieruUser
} from '../hooks/useMieru';
import { useResetTraffic, useUpdateUser } from '../hooks/useUsers';
import { toMieruPageUrl } from '../lib/mieruSubscription';
import { useToast } from '../hooks/useToast';
import { copyTextToClipboard } from '../utils/clipboard';

type ProfileForm = {
  server: string;
  portRange: string;
  transport: 'TCP' | 'UDP';
  udp: boolean;
  multiplexing: string;
};

const DEFAULT_PROFILE: ProfileForm = {
  server: '',
  portRange: '8444-8444',
  transport: 'TCP',
  udp: false,
  multiplexing: 'MULTIPLEXING_HIGH'
};

type UserForm = {
  username: string;
  password: string;
  enabled: boolean;
  quotaDays: string;
  quotaMegabytes: string;
};

const DEFAULT_USER_FORM: UserForm = {
  username: '',
  password: '',
  enabled: true,
  quotaDays: '',
  quotaMegabytes: ''
};

type PanelPolicyForm = {
  dataLimitGb: string;
  expiryDays: string;
  ipLimit: string;
  deviceLimit: string;
  startOnFirstUse: boolean;
};

const DEFAULT_PANEL_POLICY_FORM: PanelPolicyForm = {
  dataLimitGb: '',
  expiryDays: '',
  ipLimit: '0',
  deviceLimit: '0',
  startOnFirstUse: false
};

function bytesToGbString(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return '';
  }
  const gb = bytes / 1024 ** 3;
  if (!Number.isFinite(gb) || gb < 0) {
    return '';
  }
  return gb.toFixed(2).replace(/\.00$/, '');
}

function formatUsageBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIndex]}`;
}

function getExpiryDaysFromEntry(entry: MieruUserEntry): number {
  if (entry.expireDate) {
    const expireAt = Date.parse(String(entry.expireDate));
    if (!Number.isNaN(expireAt)) {
      const days = Math.max(1, Math.ceil((expireAt - Date.now()) / (1000 * 60 * 60 * 24)));
      return days;
    }
  }

  const quotaDays = entry.quotas?.find((quota) => Number.isInteger(quota?.days))?.days;
  if (Number.isInteger(quotaDays) && (quotaDays ?? 0) > 0) {
    return quotaDays as number;
  }

  return 30;
}

function parseQuotaPayload(form: UserForm): MieruQuota[] {
  const quotaDays = form.quotaDays.trim();
  const quotaMegabytes = form.quotaMegabytes.trim();

  if (!quotaDays && !quotaMegabytes) {
    return [];
  }

  const quota: MieruQuota = {};
  if (quotaDays) {
    const daysValue = Number.parseInt(quotaDays, 10);
    if (!Number.isInteger(daysValue) || daysValue < 0) {
      throw new Error('Quota days must be a positive integer.');
    }
    quota.days = daysValue;
  }

  if (quotaMegabytes) {
    const megabytesValue = Number.parseInt(quotaMegabytes, 10);
    if (!Number.isInteger(megabytesValue) || megabytesValue < 0) {
      throw new Error('Quota megabytes must be a positive integer.');
    }
    quota.megabytes = megabytesValue;
  }

  return [quota];
}

function getQuotaFields(quotas?: MieruQuota[]): Pick<UserForm, 'quotaDays' | 'quotaMegabytes'> {
  const primaryQuota = Array.isArray(quotas)
    ? quotas.find((entry) => Number.isInteger(entry?.days) || Number.isInteger(entry?.megabytes))
    : undefined;

  return {
    quotaDays:
      primaryQuota && Number.isInteger(primaryQuota.days) && (primaryQuota.days ?? 0) >= 0
        ? String(primaryQuota.days)
        : '',
    quotaMegabytes:
      primaryQuota && Number.isInteger(primaryQuota.megabytes) && (primaryQuota.megabytes ?? 0) >= 0
        ? String(primaryQuota.megabytes)
        : ''
  };
}

function normalizeHostCandidate(value: string): string {
  const candidate = value.trim();
  if (!candidate) {
    return '';
  }

  const lower = candidate.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') {
    return '';
  }

  return candidate;
}

function getPanelHostCandidate(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return normalizeHostCandidate(window.location.hostname || '');
}

function formatRelativeAgo(iso: string | null | undefined): string {
  if (!iso) {
    return '-';
  }

  const parsed = Date.parse(String(iso));
  if (Number.isNaN(parsed)) {
    return '-';
  }

  const deltaMs = Math.max(0, Date.now() - parsed);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const MieruPage: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const panelHostCandidate = useMemo(() => getPanelHostCandidate(), []);

  const policyQuery = useMieruPolicy();
  const statusQuery = useMieruStatus();
  const onlineQuery = useMieruOnlineSnapshot(Boolean(policyQuery.data?.enabled));
  const profileQuery = useMieruProfile();
  const usersQuery = useMieruUsers(true);

  const syncMutation = useSyncMieruUsers();
  const restartMutation = useRestartMieru();
  const updateProfileMutation = useUpdateMieruProfile();
  const createUserMutation = useCreateMieruUser();
  const updateUserMutation = useUpdateMieruUser();
  const deleteUserMutation = useDeleteMieruUser();
  const userExportMutation = useMieruUserExport();
  const userSubscriptionUrlMutation = useMieruUserSubscriptionUrl();
  const updatePanelUserMutation = useUpdateUser();
  const resetPanelTrafficMutation = useResetTraffic();

  const [showLogs, setShowLogs] = useState(false);
  const logsQuery = useMieruLogs(120, showLogs);

  const [profileForm, setProfileForm] = useState<ProfileForm>(DEFAULT_PROFILE);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileAutofillDone, setProfileAutofillDone] = useState(false);
  const [detectingPublicIp, setDetectingPublicIp] = useState(false);

  const [createForm, setCreateForm] = useState<UserForm>(DEFAULT_USER_FORM);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserForm>(DEFAULT_USER_FORM);
  const [panelEditTarget, setPanelEditTarget] = useState<number | null>(null);
  const [panelPolicyForm, setPanelPolicyForm] = useState<PanelPolicyForm>(DEFAULT_PANEL_POLICY_FORM);

  useEffect(() => {
    if (!profileQuery.data || profileDirty) {
      return;
    }

    setProfileForm({
      server: profileQuery.data.server || '',
      portRange: profileQuery.data.portRange || DEFAULT_PROFILE.portRange,
      transport: profileQuery.data.transport || DEFAULT_PROFILE.transport,
      udp: Boolean(profileQuery.data.udp),
      multiplexing: profileQuery.data.multiplexing || DEFAULT_PROFILE.multiplexing
    });
    setProfileAutofillDone(Boolean(profileQuery.data.server));
  }, [profileDirty, profileQuery.data]);

  useEffect(() => {
    if (profileAutofillDone || profileDirty || profileForm.server.trim() || profileQuery.isLoading) {
      return;
    }

    if (panelHostCandidate) {
      setProfileForm((previous) => ({
        ...previous,
        server: panelHostCandidate
      }));
      setProfileAutofillDone(true);
      return;
    }

    let cancelled = false;
    setDetectingPublicIp(true);
    void getPublicIp()
      .then(({ ip }) => {
        if (cancelled) {
          return;
        }
        const resolvedIp = normalizeHostCandidate(ip || '');
        if (resolvedIp) {
          setProfileForm((previous) => ({
            ...previous,
            server: resolvedIp
          }));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) {
          return;
        }
        setDetectingPublicIp(false);
        setProfileAutofillDone(true);
      });

    return () => {
      cancelled = true;
    };
  }, [panelHostCandidate, profileAutofillDone, profileDirty, profileForm.server, profileQuery.isLoading]);

  const users = usersQuery.data?.users || [];

  const statusBadge = useMemo(() => {
    if (!policyQuery.data?.enabled) {
      return { label: t('common.disabled', { defaultValue: 'Disabled' }), variant: 'danger' as const };
    }

    if (statusQuery.data?.running) {
      return { label: t('common.online', { defaultValue: 'Online' }), variant: 'success' as const };
    }

    return { label: t('common.offline', { defaultValue: 'Offline' }), variant: 'warning' as const };
  }, [policyQuery.data?.enabled, statusQuery.data?.running, t]);

  const onRefreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['mieru-policy'] });
    void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
    void queryClient.invalidateQueries({ queryKey: ['mieru-profile'] });
    void queryClient.invalidateQueries({ queryKey: ['mieru-users'] });
    void queryClient.invalidateQueries({ queryKey: ['mieru-online'] });
    if (showLogs) {
      void queryClient.invalidateQueries({ queryKey: ['mieru-logs'] });
    }
  };

  const onSync = async () => {
    try {
      const result = await syncMutation.mutateAsync('manual.mieru.page.sync');
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.changed
          ? t('mieru.syncChanged', {
              defaultValue: 'Synced {{count}} users to Mieru.',
              count: result.userCount
            })
          : t('mieru.syncNoChange', {
              defaultValue: 'Already in sync ({{count}} users).',
              count: result.userCount
            })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.syncFailed', { defaultValue: 'Failed to sync Mieru users.' })
      );
    }
  };

  const onRestart = async () => {
    try {
      await restartMutation.mutateAsync();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.restartSuccess', { defaultValue: 'Mieru restarted successfully.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.restartFailed', { defaultValue: 'Failed to restart Mieru.' })
      );
    }
  };

  const onSaveProfile = async () => {
    try {
      await updateProfileMutation.mutateAsync(profileForm);
      setProfileDirty(false);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.profileSaved', { defaultValue: 'Mieru profile updated.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.profileSaveFailed', { defaultValue: 'Failed to update Mieru profile.' })
      );
    }
  };

  const onUseCurrentHost = () => {
    if (!panelHostCandidate) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('mieru.currentHostUnavailable', { defaultValue: 'Current panel host is unavailable on this device.' })
      );
      return;
    }

    setProfileDirty(true);
    setProfileForm((previous) => ({
      ...previous,
      server: panelHostCandidate
    }));
    setProfileAutofillDone(true);
  };

  const onDetectPublicIp = async () => {
    setDetectingPublicIp(true);
    try {
      const { ip } = await getPublicIp();
      const resolvedIp = normalizeHostCandidate(ip || '');
      if (!resolvedIp) {
        toast.warning(
          t('common.warning', { defaultValue: 'Warning' }),
          t('mieru.publicIpUnavailable', { defaultValue: 'Unable to resolve public IP right now.' })
        );
        return;
      }

      setProfileDirty(true);
      setProfileForm((previous) => ({
        ...previous,
        server: resolvedIp
      }));
      setProfileAutofillDone(true);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.publicIpDetected', { defaultValue: 'Public IP detected and applied.' })
      );
    } catch {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('mieru.publicIpDetectFailed', { defaultValue: 'Failed to detect public IP.' })
      );
    } finally {
      setDetectingPublicIp(false);
    }
  };

  const onCreateUser = async () => {
    try {
      const quotas = parseQuotaPayload(createForm);
      await createUserMutation.mutateAsync({
        username: createForm.username,
        password: createForm.password,
        enabled: createForm.enabled,
        ...(quotas.length > 0 ? { quotas } : {})
      });
      setCreateForm(DEFAULT_USER_FORM);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.userCreated', { defaultValue: 'Mieru user created.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        String(error?.message || t('mieru.userCreateFailed', { defaultValue: 'Failed to create Mieru user.' }))
      );
    }
  };

  const onStartEdit = (entry: MieruUserEntry) => {
    setEditTarget(entry.username);
    setEditForm({
      username: entry.username,
      password: entry.password,
      enabled: entry.enabled,
      ...getQuotaFields(entry.quotas)
    });
  };

  const onStartPanelPolicyEdit = (entry: MieruUserEntry) => {
    if (!entry.panelUserId) {
      return;
    }

    setPanelEditTarget(entry.panelUserId);
    setPanelPolicyForm({
      dataLimitGb: bytesToGbString(entry.dataLimitBytes),
      expiryDays: String(getExpiryDaysFromEntry(entry)),
      ipLimit: String(Number.isInteger(entry.ipLimit) ? entry.ipLimit : 0),
      deviceLimit: String(Number.isInteger(entry.deviceLimit) ? entry.deviceLimit : 0),
      startOnFirstUse: Boolean(entry.startOnFirstUse)
    });
  };

  const onCancelPanelPolicyEdit = () => {
    setPanelEditTarget(null);
    setPanelPolicyForm(DEFAULT_PANEL_POLICY_FORM);
  };

  const onSavePanelPolicy = async () => {
    if (!panelEditTarget) {
      return;
    }

    try {
      const dataLimitGb = Number.parseFloat(panelPolicyForm.dataLimitGb);
      const expiryDays = Number.parseInt(panelPolicyForm.expiryDays, 10);
      const ipLimit = Number.parseInt(panelPolicyForm.ipLimit || '0', 10);
      const deviceLimit = Number.parseInt(panelPolicyForm.deviceLimit || '0', 10);

      if (!Number.isFinite(dataLimitGb) || dataLimitGb < 0) {
        throw new Error(t('mieru.panelPolicy.invalidDataLimit', { defaultValue: 'Data limit must be a non-negative number.' }));
      }
      if (!Number.isInteger(expiryDays) || expiryDays < 1) {
        throw new Error(t('mieru.panelPolicy.invalidExpiry', { defaultValue: 'Expiry days must be at least 1.' }));
      }
      if (!Number.isInteger(ipLimit) || ipLimit < 0) {
        throw new Error(t('mieru.panelPolicy.invalidIpLimit', { defaultValue: 'IP limit must be 0 or more.' }));
      }
      if (!Number.isInteger(deviceLimit) || deviceLimit < 0) {
        throw new Error(t('mieru.panelPolicy.invalidDeviceLimit', { defaultValue: 'Device limit must be 0 or more.' }));
      }

      await updatePanelUserMutation.mutateAsync({
        id: panelEditTarget,
        data: {
          dataLimit: dataLimitGb,
          expiryDays,
          ipLimit,
          deviceLimit,
          startOnFirstUse: panelPolicyForm.startOnFirstUse
        }
      });

      await syncMutation.mutateAsync(`manual.mieru.panel.policy.${panelEditTarget}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mieru-users'] }),
        queryClient.invalidateQueries({ queryKey: ['mieru-online'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['user', panelEditTarget] })
      ]);

      onCancelPanelPolicyEdit();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.panelPolicy.updated', { defaultValue: 'Panel user policy updated and synced to Mieru.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.panelPolicy.updateFailed', { defaultValue: 'Failed to update panel user policy.' })
      );
    }
  };

  const onResetPanelTraffic = async (entry: MieruUserEntry) => {
    if (!entry.panelUserId) {
      return;
    }

    if (!window.confirm(t('mieru.panelPolicy.resetTrafficConfirm', { defaultValue: `Reset traffic for "${entry.username}"?` }))) {
      return;
    }

    try {
      await resetPanelTrafficMutation.mutateAsync(entry.panelUserId);
      await syncMutation.mutateAsync(`manual.mieru.panel.reset-traffic.${entry.panelUserId}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mieru-users'] }),
        queryClient.invalidateQueries({ queryKey: ['mieru-online'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['user', entry.panelUserId] })
      ]);

      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.panelPolicy.trafficReset', { defaultValue: 'User traffic reset and synced to Mieru.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.panelPolicy.trafficResetFailed', { defaultValue: 'Failed to reset user traffic.' })
      );
    }
  };

  const onUpdateUser = async () => {
    if (!editTarget) {
      return;
    }

    try {
      const quotas = parseQuotaPayload(editForm);
      await updateUserMutation.mutateAsync({
        username: editTarget,
        payload: {
          username: editForm.username,
          password: editForm.password,
          enabled: editForm.enabled,
          ...(quotas.length > 0 ? { quotas } : { quotas: [] })
        }
      });
      setEditTarget(null);
      setEditForm(DEFAULT_USER_FORM);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.userUpdated', { defaultValue: 'Mieru user updated.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        String(error?.message || t('mieru.userUpdateFailed', { defaultValue: 'Failed to update Mieru user.' }))
      );
    }
  };

  const onDeleteUser = async (username: string) => {
    if (!window.confirm(t('mieru.confirmDelete', { defaultValue: `Delete Mieru user "${username}"?` }))) {
      return;
    }

    try {
      await deleteUserMutation.mutateAsync(username);
      if (editTarget === username) {
        setEditTarget(null);
        setEditForm(DEFAULT_USER_FORM);
      }
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('mieru.userDeleted', { defaultValue: 'Mieru user deleted.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.userDeleteFailed', { defaultValue: 'Failed to delete Mieru user.' })
      );
    }
  };

  const onCopyYaml = async (username: string) => {
    try {
      const result = await userExportMutation.mutateAsync(username);
      const copied = await copyTextToClipboard(result.clashYaml);

      if (!copied) {
        throw new Error('clipboard failed');
      }

      toast.success(
        t('common.copied', { defaultValue: 'Copied' }),
        t('mieru.exportCopied', { defaultValue: 'Clash YAML copied to clipboard.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.exportCopyFailed', { defaultValue: 'Failed to copy Mieru export.' })
      );
    }
  };

  const onRegenerateAndCopyYaml = async (username: string) => {
    try {
      const syncResult = await syncMutation.mutateAsync(`manual.mieru.export.regenerate.${username}`);
      const result = await userExportMutation.mutateAsync(username);
      const copied = await copyTextToClipboard(result.clashYaml);

      if (!copied) {
        throw new Error('clipboard failed');
      }

      toast.success(
        t('common.copied', { defaultValue: 'Copied' }),
        t('mieru.regenerateAndCopySuccess', {
          defaultValue: 'Regenerated config and copied Clash YAML ({{count}} users synced).',
          count: syncResult.userCount
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.regenerateAndCopyFailed', { defaultValue: 'Failed to regenerate and copy Mieru profile.' })
      );
    }
  };

  const onDownloadYaml = async (username: string) => {
    try {
      const result = await userExportMutation.mutateAsync(username);
      const blob = new Blob([result.clashYaml], { type: 'application/yaml;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mieru-${username}.yaml`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.exportDownloadFailed', { defaultValue: 'Failed to download Mieru export.' })
      );
    }
  };

  const onCopySubscriptionUrl = async (username: string) => {
    try {
      const result = await userSubscriptionUrlMutation.mutateAsync(username);
      const copied = await copyTextToClipboard(result.subscriptionUrl);
      if (!copied) {
        throw new Error('clipboard failed');
      }
      toast.success(
        t('common.copied', { defaultValue: 'Copied' }),
        t('mieru.subscriptionUrlCopied', { defaultValue: 'Mieru subscription URL copied.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.subscriptionUrlFailed', { defaultValue: 'Failed to get Mieru subscription URL.' })
      );
    }
  };

  const onOpenSubscriptionUrl = async (username: string) => {
    try {
      const result = await userSubscriptionUrlMutation.mutateAsync(username);
      window.open(toMieruPageUrl(result.subscriptionUrl) || result.subscriptionUrl, '_blank', 'noopener,noreferrer');
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('mieru.subscriptionUrlFailed', { defaultValue: 'Failed to get Mieru subscription URL.' })
      );
    }
  };

  const onlineSnapshot = onlineQuery.data || usersQuery.data?.onlineSnapshot || null;
  const onlineCount = onlineSnapshot?.summary?.online ?? usersQuery.data?.stats?.online ?? 0;
  const totalCount = onlineSnapshot?.summary?.total ?? usersQuery.data?.stats?.total ?? 0;
  const onlineCheckedAgo = formatRelativeAgo(onlineSnapshot?.checkedAt || null);
  const restartWindowMinutes = Math.max(1, Math.round((statusQuery.data?.restartMonitor?.windowSeconds || 600) / 60));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('nav.mieru', { defaultValue: 'Mieru' })}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('mieru.subtitle', {
              defaultValue: 'Manage Mieru profile, custom users, exports, and live online state.'
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRefreshAll} loading={statusQuery.isFetching || usersQuery.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button variant="secondary" onClick={() => void onSync()} loading={syncMutation.isPending}>
            <Activity className="mr-2 h-4 w-4" />
            {t('mieru.syncUsers', { defaultValue: 'Sync Users' })}
          </Button>
          <Button variant="danger" onClick={() => void onRestart()} loading={restartMutation.isPending}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('mieru.restart', { defaultValue: 'Restart Mieru' })}
          </Button>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">{t('mieru.runtime', { defaultValue: 'Runtime' })}</h2>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          <span className="text-sm text-muted">
            {t('mieru.onlineSummary', {
              defaultValue: '{{online}} / {{total}} online',
              online: onlineCount,
              total: totalCount
            })}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-line/70 bg-panel/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted">{t('mieru.mode', { defaultValue: 'Mode' })}</p>
            <p className="mt-1 font-semibold text-foreground">{policyQuery.data?.mode || 'docker'}</p>
          </div>
          <div className="rounded-2xl border border-line/70 bg-panel/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted">{t('mieru.version', { defaultValue: 'Version' })}</p>
            <p className="mt-1 font-semibold text-foreground">{statusQuery.data?.version || 'unknown'}</p>
          </div>
          <div className="rounded-2xl border border-line/70 bg-panel/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted">{t('mieru.health', { defaultValue: 'Health' })}</p>
            <p className="mt-1 font-semibold text-foreground">
              {statusQuery.data?.health?.configured
                ? statusQuery.data?.health?.ok
                  ? t('common.online', { defaultValue: 'Online' })
                  : t('common.offline', { defaultValue: 'Offline' })
                : t('mieru.notConfigured', { defaultValue: 'Not configured' })}
            </p>
          </div>
          <div className="rounded-2xl border border-line/70 bg-panel/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted">{t('common.status', { defaultValue: 'Status' })}</p>
            <p className="mt-1 font-semibold text-foreground">{statusQuery.data?.state || 'unknown'}</p>
          </div>
          <div className="rounded-2xl border border-line/70 bg-panel/60 p-4">
            <p className="text-xs uppercase tracking-wide text-muted">
              {t('mieru.restartBurst', {
                defaultValue: 'Restarts ({{minutes}}m)',
                minutes: restartWindowMinutes
              })}
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {statusQuery.data?.restartMonitor
                ? `${statusQuery.data.restartMonitor.observedRestarts} / ${statusQuery.data.restartMonitor.threshold}`
                : '0 / 0'}
            </p>
            <p className="mt-1 text-xs text-muted">
              {statusQuery.data?.restartMonitor?.alerting
                ? t('mieru.restartAlerting', { defaultValue: 'Alerting' })
                : t('mieru.restartNormal', { defaultValue: 'Normal' })}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-line/70 bg-panel/45 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-wide text-muted">
              {t('mieru.onlineSnapshot', { defaultValue: 'Online Snapshot' })}
            </span>
            <span className="text-sm text-foreground">
              {t('mieru.lastChecked', { defaultValue: 'Last checked: {{ago}}', ago: onlineCheckedAgo })}
            </span>
            <Badge variant={onlineSnapshot?.commands?.users?.ok ? 'success' : 'warning'}>
              {onlineSnapshot?.commands?.users?.ok
                ? t('mieru.usersCmdOk', { defaultValue: 'Users command: OK' })
                : t('mieru.usersCmdFail', { defaultValue: 'Users command: Error' })}
            </Badge>
            <Badge variant={onlineSnapshot?.commands?.connections?.ok ? 'success' : 'warning'}>
              {onlineSnapshot?.commands?.connections?.ok
                ? t('mieru.connectionsCmdOk', { defaultValue: 'Connections command: OK' })
                : t('mieru.connectionsCmdFail', { defaultValue: 'Connections command: Error' })}
            </Badge>
            {onlineQuery.isFetching ? (
              <span className="text-xs text-muted">{t('common.refreshing', { defaultValue: 'Refreshing...' })}</span>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">{t('mieru.profile', { defaultValue: 'Server Profile' })}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Input
              label={t('mieru.serverHost', { defaultValue: 'Server Host / IP' })}
              value={profileForm.server}
              onChange={(event) => {
                setProfileDirty(true);
                setProfileForm((previous) => ({
                  ...previous,
                  server: event.target.value
                }));
              }}
              placeholder="167.71.212.189"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onUseCurrentHost}
                disabled={!panelHostCandidate}
              >
                {t('mieru.useCurrentHost', { defaultValue: 'Use current host' })}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onDetectPublicIp()}
                loading={detectingPublicIp}
              >
                {t('mieru.detectPublicIp', { defaultValue: 'Detect public IP' })}
              </Button>
            </div>
          </div>
          <Input
            label={t('mieru.portRange', { defaultValue: 'Port Range' })}
            value={profileForm.portRange}
            onChange={(event) => {
              setProfileDirty(true);
              setProfileForm((previous) => ({
                ...previous,
                portRange: event.target.value
              }));
            }}
            placeholder="2012-2022"
          />
          <label className="space-y-1.5">
            <span className="ml-1 block text-sm font-medium text-muted">{t('mieru.transport', { defaultValue: 'Transport' })}</span>
            <select
              value={profileForm.transport}
              onChange={(event) => {
                setProfileDirty(true);
                setProfileForm((previous) => ({
                  ...previous,
                  transport: event.target.value as 'TCP' | 'UDP'
                }));
              }}
              className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10"
            >
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="ml-1 block text-sm font-medium text-muted">{t('mieru.multiplexing', { defaultValue: 'Multiplexing' })}</span>
            <select
              value={profileForm.multiplexing}
              onChange={(event) => {
                setProfileDirty(true);
                setProfileForm((previous) => ({
                  ...previous,
                  multiplexing: event.target.value
                }));
              }}
              className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10"
            >
              <option value="MULTIPLEXING_DEFAULT">MULTIPLEXING_DEFAULT</option>
              <option value="MULTIPLEXING_LOW">MULTIPLEXING_LOW</option>
              <option value="MULTIPLEXING_MIDDLE">MULTIPLEXING_MIDDLE</option>
              <option value="MULTIPLEXING_HIGH">MULTIPLEXING_HIGH</option>
            </select>
          </label>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={profileForm.udp}
            onChange={(event) => {
              setProfileDirty(true);
              setProfileForm((previous) => ({
                ...previous,
                udp: event.target.checked
              }));
            }}
            className="h-4 w-4 rounded border-line/70 bg-card/70 text-brand-500 focus:ring-brand-500/40"
          />
          {t('mieru.udp', { defaultValue: 'Enable UDP' })}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void onSaveProfile()}
            loading={updateProfileMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!profileQuery.data) {
                return;
              }
              setProfileDirty(false);
              setProfileAutofillDone(false);
              setProfileForm({
                server: profileQuery.data.server || '',
                portRange: profileQuery.data.portRange || DEFAULT_PROFILE.portRange,
                transport: profileQuery.data.transport || DEFAULT_PROFILE.transport,
                udp: Boolean(profileQuery.data.udp),
                multiplexing: profileQuery.data.multiplexing || DEFAULT_PROFILE.multiplexing
              });
            }}
          >
            {t('common.reset', { defaultValue: 'Reset' })}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">{t('mieru.customUsers', { defaultValue: 'Custom Mieru Users' })}</h2>
        <div className="grid gap-4 md:grid-cols-5">
          <Input
            label={t('auth.username', { defaultValue: 'Username' })}
            value={createForm.username}
            onChange={(event) => setCreateForm((previous) => ({ ...previous, username: event.target.value }))}
            placeholder="mieru_user"
          />
          <Input
            label={t('auth.password', { defaultValue: 'Password' })}
            value={createForm.password}
            onChange={(event) => setCreateForm((previous) => ({ ...previous, password: event.target.value }))}
            placeholder="strong-password"
          />
          <Input
            type="number"
            min={0}
            label={t('mieru.quotaDays', { defaultValue: 'Quota Days' })}
            value={createForm.quotaDays}
            onChange={(event) => setCreateForm((previous) => ({ ...previous, quotaDays: event.target.value }))}
            placeholder="30"
          />
          <Input
            type="number"
            min={0}
            label={t('mieru.quotaMegabytes', { defaultValue: 'Quota MB' })}
            value={createForm.quotaMegabytes}
            onChange={(event) => setCreateForm((previous) => ({ ...previous, quotaMegabytes: event.target.value }))}
            placeholder="10240"
          />
          <label className="space-y-1.5">
            <span className="ml-1 block text-sm font-medium text-muted">{t('common.status', { defaultValue: 'Status' })}</span>
            <select
              value={createForm.enabled ? 'enabled' : 'disabled'}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, enabled: event.target.value === 'enabled' }))}
              className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10"
            >
              <option value="enabled">{t('common.enabled', { defaultValue: 'Enabled' })}</option>
              <option value="disabled">{t('common.disabled', { defaultValue: 'Disabled' })}</option>
            </select>
          </label>
        </div>
        <Button onClick={() => void onCreateUser()} loading={createUserMutation.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          {t('mieru.addCustomUser', { defaultValue: 'Add Custom User' })}
        </Button>
      </Card>

      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line/70">
            <thead className="bg-panel/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">{t('auth.username', { defaultValue: 'Username' })}</th>
                <th className="px-4 py-3">{t('auth.password', { defaultValue: 'Password' })}</th>
                <th className="px-4 py-3">{t('mieru.source', { defaultValue: 'Source' })}</th>
                <th className="px-4 py-3">{t('common.status', { defaultValue: 'Status' })}</th>
                <th className="px-4 py-3">{t('mieru.quotas', { defaultValue: 'Quotas' })}</th>
                <th className="px-4 py-3">{t('common.online', { defaultValue: 'Online' })}</th>
                <th className="px-4 py-3">{t('common.actions', { defaultValue: 'Actions' })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {users.map((entry) => {
                const isEditing = editTarget === entry.username;
                const isCustom = entry.source === 'custom';
                const isPanel = entry.source === 'panel' && Boolean(entry.panelUserId);
                const isPanelEditing = isPanel && panelEditTarget === entry.panelUserId;
                const usedBytes = (entry.uploadUsedBytes || 0) + (entry.downloadUsedBytes || 0);

                return (
                  <tr key={entry.username} className="text-sm">
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.username}
                          onChange={(event) => setEditForm((previous) => ({ ...previous, username: event.target.value }))}
                          className="w-full rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                        />
                      ) : (
                        <span className="font-medium text-foreground">{entry.username}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.password}
                          onChange={(event) => setEditForm((previous) => ({ ...previous, password: event.target.value }))}
                          className="w-full rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                        />
                      ) : (
                        <code className="rounded bg-panel/60 px-2 py-1 text-xs text-muted">{entry.password}</code>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{entry.source}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editForm.enabled ? 'enabled' : 'disabled'}
                          onChange={(event) => setEditForm((previous) => ({ ...previous, enabled: event.target.value === 'enabled' }))}
                          className="rounded-lg border border-line/60 bg-card/60 px-2 py-1 text-sm"
                        >
                          <option value="enabled">{t('common.enabled', { defaultValue: 'Enabled' })}</option>
                          <option value="disabled">{t('common.disabled', { defaultValue: 'Disabled' })}</option>
                        </select>
                      ) : entry.enabled ? (
                        <Badge variant="success">{t('common.enabled', { defaultValue: 'Enabled' })}</Badge>
                      ) : (
                        <Badge variant="warning">{t('common.disabled', { defaultValue: 'Disabled' })}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex min-w-[220px] items-center gap-2">
                          <input
                            value={editForm.quotaDays}
                            onChange={(event) => setEditForm((previous) => ({ ...previous, quotaDays: event.target.value }))}
                            type="number"
                            min={0}
                            placeholder={t('mieru.days', { defaultValue: 'Days' })}
                            className="w-24 rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                          />
                          <input
                            value={editForm.quotaMegabytes}
                            onChange={(event) => setEditForm((previous) => ({ ...previous, quotaMegabytes: event.target.value }))}
                            type="number"
                            min={0}
                            placeholder={t('mieru.megabytes', { defaultValue: 'MB' })}
                            className="w-28 rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                          />
                        </div>
                      ) : isPanelEditing ? (
                        <div className="grid min-w-[320px] grid-cols-2 gap-2">
                          <input
                            value={panelPolicyForm.dataLimitGb}
                            onChange={(event) =>
                              setPanelPolicyForm((previous) => ({ ...previous, dataLimitGb: event.target.value }))
                            }
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder={t('users.dataLimitGb', { defaultValue: 'Data GB' })}
                            className="rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                          />
                          <input
                            value={panelPolicyForm.expiryDays}
                            onChange={(event) =>
                              setPanelPolicyForm((previous) => ({ ...previous, expiryDays: event.target.value }))
                            }
                            type="number"
                            min={1}
                            placeholder={t('users.expiryDays', { defaultValue: 'Expiry days' })}
                            className="rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                          />
                          <input
                            value={panelPolicyForm.ipLimit}
                            onChange={(event) =>
                              setPanelPolicyForm((previous) => ({ ...previous, ipLimit: event.target.value }))
                            }
                            type="number"
                            min={0}
                            placeholder={t('users.ipLimit', { defaultValue: 'IP limit' })}
                            className="rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                          />
                          <input
                            value={panelPolicyForm.deviceLimit}
                            onChange={(event) =>
                              setPanelPolicyForm((previous) => ({ ...previous, deviceLimit: event.target.value }))
                            }
                            type="number"
                            min={0}
                            placeholder={t('users.deviceLimit', { defaultValue: 'Device limit' })}
                            className="rounded-lg border border-line/60 bg-card/60 px-2.5 py-1.5 text-sm"
                          />
                          <label className="col-span-2 inline-flex items-center gap-2 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={panelPolicyForm.startOnFirstUse}
                              onChange={(event) =>
                                setPanelPolicyForm((previous) => ({
                                  ...previous,
                                  startOnFirstUse: event.target.checked
                                }))
                              }
                              className="h-4 w-4 rounded border-line/70 bg-card/70 text-brand-500 focus:ring-brand-500/40"
                            />
                            {t('users.startOnFirstUse', { defaultValue: 'Start expiry on first connect' })}
                          </label>
                        </div>
                      ) : (
                        <div className="text-xs text-muted">
                          {isPanel ? (
                            <div className="space-y-1">
                              <div>
                                {t('users.dataLimitGb', { defaultValue: 'Data Limit' })}:{' '}
                                <span className="text-foreground">{bytesToGbString(entry.dataLimitBytes) || '0'} GB</span>
                              </div>
                              <div>
                                {t('users.dataUsed', { defaultValue: 'Used' })}:{' '}
                                <span className="text-foreground">{formatUsageBytes(usedBytes)}</span>
                              </div>
                              <div>
                                {t('users.expiryDays', { defaultValue: 'Expiry days' })}:{' '}
                                <span className="text-foreground">{getExpiryDaysFromEntry(entry)}</span>
                              </div>
                              <div>
                                {t('users.startOnFirstUse', { defaultValue: 'Start on first connect' })}:{' '}
                                <span className="text-foreground">
                                  {entry.startOnFirstUse
                                    ? t('common.enabled', { defaultValue: 'Enabled' })
                                    : t('common.disabled', { defaultValue: 'Disabled' })}
                                </span>
                              </div>
                            </div>
                          ) : (
                            (() => {
                              const quota = entry.quotas?.find(
                                (item) => Number.isInteger(item?.days) || Number.isInteger(item?.megabytes)
                              );
                              if (!quota) {
                                return t('common.notSet', { defaultValue: 'Not set' });
                              }
                              const daysText =
                                Number.isInteger(quota.days) && (quota.days ?? 0) >= 0
                                  ? `${quota.days}d`
                                  : '∞';
                              const mbText =
                                Number.isInteger(quota.megabytes) && (quota.megabytes ?? 0) >= 0
                                  ? `${quota.megabytes}MB`
                                  : '∞';
                              return `${daysText} / ${mbText}`;
                            })()
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {entry.online ? (
                        <Badge variant="success">{t('common.online', { defaultValue: 'Online' })}</Badge>
                      ) : (
                        <Badge variant="warning">{t('common.offline', { defaultValue: 'Offline' })}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onRegenerateAndCopyYaml(entry.username)}
                          loading={syncMutation.isPending || userExportMutation.isPending}
                          disabled={!entry.configured}
                        >
                          <RefreshCw className="mr-1 h-3.5 w-3.5" />
                          {t('mieru.regenerateCopy', { defaultValue: 'Regen + Copy' })}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onCopyYaml(entry.username)}
                          loading={userExportMutation.isPending}
                          disabled={!entry.configured}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          YAML
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onDownloadYaml(entry.username)}
                          loading={userExportMutation.isPending}
                          disabled={!entry.configured}
                        >
                          <Download className="mr-1 h-3.5 w-3.5" />
                          {t('common.download', { defaultValue: 'Download' })}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onCopySubscriptionUrl(entry.username)}
                          loading={userSubscriptionUrlMutation.isPending}
                          disabled={!entry.configured || entry.source !== 'panel'}
                          title={
                            entry.source === 'panel'
                              ? t('mieru.subscriptionUrlAction', { defaultValue: 'Copy Mieru subscription URL' })
                              : t('mieru.subscriptionUrlPanelOnly', { defaultValue: 'Available for panel users only' })
                          }
                        >
                          <Link className="mr-1 h-3.5 w-3.5" />
                          Sub URL
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onOpenSubscriptionUrl(entry.username)}
                          loading={userSubscriptionUrlMutation.isPending}
                          disabled={!entry.configured || entry.source !== 'panel'}
                          title={
                            entry.source === 'panel'
                              ? t('mieru.subscriptionUrlOpenAction', { defaultValue: 'Open Mieru subscription URL' })
                              : t('mieru.subscriptionUrlPanelOnly', { defaultValue: 'Available for panel users only' })
                          }
                        >
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          {t('common.open', { defaultValue: 'Open' })}
                        </Button>
                        {isPanel ? (
                          isPanelEditing ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => void onSavePanelPolicy()}
                                loading={updatePanelUserMutation.isPending || syncMutation.isPending}
                              >
                                <Save className="mr-1 h-3.5 w-3.5" />
                                {t('common.save', { defaultValue: 'Save' })}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={onCancelPanelPolicyEdit}>
                                {t('common.cancel', { defaultValue: 'Cancel' })}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onStartPanelPolicyEdit(entry)}
                              >
                                <Edit3 className="mr-1 h-3.5 w-3.5" />
                                {t('users.editPolicy', { defaultValue: 'Edit Policy' })}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void onResetPanelTraffic(entry)}
                                loading={resetPanelTrafficMutation.isPending}
                              >
                                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                {t('users.resetTraffic', { defaultValue: 'Reset Traffic' })}
                              </Button>
                            </>
                          )
                        ) : null}
                        {isCustom ? (
                          isEditing ? (
                            <>
                              <Button size="sm" onClick={() => void onUpdateUser()} loading={updateUserMutation.isPending}>
                                <Save className="mr-1 h-3.5 w-3.5" />
                                {t('common.save', { defaultValue: 'Save' })}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditTarget(null);
                                  setEditForm(DEFAULT_USER_FORM);
                                }}
                              >
                                {t('common.cancel', { defaultValue: 'Cancel' })}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onStartEdit(entry)}
                              >
                                <Edit3 className="mr-1 h-3.5 w-3.5" />
                                {t('common.edit', { defaultValue: 'Edit' })}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void onDeleteUser(entry.username)}>
                                <Trash2 className="mr-1 h-3.5 w-3.5 text-red-400" />
                                {t('common.delete', { defaultValue: 'Delete' })}
                              </Button>
                            </>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!users.length ? (
            <div className="px-4 py-10 text-center text-sm text-muted">
              {t('mieru.noUsers', { defaultValue: 'No Mieru users found yet.' })}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="space-y-3">
        <button
          type="button"
          onClick={() => setShowLogs((previous) => !previous)}
          className="inline-flex items-center rounded-xl border border-line/70 px-3 py-2 text-sm font-medium text-foreground transition hover:bg-panel/60"
        >
          <Activity className="mr-2 h-4 w-4" />
          {showLogs
            ? t('mieru.hideLogs', { defaultValue: 'Hide Logs' })
            : t('mieru.showLogs', { defaultValue: 'Show Logs' })}
        </button>
        {showLogs ? (
          <pre className="max-h-80 overflow-auto rounded-2xl border border-line/70 bg-black/35 p-4 text-xs text-slate-200">
            {logsQuery.isLoading
              ? t('common.loading', { defaultValue: 'Loading...' })
              : logsQuery.data?.raw || logsQuery.data?.detail || t('mieru.noLogs', { defaultValue: 'No logs available.' })}
          </pre>
        ) : null}
      </Card>
    </div>
  );
};
