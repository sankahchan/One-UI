import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, FileCode2, RefreshCw, Server, XCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import apiClient from '../../api/client';
import type { XrayUpdatePreflightCheck } from '../../api/xray';
import { useAuthStore } from '../../store/authStore';
import {
  useCreateXrayConfigSnapshot,
  useReloadXrayConfig,
  useRestartXray,
  useRollbackXrayConfigSnapshot,
  useRunXrayRollback,
  useRunXrayRuntimeDoctor,
  useRunXrayUpdateUnlock,
  useRunXrayCanaryUpdate,
  useRunXrayFullUpdate,
  useSyncXrayConfDir,
  useXrayConfig,
  useXrayConfigSnapshots,
  useXrayConfDirStatus,
  useXrayGeodataStatus,
  useXrayRollbackBackups,
  useXrayRoutingProfile,
  useXrayStatus,
  useXrayUpdateReleaseIntel,
  useRefreshXrayUpdateReleaseIntel,
  useUpdateXrayGeodata,
  useUpdateXrayRoutingProfile,
  useXrayUpdateHistory,
  useXrayUpdatePreflight,
  useXrayUpdatePolicy
} from '../../hooks/useXray';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { ConfirmDialog } from '../../components/organisms/ConfirmDialog';
import { useToast } from '../../hooks/useToast';
import { copyTextToClipboard } from '../../utils/clipboard';
import { getPreflightFixCommands, getPreflightMetadataString } from '../../utils/xrayUpdatePreflight';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

interface SystemStats {
  admins?: number;
  users?: number;
  inbounds?: number;
  userInbounds?: number;
  trafficLogs?: number;
  systemLogs?: number;
  uptimeSeconds?: number;
  cpu?: number;
  memory?: number;
  uptime?: string;
}

function formatUptime(uptimeSeconds?: number): string {
  if (!uptimeSeconds || uptimeSeconds < 1) return 'N/A';

  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

const SystemSettings: React.FC = () => {
  const isSuperAdmin = useAuthStore((state) => state.admin?.role === 'SUPER_ADMIN');
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const xrayUpdatesRef = useRef<HTMLDivElement | null>(null);
  const confirmResolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const [showConfigPreview, setShowConfigPreview] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'latest'>('stable');
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedRollbackTag, setSelectedRollbackTag] = useState('');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [guidedRolloutRunning, setGuidedRolloutRunning] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'primary';
  } | null>(null);

  const { data: systemStats } = useQuery({
    queryKey: ['system-stats'],
    queryFn: async () => (await apiClient.get('/system/stats')) as ApiResponse<SystemStats>,
    refetchInterval: 5000
  });

  const xrayStatusQuery = useXrayStatus();
  const xrayConfigQuery = useXrayConfig(showConfigPreview);
  const restartXrayMutation = useRestartXray();
  const reloadXrayConfigMutation = useReloadXrayConfig();
  const xrayUpdatePolicyQuery = useXrayUpdatePolicy();
  const xrayUpdatePreflightQuery = useXrayUpdatePreflight();
  const xrayUpdatePolicy = xrayUpdatePolicyQuery.data;
  const xrayUpdatePreflight = xrayUpdatePreflightQuery.data;
  const scriptedUpdatesEnabled = xrayUpdatePolicy?.updatesEnabled !== false;
  const rollbackBackupsQueryEnabled = xrayUpdatePolicyQuery.isSuccess ? scriptedUpdatesEnabled : false;
  const xrayUpdateHistoryQuery = useXrayUpdateHistory(historyPage, 10);
  const xrayRollbackBackupsQuery = useXrayRollbackBackups(rollbackBackupsQueryEnabled);
  const xrayReleaseIntelQuery = useXrayUpdateReleaseIntel(scriptedUpdatesEnabled);
  const refreshXrayReleaseIntelMutation = useRefreshXrayUpdateReleaseIntel();
  const xrayConfigSnapshotsQuery = useXrayConfigSnapshots(true);
  const createXrayConfigSnapshotMutation = useCreateXrayConfigSnapshot();
  const rollbackXrayConfigSnapshotMutation = useRollbackXrayConfigSnapshot();
  const xrayRoutingProfileQuery = useXrayRoutingProfile(true);
  const updateXrayRoutingProfileMutation = useUpdateXrayRoutingProfile();
  const xrayGeodataStatusQuery = useXrayGeodataStatus(true);
  const updateXrayGeodataMutation = useUpdateXrayGeodata();
  const xrayConfDirStatusQuery = useXrayConfDirStatus(true);
  const syncXrayConfDirMutation = useSyncXrayConfDir();
  const runCanaryUpdateMutation = useRunXrayCanaryUpdate();
  const runFullUpdateMutation = useRunXrayFullUpdate();
  const runRollbackMutation = useRunXrayRollback();
  const runUpdateUnlockMutation = useRunXrayUpdateUnlock();
  const runRuntimeDoctorMutation = useRunXrayRuntimeDoctor();

  const stats = systemStats?.data;
  const xrayStatus = xrayStatusQuery.data;
  const xrayConfig = xrayConfigQuery.data;
  const xrayUpdateHistory = xrayUpdateHistoryQuery.data;
  const xrayReleaseIntel = xrayReleaseIntelQuery.data;
  const xrayConfigSnapshots = useMemo(
    () => xrayConfigSnapshotsQuery.data?.snapshots ?? [],
    [xrayConfigSnapshotsQuery.data?.snapshots]
  );
  const xrayRoutingProfile = xrayRoutingProfileQuery.data;
  const xrayGeodataStatus = xrayGeodataStatusQuery.data;
  const xrayConfDirStatus = xrayConfDirStatusQuery.data;
  const rollbackBackups = useMemo(
    () => xrayRollbackBackupsQuery.data ?? [],
    [xrayRollbackBackupsQuery.data]
  );
  const updateRuntimeMode = xrayUpdatePolicy?.mode || xrayUpdatePreflight?.mode || 'docker';
  const updatePreflightBlocked = xrayUpdatePreflightQuery.isLoading || !xrayUpdatePreflight?.ready;
  const unresolvedPreflightChecks = (xrayUpdatePreflight?.checks || []).filter((check) => !check.ok);
  const blockingPreflightFailures = unresolvedPreflightChecks.filter((check) => check.blocking);
  const activeLockFailure = (xrayUpdatePreflight?.checks || []).find((check) => check.id === 'update-lock' && !check.ok);
  const canForceUnlock = Boolean(activeLockFailure);
  const activeLockOwner = getPreflightMetadataString(activeLockFailure, 'ownerId');
  const activeLockExpiresAt = getPreflightMetadataString(activeLockFailure, 'expiresAt');
  const preflightGeneratedAtMs = xrayUpdatePreflight?.generatedAt
    ? new Date(xrayUpdatePreflight.generatedAt).getTime()
    : Number.NaN;
  const activeLockIsStale = activeLockExpiresAt && Number.isFinite(preflightGeneratedAtMs)
    ? new Date(activeLockExpiresAt).getTime() <= preflightGeneratedAtMs
    : false;
  const unresolvedFixCommands = useMemo(
    () => Array.from(
      new Set(
        unresolvedPreflightChecks
          .flatMap((check) => getPreflightFixCommands(check as XrayUpdatePreflightCheck))
          .filter((line) => line.trim().length > 0)
      )
    ),
    [unresolvedPreflightChecks]
  );
  const updateMutationsBusy = guidedRolloutRunning
    || runCanaryUpdateMutation.isPending
    || runFullUpdateMutation.isPending
    || runRollbackMutation.isPending
    || runRuntimeDoctorMutation.isPending;

  useEffect(() => {
    if (!xrayConfigSnapshots.length) {
      setSelectedSnapshotId('');
      return;
    }

    if (!selectedSnapshotId || !xrayConfigSnapshots.some((snapshot) => snapshot.id === selectedSnapshotId)) {
      setSelectedSnapshotId(xrayConfigSnapshots[0].id);
    }
  }, [xrayConfigSnapshots, selectedSnapshotId]);

  useEffect(() => {
    if (!rollbackBackups.length) {
      if (selectedRollbackTag !== '') {
        setSelectedRollbackTag('');
      }
      return;
    }

    if (!selectedRollbackTag || !rollbackBackups.includes(selectedRollbackTag)) {
      setSelectedRollbackTag(rollbackBackups[0]);
    }
  }, [rollbackBackups, selectedRollbackTag]);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    if (search.get('section') !== 'xray-updates') {
      return;
    }

    const timer = window.setTimeout(() => {
      xrayUpdatesRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [location.search]);

  useEffect(() => () => {
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = null;
  }, []);

  const requestConfirm = ({
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger'
  }: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'primary';
  }) => new Promise<boolean>((resolve) => {
    confirmResolverRef.current = resolve;
    setConfirmDialog({
      title,
      description,
      confirmLabel,
      cancelLabel,
      tone
    });
  });

  const resolveConfirm = (accepted: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolver?.(accepted);
  };

  const refreshXrayStatus = () => {
    void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
  };

  const handleReloadConfig = async () => {
    try {
      const result = await reloadXrayConfigMutation.mutateAsync();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.message || t('systemSettings.toast.configReloaded', { defaultValue: 'Xray config reloaded successfully.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.configReloadFailed', { defaultValue: 'Failed to reload Xray config' })
      );
    }
  };

  const handleRestartXray = async () => {
    try {
      const result = await restartXrayMutation.mutateAsync();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.message || t('systemSettings.toast.restartSuccess', { defaultValue: 'Xray restarted successfully!' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.restartFailed', { defaultValue: 'Failed to restart Xray' })
      );
    }
  };

  const handleRunCanaryUpdate = async () => {
    if (!scriptedUpdatesEnabled) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('systemSettings.toast.manualModeScriptedDisabled', {
          defaultValue: 'Scripted Xray updates are disabled in manual mode. Use your host update workflow.'
        })
      );
      return;
    }
    try {
      const result = await runCanaryUpdateMutation.mutateAsync({
        channel: updateChannel
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.summary || t('systemSettings.toast.canaryComplete', { defaultValue: 'Canary update completed successfully.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.canaryFailed', { defaultValue: 'Failed to run canary update' })
      );
    }
  };

  const handleRunFullUpdate = async (force = false) => {
    if (!scriptedUpdatesEnabled) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('systemSettings.toast.manualModeScriptedDisabled', {
          defaultValue: 'Scripted Xray updates are disabled in manual mode. Use your host update workflow.'
        })
      );
      return;
    }
    const confirmText = force
      ? 'Run full rollout and bypass canary requirement?'
      : 'Run full rollout now? This will restart Xray service.';
    const confirmed = await requestConfirm({
      title: force ? 'Force full rollout?' : 'Run full rollout?',
      description: confirmText,
      confirmLabel: force ? 'Force rollout' : 'Run rollout',
      tone: force ? 'danger' : 'primary'
    });
    if (!confirmed) {
      return;
    }

    try {
      const result = await runFullUpdateMutation.mutateAsync({
        channel: updateChannel,
        force
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.summary || t('systemSettings.toast.fullRolloutComplete', { defaultValue: 'Full rollout completed successfully.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.fullRolloutFailed', { defaultValue: 'Failed to run full rollout' })
      );
    }
  };

  const handleRunGuidedRollout = async () => {
    if (!scriptedUpdatesEnabled) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('systemSettings.toast.manualModeGuidedUnavailable', {
          defaultValue: 'Guided rollout is unavailable in manual mode. Use your host update workflow.'
        })
      );
      return;
    }
    const startGuided = await requestConfirm({
      title: `Start guided rollout (${updateChannel.toUpperCase()})?`,
      description: 'This flow runs Canary first, then prompts Full rollout.',
      confirmLabel: 'Start guided rollout',
      tone: 'primary'
    });
    if (!startGuided) {
      return;
    }

    setGuidedRolloutRunning(true);
    try {
      const preflightResult = await xrayUpdatePreflightQuery.refetch();
      if (!preflightResult.data?.ready) {
        toast.warning(
          t('common.warning', { defaultValue: 'Warning' }),
          t('systemSettings.toast.preflightBlocked', { defaultValue: 'Resolve preflight checks before guided rollout.' })
        );
        return;
      }

      const canaryResult = await runCanaryUpdateMutation.mutateAsync({
        channel: updateChannel
      });

      const continueToFull = await requestConfirm({
        title: 'Canary complete',
        description: `Canary finished successfully.${canaryResult.summary ? `\n\n${canaryResult.summary}` : ''}\n\nContinue with Full rollout now?`,
        confirmLabel: 'Continue to full rollout',
        tone: 'primary'
      });
      if (!continueToFull) {
        toast.info(
          t('common.info', { defaultValue: 'Info' }),
          t('systemSettings.toast.guidedPaused', { defaultValue: 'Canary complete. Full rollout skipped.' })
        );
        return;
      }

      const fullResult = await runFullUpdateMutation.mutateAsync({
        channel: updateChannel
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        fullResult.summary || t('systemSettings.toast.guidedComplete', { defaultValue: 'Guided rollout completed successfully.' })
      );
    } catch (error: any) {
      const failureMessage = error?.message || 'Guided rollout failed';
      const runRollbackNow = await requestConfirm({
        title: 'Guided rollout failed',
        description: `${failureMessage}\n\nRun rollback shortcut now?`,
        confirmLabel: 'Run rollback',
        tone: 'danger'
      });
      if (!runRollbackNow) {
        return;
      }

      const backupResult = await xrayRollbackBackupsQuery.refetch();
      const backupTags = backupResult.data || rollbackBackups;
      const backupTag = selectedRollbackTag || backupTags?.[0];

      if (!backupTag) {
        toast.warning(
          t('common.warning', { defaultValue: 'Warning' }),
          t('systemSettings.toast.noRollbackTag', { defaultValue: 'No rollback backup tag available. Refresh tags and try again.' })
        );
        return;
      }

      const rollbackResult = await runRollbackMutation.mutateAsync({
        backupTag
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        rollbackResult.summary
          || t('systemSettings.toast.rollbackCompleteWithTag', { defaultValue: 'Rollback completed using {{tag}}.', tag: backupTag })
      );
    } finally {
      setGuidedRolloutRunning(false);
    }
  };

  const handleRunRollback = async () => {
    if (!scriptedUpdatesEnabled) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('systemSettings.toast.manualModeRollbackDisabled', {
          defaultValue: 'Scripted rollback is disabled in manual mode. Use your host rollback workflow.'
        })
      );
      return;
    }
    const confirmText = selectedRollbackTag
      ? `Run rollback with ${selectedRollbackTag}?`
      : 'Run rollback with latest available backup tag?';
    const confirmed = await requestConfirm({
      title: 'Run rollback?',
      description: confirmText,
      confirmLabel: 'Run rollback',
      tone: 'danger'
    });
    if (!confirmed) {
      return;
    }

    try {
      const result = await runRollbackMutation.mutateAsync({
        backupTag: selectedRollbackTag || undefined
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.summary || t('systemSettings.toast.rollbackComplete', { defaultValue: 'Rollback completed successfully.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.rollbackFailed', { defaultValue: 'Failed to run rollback' })
      );
    }
  };

  const handleCopyConfig = async () => {
    if (!xrayConfig) {
      return;
    }

    try {
      const copiedOk = await copyTextToClipboard(JSON.stringify(xrayConfig, null, 2));
      if (!copiedOk) {
        throw new Error('copy_failed');
      }
      setCopiedConfig(true);
      window.setTimeout(() => setCopiedConfig(false), 1500);
    } catch {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('systemSettings.toast.copyConfigFailed', { defaultValue: 'Failed to copy config to clipboard' })
      );
    }
  };

  const handleCopyPreflightFixes = async () => {
    if (!unresolvedFixCommands.length) {
      return;
    }

    const content = [
      '# One-UI Xray Update Preflight Fixes',
      ...unresolvedFixCommands.map((line) => `- ${line}`)
    ].join('\n');

    try {
      const copiedOk = await copyTextToClipboard(content);
      if (!copiedOk) {
        throw new Error('copy_failed');
      }
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('systemSettings.toast.copyPreflightFixesSuccess', { defaultValue: 'Preflight fix commands copied.' })
      );
    } catch {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('systemSettings.toast.copyPreflightFixesFailed', { defaultValue: 'Failed to copy preflight fix commands.' })
      );
    }
  };

  const handleRunRuntimeDoctor = async () => {
    try {
      const result = await runRuntimeDoctorMutation.mutateAsync({
        repair: true,
        source: 'system-settings'
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('systemSettings.toast.runtimeDoctorComplete', {
          defaultValue: 'Runtime doctor completed. Applied {{count}} repair action(s).',
          count: result.repairedCount || 0
        })
      );
      await Promise.all([
        xrayUpdatePreflightQuery.refetch(),
        xrayUpdatePolicyQuery.refetch(),
        xrayStatusQuery.refetch()
      ]);
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.runtimeDoctorFailed', { defaultValue: 'Runtime doctor failed.' })
      );
    }
  };

  const handleRefreshReleaseIntel = async () => {
    try {
      await refreshXrayReleaseIntelMutation.mutateAsync();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('systemSettings.toast.releaseIntelRefreshed', { defaultValue: 'Latest release metadata pulled from upstream.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.releaseIntelRefreshFailed', { defaultValue: 'Failed to refresh release intel' })
      );
    }
  };

  const handleCreateConfigSnapshot = async () => {
    try {
      const snapshot = await createXrayConfigSnapshotMutation.mutateAsync();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('systemSettings.toast.snapshotCreated', { defaultValue: 'Snapshot ID: {{id}}', id: snapshot.id })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.snapshotFailed', { defaultValue: 'Failed to create config snapshot' })
      );
    }
  };

  const handleRollbackConfigSnapshot = async () => {
    if (!selectedSnapshotId) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('systemSettings.toast.selectSnapshot', { defaultValue: 'Choose a snapshot before rollback.' })
      );
      return;
    }
    const confirmed = await requestConfirm({
      title: 'Rollback config snapshot?',
      description: `Rollback Xray config using snapshot ${selectedSnapshotId}?`,
      confirmLabel: 'Rollback snapshot',
      tone: 'danger'
    });
    if (!confirmed) {
      return;
    }

    try {
      const result = await rollbackXrayConfigSnapshotMutation.mutateAsync({
        snapshotId: selectedSnapshotId,
        applyMethod: 'restart'
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.message || t('systemSettings.toast.configRollbackComplete', { defaultValue: 'Config rollback completed.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.configRollbackFailed', { defaultValue: 'Failed to rollback snapshot' })
      );
    }
  };

  const handleSetRoutingMode = async (mode: 'smart' | 'filtered' | 'strict' | 'open') => {
    try {
      await updateXrayRoutingProfileMutation.mutateAsync({
        mode,
        apply: true
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('systemSettings.toast.routingUpdated', { defaultValue: 'Routing profile switched to {{mode}}.', mode })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.routingUpdateFailed', { defaultValue: 'Failed to update routing profile' })
      );
    }
  };

  const handleUpdateGeodata = async () => {
    try {
      await updateXrayGeodataMutation.mutateAsync({
        useCommand: true,
        forceDownload: false,
        reload: true
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('systemSettings.toast.geodataUpdated', { defaultValue: 'Geodata updated successfully.' })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.geodataUpdateFailed', { defaultValue: 'Failed to update geodata' })
      );
    }
  };

  const handleSyncConfDir = async () => {
    try {
      const result = await syncXrayConfDirMutation.mutateAsync();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('systemSettings.toast.confdirSynced', { defaultValue: '{{count}} file(s) synchronized.', count: result.files.length })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.confdirSyncFailed', { defaultValue: 'Failed to sync confdir' })
      );
    }
  };

  const handleForceUnlock = async () => {
    if (!isSuperAdmin || !canForceUnlock) {
      return;
    }

    const owner = getPreflightMetadataString(activeLockFailure, 'ownerId');
    const expiresAt = getPreflightMetadataString(activeLockFailure, 'expiresAt');
    const confirmText = owner && expiresAt
      ? `Force unlock active update lock owned by ${owner} (expires ${new Date(expiresAt).toLocaleString()})?`
      : 'Force unlock the active Xray update lock?';

    const confirmed = await requestConfirm({
      title: activeLockIsStale ? 'Unlock stale update lock?' : 'Force unlock active update lock?',
      description: confirmText,
      confirmLabel: activeLockIsStale ? 'Unlock' : 'Force unlock',
      tone: 'danger'
    });
    if (!confirmed) {
      return;
    }

    try {
      const result = await runUpdateUnlockMutation.mutateAsync({
        reason: 'manual-force-unlock-from-settings',
        force: !activeLockIsStale
      });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        result.message || (result.unlocked
          ? t('systemSettings.toast.updateLockReleased', { defaultValue: 'Update lock released.' })
          : t('systemSettings.toast.updateLockNotReleased', { defaultValue: 'Update lock not released.' }))
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('systemSettings.toast.unlockFailed', { defaultValue: 'Failed to unlock update lock.' })
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">System Information</h3>
        {stats ? (
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">CPU Usage:</span>
              <span className="font-medium dark:text-gray-200">{stats.cpu ?? 'N/A'}{typeof stats.cpu === 'number' ? '%' : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Memory Usage:</span>
              <span className="font-medium dark:text-gray-200">{stats.memory ?? 'N/A'}{typeof stats.memory === 'number' ? '%' : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Users:</span>
              <span className="font-medium dark:text-gray-200">{stats.users ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Inbounds:</span>
              <span className="font-medium dark:text-gray-200">{stats.inbounds ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Uptime:</span>
              <span className="font-medium dark:text-gray-200">{stats.uptime || formatUptime(stats.uptimeSeconds)}</span>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Xray Runtime</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Monitor service status and run zero-downtime config reloads.
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
              xrayStatus?.running
                ? 'bg-green-100 text-green-700 dark:bg-green-900/35 dark:text-green-300'
                : 'bg-red-100 text-red-700 dark:bg-red-900/35 dark:text-red-300'
            }`}
          >
            {xrayStatus?.running ? 'Running' : 'Stopped'}
          </span>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Version:</span>
            <span className="font-medium dark:text-gray-200">{xrayStatus?.version || 'unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">Status Updated:</span>
            <span className="font-medium dark:text-gray-200">
              {xrayStatusQuery.isFetching ? 'Refreshing...' : 'Live'}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button
            variant="secondary"
            onClick={refreshXrayStatus}
            loading={xrayStatusQuery.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Status
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void handleReloadConfig();
            }}
            loading={reloadXrayConfigMutation.isPending}
            disabled={restartXrayMutation.isPending}
          >
            <FileCode2 className="mr-2 h-4 w-4" />
            Reload Config
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              void handleRestartXray();
            }}
            loading={restartXrayMutation.isPending}
            disabled={reloadXrayConfigMutation.isPending}
          >
            <Server className="mr-2 h-4 w-4" />
            Restart Xray
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          `Reload Config` validates and reapplies generated config without hard restart. Use `Restart Xray` for binary/runtime issues.
        </p>
      </Card>

      <div id="xray-updates" ref={xrayUpdatesRef}>
        <Card>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Xray Core Updates</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Canary-first rollout with audit logging and Telegram notifications.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/35 dark:text-indigo-300">
              {xrayUpdatePolicy?.defaultChannel || 'stable'} default
            </span>
          </div>

          {!scriptedUpdatesEnabled ? (
            <div className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Runtime mode is <code className="font-mono">{updateRuntimeMode}</code>. Scripted update/rollback actions are disabled.
              Use your host updater flow for Xray-core lifecycle management.
            </div>
          ) : null}

          <div className="mb-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">Runtime Mode</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-gray-200">{updateRuntimeMode.toUpperCase()}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">Preflight</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-gray-200">
                {xrayUpdatePreflight?.ready ? 'Ready' : (xrayUpdatePreflightQuery.isLoading ? 'Checking' : 'Blocked')}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">Blocking Failures</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-gray-200">{blockingPreflightFailures.length}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">Update Lock</p>
              <p className="mt-1 truncate font-semibold text-gray-900 dark:text-gray-200">
                {activeLockFailure ? (activeLockOwner || 'Locked') : 'Unlocked'}
              </p>
            </div>
          </div>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Canary Policy</p>
            <p className="mt-1 font-medium text-gray-900 dark:text-gray-200">
              {xrayUpdatePolicy?.requireCanaryBeforeFull ? 'Required before full rollout' : 'Optional'}
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Window: {xrayUpdatePolicy?.canaryWindowMinutes || 0} minutes
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Last canary: {xrayUpdatePolicy?.lastSuccessfulCanaryAt ? new Date(xrayUpdatePolicy.lastSuccessfulCanaryAt).toLocaleString() : 'none'}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Execution Channel</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={updateChannel === 'stable' ? 'primary' : 'secondary'}
                onClick={() => setUpdateChannel('stable')}
                disabled={runCanaryUpdateMutation.isPending || runFullUpdateMutation.isPending}
              >
                Stable
              </Button>
              <Button
                type="button"
                size="sm"
                variant={updateChannel === 'latest' ? 'primary' : 'secondary'}
                onClick={() => setUpdateChannel('latest')}
                disabled={runCanaryUpdateMutation.isPending || runFullUpdateMutation.isPending}
              >
                Latest
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">Preflight Checks</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Validate script, Docker connectivity, and update lock before rollout.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                  xrayUpdatePreflight?.ready
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/35 dark:text-green-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/35 dark:text-amber-300'
                }`}
              >
                {xrayUpdatePreflight?.ready ? 'Ready' : (xrayUpdatePreflightQuery.isLoading ? 'Checking...' : 'Blocked')}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void xrayUpdatePreflightQuery.refetch();
                }}
                loading={xrayUpdatePreflightQuery.isFetching}
              >
                Run Preflight
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void handleCopyPreflightFixes();
                }}
                disabled={unresolvedFixCommands.length === 0}
              >
                Copy Fixes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void handleRunRuntimeDoctor();
                }}
                loading={runRuntimeDoctorMutation.isPending}
                disabled={updateMutationsBusy}
              >
                {t('updateHealth.runtimeDoctor', { defaultValue: 'Runtime Doctor' })}
              </Button>
              {isSuperAdmin ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    void handleForceUnlock();
                  }}
                  loading={runUpdateUnlockMutation.isPending}
                  disabled={!canForceUnlock || updateMutationsBusy}
                >
                  {activeLockIsStale ? 'Unlock Stale' : 'Force Unlock'}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {(xrayUpdatePreflight?.checks || []).map((check) => {
              const fixes = getPreflightFixCommands(check as XrayUpdatePreflightCheck);
              return (
                <div
                  key={check.id}
                  className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                        {check.label}
                      </p>
                      <p className="break-words whitespace-normal text-sm text-gray-800 dark:text-gray-200">
                        {check.detail || (check.ok ? 'OK' : 'Failed')}
                      </p>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      {check.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className={`text-xs font-semibold ${check.ok ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>
                        {check.ok ? 'PASS' : (check.blocking ? 'FAIL' : 'WARN')}
                      </span>
                    </div>
                  </div>

                  {!check.ok && fixes.length > 0 ? (
                    <details className="mt-2 rounded-md border border-gray-200 p-2 dark:border-gray-700">
                      <summary className="cursor-pointer text-xs font-semibold text-blue-600 dark:text-blue-300">
                        Show fix commands
                      </summary>
                      <div className="mt-2 space-y-1">
                        {fixes.map((line) => (
                          <pre key={`${check.id}-${line}`} className="overflow-x-auto rounded bg-gray-900/95 px-2 py-1 text-[11px] text-gray-100">
                            {line}
                          </pre>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              );
            })}
            {!xrayUpdatePreflightQuery.isLoading && xrayUpdatePreflight && !xrayUpdatePreflight.ready ? (
              <p className="text-xs text-red-600 dark:text-red-300">
                Resolve blocking preflight checks before running canary/full/rollback update operations.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void handleRunCanaryUpdate();
            }}
            loading={runCanaryUpdateMutation.isPending}
            disabled={!scriptedUpdatesEnabled || updateMutationsBusy || updatePreflightBlocked}
          >
            Run Canary
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void handleRunGuidedRollout();
            }}
            loading={guidedRolloutRunning}
            disabled={!scriptedUpdatesEnabled || updateMutationsBusy || updatePreflightBlocked}
          >
            Guided Rollout
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleRunFullUpdate(false);
            }}
            loading={runFullUpdateMutation.isPending}
            disabled={
              !scriptedUpdatesEnabled
              || updateMutationsBusy
              || updatePreflightBlocked
              || (xrayUpdatePolicy?.requireCanaryBeforeFull && !xrayUpdatePolicy?.canaryReady)
            }
          >
            Run Full Rollout
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              void handleRunFullUpdate(true);
            }}
            loading={runFullUpdateMutation.isPending}
            disabled={!scriptedUpdatesEnabled || updateMutationsBusy || updatePreflightBlocked}
          >
            Force Full Rollout
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          Force is for emergency recoveries only. Standard rollout should run canary first.
        </p>

        <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">Rollback</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void xrayRollbackBackupsQuery.refetch();
              }}
              loading={xrayRollbackBackupsQuery.isFetching}
              disabled={!scriptedUpdatesEnabled}
            >
              Refresh Tags
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Select backup tag to roll back immediately to a previous working Xray image.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <select
              value={selectedRollbackTag}
              onChange={(event) => setSelectedRollbackTag(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              disabled={runRollbackMutation.isPending || xrayRollbackBackupsQuery.isLoading || rollbackBackups.length === 0 || updatePreflightBlocked}
            >
              {rollbackBackups.length === 0 ? (
                <option value="">No backup tags available</option>
              ) : (
                rollbackBackups.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))
              )}
            </select>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                void handleRunRollback();
              }}
              loading={runRollbackMutation.isPending}
              disabled={!scriptedUpdatesEnabled || rollbackBackups.length === 0 || updateMutationsBusy || updatePreflightBlocked}
            >
              Run Rollback
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">Update Audit Trail</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void xrayUpdateHistoryQuery.refetch();
              }}
              loading={xrayUpdateHistoryQuery.isFetching}
            >
              Refresh
            </Button>
          </div>
          {xrayUpdateHistoryQuery.isLoading ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading history...</p>
          ) : (
            <>
              <div className="space-y-2">
                {(xrayUpdateHistory?.items || []).map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900 dark:text-gray-200">{entry.message}</p>
                      <p className="text-gray-600 dark:text-gray-400">{new Date(entry.timestamp).toLocaleString()}</p>
                    </div>
                    <p className="mt-1 text-gray-600 dark:text-gray-400">
                      level={entry.level}
                      {entry.metadata && typeof entry.metadata === 'object' && 'actorUsername' in entry.metadata
                        ? ` • actor=${String((entry.metadata as { actorUsername?: unknown }).actorUsername || 'system')}`
                        : ''}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                <span>
                  Page {xrayUpdateHistory?.pagination?.page || 1} / {xrayUpdateHistory?.pagination?.totalPages || 1}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                    disabled={(xrayUpdateHistory?.pagination?.page || 1) <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setHistoryPage((prev) =>
                        Math.min(xrayUpdateHistory?.pagination?.totalPages || prev + 1, prev + 1)
                      )
                    }
                    disabled={(xrayUpdateHistory?.pagination?.page || 1) >= (xrayUpdateHistory?.pagination?.totalPages || 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Xray Release Intelligence</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Live upstream view from XTLS/Xray-core to decide when to run canary/full upgrades.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void handleRefreshReleaseIntel();
            }}
            loading={refreshXrayReleaseIntelMutation.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Release Data
          </Button>
        </div>

        {xrayReleaseIntelQuery.isLoading ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading release intel...</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="text-xs uppercase text-gray-500 dark:text-gray-400">Current Version</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{xrayReleaseIntel?.currentVersion || xrayStatus?.version || 'unknown'}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="text-xs uppercase text-gray-500 dark:text-gray-400">Stable</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{xrayReleaseIntel?.channels?.stable?.tagName || 'n/a'}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {xrayReleaseIntel?.channels?.stable?.needsUpdate ? 'Update available' : 'Up-to-date'}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="text-xs uppercase text-gray-500 dark:text-gray-400">Latest</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{xrayReleaseIntel?.channels?.latest?.tagName || 'n/a'}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {xrayReleaseIntel?.channels?.latest?.publishedAt ? new Date(xrayReleaseIntel.channels.latest.publishedAt).toLocaleString() : 'No release data'}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Config Snapshots</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Create, list, and rollback generated Xray config snapshots directly from the panel.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void handleCreateConfigSnapshot();
            }}
            loading={createXrayConfigSnapshotMutation.isPending}
          >
            Create Snapshot
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <select
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            value={selectedSnapshotId}
            onChange={(event) => setSelectedSnapshotId(event.target.value)}
            disabled={xrayConfigSnapshotsQuery.isLoading || xrayConfigSnapshots.length === 0}
          >
            {xrayConfigSnapshots.length === 0 ? (
              <option value="">No snapshots found</option>
            ) : (
              xrayConfigSnapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {snapshot.id} {snapshot.reason ? `(${snapshot.reason})` : ''}
                </option>
              ))
            )}
          </select>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void handleRollbackConfigSnapshot();
            }}
            loading={rollbackXrayConfigSnapshotMutation.isPending}
            disabled={!selectedSnapshotId || xrayConfigSnapshots.length === 0}
          >
            Rollback Snapshot
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Routing Profile</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Active mode: <span className="font-semibold text-gray-900 dark:text-gray-100">{xrayRoutingProfile?.mode || 'smart'}</span>
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(['smart', 'filtered', 'strict', 'open'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={xrayRoutingProfile?.mode === mode ? 'primary' : 'secondary'}
              onClick={() => {
                void handleSetRoutingMode(mode);
              }}
              loading={updateXrayRoutingProfileMutation.isPending && xrayRoutingProfile?.mode !== mode}
            >
              {mode}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Generated Xray Config</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Inspect the currently generated config JSON directly from One-UI.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowConfigPreview((previous) => !previous)}
            >
              {showConfigPreview ? 'Hide Preview' : 'Show Preview'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void handleCopyConfig();
              }}
              disabled={!showConfigPreview || xrayConfigQuery.isLoading || !xrayConfig}
            >
              <Copy className="mr-2 h-4 w-4" />
              {copiedConfig ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>
        </div>

        {showConfigPreview ? (
          xrayConfigQuery.isLoading ? (
            <div className="py-6 text-sm text-gray-600 dark:text-gray-400">Loading config preview...</div>
          ) : (
            <pre className="max-h-[420px] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              {JSON.stringify(xrayConfig || {}, null, 2)}
            </pre>
          )
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Open preview to inspect inbound, outbound, and routing payload before applying runtime changes.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Geo Files</h3>
        <p className="mb-4 text-gray-600 dark:text-gray-400">
          Update and verify geosite.dat / geoip.dat from configured geodata sources.
        </p>
        <div className="mb-4 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
          <p className="font-medium text-gray-900 dark:text-white">Current Geodata</p>
          <div className="mt-2 space-y-1 text-gray-600 dark:text-gray-400">
            {(xrayGeodataStatus?.files || []).map((file) => (
              <p key={file.key}>
                {file.name}: {file.exists ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : 'missing'}
              </p>
            ))}
          </div>
        </div>
        <Button
          onClick={() => {
            void handleUpdateGeodata();
          }}
          className="w-full"
          variant="secondary"
          loading={updateXrayGeodataMutation.isPending}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Update Geodata Files
        </Button>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Confdir Sync</h3>
        <p className="mb-4 text-gray-600 dark:text-gray-400">
          Export generated config into multi-file <code className="font-mono">conf.d</code> layout for advanced deployments.
        </p>
        <div className="mb-4 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
          <p className="font-medium text-gray-900 dark:text-white">
            Directory: {xrayConfDirStatus?.directory || 'n/a'}
          </p>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Files: {xrayConfDirStatus?.files?.length || 0}
          </p>
        </div>
        <Button
          onClick={() => {
            void handleSyncConfDir();
          }}
          className="w-full"
          variant="secondary"
          loading={syncXrayConfDirMutation.isPending}
        >
          <FileCode2 className="mr-2 h-4 w-4" />
          Sync Confdir
        </Button>
      </Card>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ''}
        description={confirmDialog?.description}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={confirmDialog?.cancelLabel}
        tone={confirmDialog?.tone || 'danger'}
        onCancel={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />
    </div>
  );
};

export default SystemSettings;
