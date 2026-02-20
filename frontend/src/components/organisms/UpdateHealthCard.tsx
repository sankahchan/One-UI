import React from 'react';
import { AlertTriangle, CheckCircle2, Copy, Lock, Settings, Unlock, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useRunXrayRuntimeDoctor, useRunXrayUpdateUnlock, useXrayUpdatePolicy, useXrayUpdatePreflight } from '../../hooks/useXray';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { getPreflightFixCommands, getPreflightMetadataString } from '../../utils/xrayUpdatePreflight';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';
import { ConfirmDialog } from './ConfirmDialog';
import { Spinner } from '../atoms/Spinner';

export const UpdateHealthCard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const admin = useAuthStore((state) => state.admin);
  const canManageUpdates = admin?.role === 'SUPER_ADMIN' || admin?.role === 'ADMIN';
  const canForceUnlock = admin?.role === 'SUPER_ADMIN';
  const policyQuery = useXrayUpdatePolicy();
  const preflightQuery = useXrayUpdatePreflight(canManageUpdates);
  const policy = policyQuery.data;
  const forceUnlockMutation = useRunXrayUpdateUnlock();
  const runtimeDoctorMutation = useRunXrayRuntimeDoctor();
  const preflight = preflightQuery.data;
  const updateRuntimeMode = policy?.mode || preflight?.mode || 'docker';
  const scriptedUpdatesEnabled = policy?.updatesEnabled ?? preflight?.updatesEnabled ?? true;

  const unresolvedChecks = (preflight?.checks || []).filter((check) => !check.ok);
  const hasBlockingFailure = unresolvedChecks.some((check) => check.blocking);
  const lockFailure = unresolvedChecks.find((check) => check.id === 'update-lock');
  const hasUnlockableLock = canForceUnlock && Boolean(lockFailure);

  const activeLockExpiresAt = getPreflightMetadataString(lockFailure, 'expiresAt');
  const activeLockOwner = getPreflightMetadataString(lockFailure, 'ownerId');
  const [showUnlockConfirm, setShowUnlockConfirm] = React.useState(false);
  const preflightGeneratedAt = preflight?.generatedAt ? new Date(preflight.generatedAt).getTime() : Number.NaN;
  const activeLockIsStale = activeLockExpiresAt && Number.isFinite(preflightGeneratedAt)
    ? new Date(activeLockExpiresAt).getTime() <= preflightGeneratedAt
    : false;

  const unresolvedFixCommands = Array.from(
    new Set(
      unresolvedChecks
        .flatMap((check) => getPreflightFixCommands(check))
        .filter((line) => line.trim().length > 0)
    )
  );

  const copyFixes = async () => {
    if (!unresolvedFixCommands.length) {
      return;
    }

    const content = [
      '# One-UI Xray Update Preflight Fixes',
      ...unresolvedFixCommands.map((line) => `- ${line}`)
    ].join('\n');

    try {
      await navigator.clipboard.writeText(content);
      toast.success(
        t('updateHealth.toast.copiedTitle', { defaultValue: 'Copied to clipboard' }),
        t('updateHealth.toast.copiedBody', { defaultValue: 'Preflight fix commands copied.' })
      );
    } catch {
      toast.error(
        t('updateHealth.toast.copyFailedTitle', { defaultValue: 'Copy failed' }),
        t('updateHealth.toast.copyFailedBody', { defaultValue: 'Failed to copy preflight fix commands.' })
      );
    }
  };

  const forceUnlock = async () => {
    if (!hasUnlockableLock) {
      return;
    }

    try {
      const result = await forceUnlockMutation.mutateAsync({
        reason: 'manual-force-unlock-from-dashboard',
        force: !activeLockIsStale
      });
      toast.success(
        t('updateHealth.toast.unlockCompleteTitle', { defaultValue: 'Unlock complete' }),
        result.message || (
          result.unlocked
            ? t('updateHealth.toast.unlockReleasedBody', { defaultValue: 'Update lock released.' })
            : t('updateHealth.toast.unlockNotReleasedBody', { defaultValue: 'Update lock not released.' })
        )
      );
      setShowUnlockConfirm(false);
      await preflightQuery.refetch();
    } catch (error: any) {
      toast.error(
        t('updateHealth.toast.unlockFailedTitle', { defaultValue: 'Unlock failed' }),
        error?.message || t('updateHealth.toast.unlockFailedBody', { defaultValue: 'Failed to unlock update lock.' })
      );
    }
  };

  const runRuntimeDoctor = async () => {
    try {
      const result = await runtimeDoctorMutation.mutateAsync({
        repair: true,
        source: 'dashboard'
      });

      toast.success(
        t('updateHealth.toast.doctorCompleteTitle', { defaultValue: 'Runtime Doctor complete' }),
        t('updateHealth.toast.doctorCompleteBody', {
          defaultValue: 'Applied {{count}} repair action(s).',
          count: result.repairedCount || 0
        })
      );
      await preflightQuery.refetch();
    } catch (error: any) {
      toast.error(
        t('updateHealth.toast.doctorFailedTitle', { defaultValue: 'Runtime Doctor failed' }),
        error?.message || t('updateHealth.toast.doctorFailedBody', { defaultValue: 'Failed to run runtime doctor.' })
      );
    }
  };

  const unlockConfirmDescription = activeLockOwner && activeLockExpiresAt
    ? t('updateHealth.unlockConfirm.withOwner', {
      defaultValue: 'Force unlock active update lock owned by {{owner}} (expires {{expiresAt}})?',
      owner: activeLockOwner,
      expiresAt: new Date(activeLockExpiresAt).toLocaleString()
    })
    : t('updateHealth.unlockConfirm.default', { defaultValue: 'Force unlock the active Xray update lock?' });

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          {t('updateHealth.title', { defaultValue: 'Update Health' })}
        </h2>
        {preflightQuery.isLoading || (canManageUpdates && policyQuery.isLoading) ? (
          <span className="inline-flex items-center rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted">
            {t('updateHealth.checking', { defaultValue: 'Checking...' })}
          </span>
        ) : !canManageUpdates ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted">
            <Lock className="h-3.5 w-3.5" />
            {t('updateHealth.restricted', { defaultValue: 'Restricted' })}
          </span>
        ) : !scriptedUpdatesEnabled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
            <Settings className="h-3.5 w-3.5" />
            {t('updateHealth.manualMode', { defaultValue: 'Manual Mode' })}
          </span>
        ) : preflight?.ready ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('updateHealth.ready', { defaultValue: 'Ready' })}
          </span>
        ) : lockFailure ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300">
            <Lock className="h-3.5 w-3.5" />
            {t('updateHealth.locked', { defaultValue: 'Locked' })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('updateHealth.needsFix', { defaultValue: 'Needs Fix' })}
          </span>
        )}
      </div>

      {preflightQuery.isLoading || (canManageUpdates && policyQuery.isLoading) ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : !canManageUpdates ? (
        <>
          <p className="text-sm text-muted">
            {t('updateHealth.body.restricted', {
              defaultValue: 'Update tooling is available for ADMIN and SUPER_ADMIN roles.'
            })}
          </p>
          <div className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/settings?tab=system&section=xray-updates')}
            >
              <Settings className="mr-2 h-4 w-4" />
              {t('updateHealth.openSettings', { defaultValue: 'Open Settings' })}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {!scriptedUpdatesEnabled
              ? t('updateHealth.body.scriptedDisabled', {
                defaultValue: 'Runtime mode is {{mode}}. Scripted container update actions are disabled.',
                mode: updateRuntimeMode
              })
              : preflight?.ready
              ? t('updateHealth.body.ready', { defaultValue: 'All required checks passed. You can run canary/full rollout safely.' })
              : lockFailure
                ? t('updateHealth.body.locked', { defaultValue: 'Xray update lock is active. Resolve lock state before running updates.' })
                : hasBlockingFailure
                  ? t('updateHealth.body.blockingFailure', { defaultValue: 'One or more required checks are failing. Apply fixes before rollout.' })
                  : t('updateHealth.body.reviewWarnings', { defaultValue: 'Review warnings before rollout.' })}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void preflightQuery.refetch();
              }}
              loading={preflightQuery.isFetching}
            >
              <Wrench className="mr-2 h-4 w-4" />
              {t('updateHealth.runPreflight', { defaultValue: 'Run Preflight' })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void copyFixes();
              }}
              disabled={unresolvedFixCommands.length === 0 || runtimeDoctorMutation.isPending}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t('updateHealth.copyFixes', { defaultValue: 'Copy Fixes' })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void runRuntimeDoctor();
              }}
              loading={runtimeDoctorMutation.isPending}
              disabled={forceUnlockMutation.isPending}
            >
              <Wrench className="mr-2 h-4 w-4" />
              {t('updateHealth.runtimeDoctor', { defaultValue: 'Runtime Doctor' })}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setShowUnlockConfirm(true);
              }}
              loading={forceUnlockMutation.isPending}
              disabled={!hasUnlockableLock}
            >
              <Unlock className="mr-2 h-4 w-4" />
              {t('updateHealth.forceUnlock', { defaultValue: 'Force Unlock' })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/settings?tab=system&section=xray-updates')}
            >
              <Settings className="mr-2 h-4 w-4" />
              {t('updateHealth.openUpdates', { defaultValue: 'Open Updates' })}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={showUnlockConfirm}
        title={t('updateHealth.unlockTitle', { defaultValue: 'Force Unlock Update Lock' })}
        description={unlockConfirmDescription}
        confirmLabel={t('updateHealth.forceUnlock', { defaultValue: 'Force Unlock' })}
        tone="danger"
        loading={forceUnlockMutation.isPending}
        onCancel={() => {
          if (!forceUnlockMutation.isPending) {
            setShowUnlockConfirm(false);
          }
        }}
        onConfirm={() => {
          void forceUnlock();
        }}
      />
    </Card>
  );
};
