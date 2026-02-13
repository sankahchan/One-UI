import React from 'react';
import { AlertTriangle, CheckCircle2, Copy, Lock, Settings, Unlock, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useRunXrayUpdateUnlock, useXrayUpdatePolicy, useXrayUpdatePreflight } from '../../hooks/useXray';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { getPreflightFixCommands, getPreflightMetadataString } from '../../utils/xrayUpdatePreflight';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';
import { ConfirmDialog } from './ConfirmDialog';
import { Spinner } from '../atoms/Spinner';

export const UpdateHealthCard: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const admin = useAuthStore((state) => state.admin);
  const canManageUpdates = admin?.role === 'SUPER_ADMIN' || admin?.role === 'ADMIN';
  const canForceUnlock = admin?.role === 'SUPER_ADMIN';
  const policyQuery = useXrayUpdatePolicy();
  const preflightQuery = useXrayUpdatePreflight(canManageUpdates);
  const policy = policyQuery.data;
  const forceUnlockMutation = useRunXrayUpdateUnlock();
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
      toast.success('Copied to clipboard', 'Preflight fix commands copied.');
    } catch {
      toast.error('Copy failed', 'Failed to copy preflight fix commands.');
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
        'Unlock complete',
        result.message || (result.unlocked ? 'Update lock released.' : 'Update lock not released.')
      );
      setShowUnlockConfirm(false);
      await preflightQuery.refetch();
    } catch (error: any) {
      toast.error('Unlock failed', error?.message || 'Failed to unlock update lock.');
    }
  };

  const unlockConfirmDescription = activeLockOwner && activeLockExpiresAt
    ? `Force unlock active update lock owned by ${activeLockOwner} (expires ${new Date(activeLockExpiresAt).toLocaleString()})?`
    : 'Force unlock the active Xray update lock?';

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Update Health</h2>
        {preflightQuery.isLoading || (canManageUpdates && policyQuery.isLoading) ? (
          <span className="inline-flex items-center rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted">
            Checking...
          </span>
        ) : !canManageUpdates ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted">
            <Lock className="h-3.5 w-3.5" />
            Restricted
          </span>
        ) : !scriptedUpdatesEnabled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
            <Settings className="h-3.5 w-3.5" />
            Manual Mode
          </span>
        ) : preflight?.ready ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready
          </span>
        ) : lockFailure ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300">
            <Lock className="h-3.5 w-3.5" />
            Locked
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Needs Fix
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
            Update tooling is available for <code>ADMIN</code> and <code>SUPER_ADMIN</code> roles.
          </p>
          <div className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/settings?tab=system&section=xray-updates')}
            >
              <Settings className="mr-2 h-4 w-4" />
              Open Settings
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {!scriptedUpdatesEnabled
              ? `Runtime mode is ${updateRuntimeMode}. Scripted container update actions are disabled.`
              : preflight?.ready
              ? 'All required checks passed. You can run canary/full rollout safely.'
              : lockFailure
                ? 'Xray update lock is active. Resolve lock state before running updates.'
                : hasBlockingFailure
                  ? 'One or more required checks are failing. Apply fixes before rollout.'
                  : 'Review warnings before rollout.'}
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
              Run Preflight
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void copyFixes();
              }}
              disabled={unresolvedFixCommands.length === 0}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Fixes
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
              Force Unlock
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/settings?tab=system&section=xray-updates')}
            >
              <Settings className="mr-2 h-4 w-4" />
              Open Updates
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={showUnlockConfirm}
        title="Force Unlock Update Lock"
        description={unlockConfirmDescription}
        confirmLabel="Force Unlock"
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
