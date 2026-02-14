import { Fragment, useEffect, useState, type FC, type MouseEvent } from 'react';
import { ChevronDown, ChevronUp, MoreVertical } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { ConfirmDialog } from './ConfirmDialog';
import apiClient from '../../api/client';
import { formatBytes, formatDateTime, getDaysRemaining } from '../../utils/formatters';
import type { User, UserSessionSnapshot } from '../../types';

interface UserDevicesInlinePanelProps {
  userId: number;
}

const UserDevicesInlinePanel: FC<UserDevicesInlinePanelProps> = ({ userId }) => {
  const queryClient = useQueryClient();
  const [pendingRevokeFingerprint, setPendingRevokeFingerprint] = useState<string | null>(null);

  const devicesQuery = useQuery({
    queryKey: ['user-devices', userId, 60],
    queryFn: async () => {
      const response = await apiClient.get(`/users/${userId}/devices`, {
        params: { windowMinutes: 60 }
      });
      return response.data;
    },
    staleTime: 10_000
  });

  const revokeMutation = useMutation({
    mutationFn: async (fingerprint: string) => {
      await apiClient.delete(`/users/${userId}/devices/${encodeURIComponent(fingerprint)}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['user-devices', userId, 60] });
      await queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    }
  });

  const devices = devicesQuery.data?.devices || [];

  if (devicesQuery.isLoading) {
    return <p className="text-xs text-muted">Loading active devices...</p>;
  }

  if (devices.length === 0) {
    return <p className="text-xs text-muted">No devices tracked in the last 60 minutes.</p>;
  }

  return (
    <div className="space-y-2">
      {devices.slice(0, 6).map((device: any) => (
        <div
          key={device.fingerprint}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/60 bg-card/70 px-3 py-2 text-xs"
        >
          <div className="min-w-0">
            <p className="font-mono text-foreground">{device.shortFingerprint || device.fingerprint.slice(0, 10)}</p>
            <p className="text-muted">
              {device.clientIp || 'unknown IP'} • {device.online ? 'Online' : `Last ${formatDateTime(device.lastSeenAt)}`}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            loading={revokeMutation.isPending}
            onClick={() => {
              setPendingRevokeFingerprint(device.fingerprint);
            }}
          >
            Revoke
          </Button>
        </div>
      ))}

      <ConfirmDialog
        open={Boolean(pendingRevokeFingerprint)}
        title="Revoke Device Session"
        description="This device will be disconnected and must refresh subscription before reconnecting."
        confirmLabel="Revoke"
        tone="danger"
        loading={revokeMutation.isPending}
        onCancel={() => {
          if (!revokeMutation.isPending) {
            setPendingRevokeFingerprint(null);
          }
        }}
        onConfirm={() => {
          if (!pendingRevokeFingerprint) {
            return;
          }
          void revokeMutation.mutateAsync(pendingRevokeFingerprint).finally(() => {
            setPendingRevokeFingerprint(null);
          });
        }}
      />
    </div>
  );
};

interface UserTableProps {
  users: User[];
  viewMode?: 'auto' | 'table' | 'cards';
  onlineUuidSet?: Set<string>;
  onView: (user: User) => void;
  onPrefetch?: (user: User) => void;
  onDelete?: (userId: number) => void;
  onQuickQr?: (user: User) => void;
  onQuickEdit?: (user: User) => void;
  onRotateKeys?: (user: User) => void;
  onRevokeKeys?: (user: User) => void;
  onDisconnectSessions?: (user: User) => void;
  onRegenerateSubscription?: (user: User) => void;
  onResetTraffic?: (user: User) => void;
  onExtendExpiry?: (user: User, days: number) => void;
  onDisableUser?: (user: User) => void;
  onCopySubscription?: (user: User) => void;
  onUpdateLimits?: (user: User, updates: { ipLimit?: number; deviceLimit?: number }) => void;
  selectedUserIds?: number[];
  onSelectionChange?: (userIds: number[]) => void;
  sessionsByUserId?: Record<number, UserSessionSnapshot>;
}

export const UserTable: FC<UserTableProps> = ({
  users,
  viewMode = 'auto',
  onlineUuidSet = new Set<string>(),
  onView,
  onPrefetch,
  onDelete,
  onQuickQr,
  onQuickEdit,
  onRotateKeys,
  onRevokeKeys,
  onDisconnectSessions,
  onRegenerateSubscription,
  onResetTraffic,
  onExtendExpiry,
  onDisableUser,
  onCopySubscription,
  onUpdateLimits,
  selectedUserIds = [],
  onSelectionChange,
  sessionsByUserId = {}
}) => {
  const RENDER_BATCH_SIZE = 80;
  const [expandedUserIds, setExpandedUserIds] = useState<number[]>([]);
  const [renderedCount, setRenderedCount] = useState(() => Math.min(users.length, RENDER_BATCH_SIZE));
  const isAllSelected = users.length > 0 && selectedUserIds.length === users.length;
  const isSomeSelected = selectedUserIds.length > 0 && selectedUserIds.length < users.length;

  useEffect(() => {
    setRenderedCount(Math.min(users.length, RENDER_BATCH_SIZE));
  }, [users.length]);

  useEffect(() => {
    if (renderedCount >= users.length) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setRenderedCount((current) => Math.min(users.length, current + RENDER_BATCH_SIZE));
    }, 32);

    return () => {
      window.clearTimeout(timer);
    };
  }, [renderedCount, users.length]);

  const visibleUsers = users.slice(0, renderedCount);

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (isAllSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(users.map((user) => user.id));
    }
  };

  const handleSelectUser = (userId: number) => {
    if (!onSelectionChange) return;
    if (selectedUserIds.includes(userId)) {
      onSelectionChange(selectedUserIds.filter((id) => id !== userId));
    } else {
      onSelectionChange([...selectedUserIds, userId]);
    }
  };

  const toggleExpanded = (userId: number) => {
    setExpandedUserIds((previous) => (
      previous.includes(userId) ? previous.filter((id) => id !== userId) : [...previous, userId]
    ));
  };
  const cardsContainerClass = viewMode === 'auto' ? 'space-y-3 md:hidden' : viewMode === 'cards' ? 'space-y-3' : 'hidden';
  const tableContainerClass = viewMode === 'auto' ? 'hidden overflow-x-auto md:block' : viewMode === 'table' ? 'overflow-x-auto' : 'hidden';

  const getStatusBadge = (status: string) => {
    const variants = {
      ACTIVE: 'success',
      EXPIRED: 'danger',
      DISABLED: 'warning',
      LIMITED: 'warning'
    } as const;

    return <Badge variant={variants[status as keyof typeof variants] || 'info'}>{status}</Badge>;
  };

  const renderOnlinePill = (isOnline: boolean) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        isOnline
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
      }`}
    >
      <span className="relative inline-flex h-2.5 w-2.5">
        {isOnline ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
        ) : null}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
            isOnline ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-gray-500'
          }`}
        />
      </span>
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );

  const getLastSeenLabel = (session?: UserSessionSnapshot) => {
    if (!session?.lastSeenAt) {
      return 'No activity';
    }

    const timestamp = new Date(session.lastSeenAt).getTime();
    if (Number.isNaN(timestamp)) {
      return 'No activity';
    }

    const elapsedMinutes = Math.floor((Date.now() - timestamp) / 60_000);
    if (elapsedMinutes < 1) {
      return 'just now';
    }

    if (elapsedMinutes < 60) {
      return `${elapsedMinutes}m ago`;
    }

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) {
      return `${elapsedHours}h ago`;
    }

    const elapsedDays = Math.floor(elapsedHours / 24);
    return `${elapsedDays}d ago`;
  };

  const getSessionMetaLabel = (session?: UserSessionSnapshot) => {
    if (!session) {
      return '';
    }

    const inboundTag = session.currentInbound?.tag || '';
    const ip = session.currentIp || '';
    if (inboundTag && ip) {
      return `${inboundTag} • ${ip}`;
    }
    if (inboundTag) {
      return inboundTag;
    }
    if (ip) {
      return ip;
    }
    return '';
  };

  const closeActionMenu = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    const details = element?.closest('details') as HTMLDetailsElement | null;
    if (details) {
      details.open = false;
    }
  };

  const runAction = (
    event: MouseEvent<HTMLButtonElement>,
    action: (() => void) | undefined
  ) => {
    event.preventDefault();
    if (action) {
      action();
    }
    closeActionMenu(event.currentTarget);
  };

  const renderActionMenu = (user: User, mobile = false) => {
    const items: Array<{ key: string; label: string; tone?: 'default' | 'danger'; onClick: () => void }> = [];

    if (onQuickQr) items.push({ key: 'qr', label: 'Show QR', onClick: () => onQuickQr(user) });
    if (onQuickEdit) items.push({ key: 'edit', label: 'Quick Edit', onClick: () => onQuickEdit(user) });
    if (!onQuickEdit && onUpdateLimits) {
      items.push({
        key: 'limits',
        label: 'Increase limits',
        onClick: () =>
          onUpdateLimits(user, {
            ipLimit: Number(user.ipLimit || 0) + 1,
            deviceLimit: Number(user.deviceLimit || 0) + 1
          })
      });
    }
    if (onCopySubscription) items.push({ key: 'copy-sub', label: 'Copy Subscription', onClick: () => onCopySubscription(user) });
    if (onRegenerateSubscription) {
      items.push({ key: 'regen-token', label: 'Regenerate Token', onClick: () => onRegenerateSubscription(user) });
    }
    if (onExtendExpiry) {
      items.push({ key: 'extend7', label: 'Extend +7 Days', onClick: () => onExtendExpiry(user, 7) });
      items.push({ key: 'extend30', label: 'Extend +30 Days', onClick: () => onExtendExpiry(user, 30) });
    }
    if (onResetTraffic) items.push({ key: 'reset-traffic', label: 'Reset Traffic', onClick: () => onResetTraffic(user) });
    if (onDisconnectSessions) items.push({ key: 'disconnect', label: 'Disconnect Sessions', onClick: () => onDisconnectSessions(user) });
    if (onRotateKeys) items.push({ key: 'rotate', label: 'Rotate Credentials', onClick: () => onRotateKeys(user) });
    if (onRevokeKeys) items.push({ key: 'revoke', label: 'Revoke Access', onClick: () => onRevokeKeys(user) });
    if (onDisableUser) items.push({ key: 'disable', label: 'Disable User', onClick: () => onDisableUser(user) });
    if (onDelete) items.push({ key: 'delete', label: 'Delete User', tone: 'danger', onClick: () => onDelete(user.id) });

    if (items.length === 0) {
      return null;
    }

    return (
      <details className="relative">
        <summary
          className={`list-none cursor-pointer rounded-lg border border-line/60 bg-card/70 px-2 py-1 text-foreground transition hover:bg-panel/70 [&::-webkit-details-marker]:hidden ${
            mobile ? 'inline-flex h-10 w-10 items-center justify-center' : 'inline-flex h-8 w-8 items-center justify-center'
          }`}
          aria-label="More actions"
          title="More actions"
        >
          <span className="inline-flex items-center">
            <MoreVertical className="h-4 w-4" />
          </span>
        </summary>
        <div
          className={`absolute right-0 z-20 mt-2 w-56 rounded-xl border border-line/70 bg-card/95 p-1 shadow-lg shadow-black/10 backdrop-blur-sm ${
            mobile ? '' : 'origin-top-right'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`flex w-full items-center justify-start rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                item.tone === 'danger'
                  ? 'text-red-500 hover:bg-red-500/10'
                  : 'text-foreground hover:bg-panel/70'
              }`}
              onClick={(event) => runAction(event, item.onClick)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </details>
    );
  };

  return (
    <div className="space-y-3">
      <div className={cardsContainerClass}>
        {onSelectionChange ? (
          <div className="flex items-center justify-between rounded-xl border border-line/70 bg-card/75 px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isAllSelected}
                ref={(el) => {
                  if (el) el.indeterminate = isSomeSelected;
                }}
                onChange={handleSelectAll}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
              />
              Select all
            </label>
            <span className="text-xs text-muted">{selectedUserIds.length} selected</span>
          </div>
        ) : null}

        {visibleUsers.map((user) => {
          const uploadUsed = Number(user.uploadUsed || 0);
          const downloadUsed = Number(user.downloadUsed || 0);
          const dataLimit = Number(user.dataLimit || 0);
          const totalUsed = uploadUsed + downloadUsed;
          const usagePercent = dataLimit > 0 ? ((totalUsed / dataLimit) * 100).toFixed(1) : '0.0';
          const isDeferredExpiry = Boolean(user.startOnFirstUse) && !user.firstUsedAt;
          const deferredDays = isDeferredExpiry
            ? Math.max(
                1,
                Math.ceil((new Date(user.expireDate).getTime() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
              )
            : null;
          const daysRemaining = isDeferredExpiry ? deferredDays || 0 : getDaysRemaining(user.expireDate);
          const session = sessionsByUserId[user.id];
          const isOnline = session?.online ?? onlineUuidSet.has(user.uuid);
          const activeKeyCount = Number.isFinite(session?.activeKeyCount)
            ? Number(session?.activeKeyCount)
            : Number(user.inbounds?.length || 0);
          const onlineKeyCount = Number.isFinite(session?.onlineKeyCount)
            ? Number(session?.onlineKeyCount)
            : isOnline
            ? Math.min(1, activeKeyCount || 1)
            : 0;
          const sessionMeta = getSessionMetaLabel(session);
          const lastSeenLabel = getLastSeenLabel(session);

          return (
            <div
              key={`mobile-${user.id}`}
              className="rounded-xl border border-line/70 bg-card/80 p-4"
              onMouseEnter={() => onPrefetch?.(user)}
              onFocus={() => onPrefetch?.(user)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="truncate text-left text-sm font-medium text-foreground transition hover:text-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                    onClick={() => onView(user)}
                  >
                    {user.email}
                  </button>
                  <p className="font-mono text-xs text-muted">{user.uuid.substring(0, 8)}...</p>
                </div>

                <div className="flex items-center gap-2">
                  {onSelectionChange ? (
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.id)}
                      onChange={() => handleSelectUser(user.id)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                  ) : null}
                  {renderActionMenu(user, true)}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {getStatusBadge(user.status)}
                {renderOnlinePill(isOnline)}
                <span className="text-xs text-muted">
                  Keys {onlineKeyCount}/{activeKeyCount || 0} active
                </span>
                <span className="text-xs text-muted">IP {Number(user.ipLimit || 0)}</span>
                <span className="text-xs text-muted">DEV {Number(user.deviceLimit || 0)}</span>
                {sessionMeta ? (
                  <span className="text-xs text-muted">{sessionMeta}</span>
                ) : null}
                {!isOnline ? <span className="text-xs text-muted">Last seen {lastSeenLabel}</span> : null}
              </div>

              <div className="mt-3 space-y-2">
                <p className="text-xs text-foreground">
                  {formatBytes(totalUsed)} / {formatBytes(dataLimit)}
                </p>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-2 rounded-full ${
                      Number.parseFloat(usagePercent) > 90
                        ? 'bg-red-600'
                        : Number.parseFloat(usagePercent) > 70
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                    }`}
                    style={{
                      width: `${Math.min(Number.parseFloat(usagePercent), 100)}%`
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{usagePercent}% used</span>
                  {isDeferredExpiry ? (
                    <span className="text-amber-600 dark:text-amber-400">
                      Starts on first connect (+{deferredDays}d)
                    </span>
                  ) : (
                    <span className={daysRemaining < 7 ? 'text-red-600 dark:text-red-400' : ''}>
                      {daysRemaining > 0 ? `${daysRemaining} days left` : 'Expired'}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => toggleExpanded(user.id)}
                className="mt-3 flex w-full items-center justify-between rounded-xl border border-line/60 bg-panel/35 px-4 py-3 text-left text-sm text-foreground transition hover:bg-panel/55"
                aria-label={expandedUserIds.includes(user.id) ? 'Hide devices' : 'Show devices'}
              >
                <span className="font-medium">Devices</span>
                {expandedUserIds.includes(user.id) ? (
                  <ChevronUp className="h-4 w-4 text-brand-500" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-brand-500" />
                )}
              </button>

              {expandedUserIds.includes(user.id) ? (
                <div className="mt-3 rounded-lg border border-line/60 bg-panel/50 p-3">
                  <UserDevicesInlinePanel userId={user.id} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className={tableContainerClass}>
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
            <tr>
              {onSelectionChange && (
                <th className="w-12 px-6 py-3">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomeSelected;
                    }}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                  />
                </th>
              )}
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Online</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Data Usage
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Limits</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Expiry</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Devices</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
            {visibleUsers.map((user) => {
              const uploadUsed = Number(user.uploadUsed || 0);
              const downloadUsed = Number(user.downloadUsed || 0);
              const dataLimit = Number(user.dataLimit || 0);

              const totalUsed = uploadUsed + downloadUsed;
              const usagePercent = dataLimit > 0 ? ((totalUsed / dataLimit) * 100).toFixed(1) : '0.0';
              const isDeferredExpiry = Boolean(user.startOnFirstUse) && !user.firstUsedAt;
              const deferredDays = isDeferredExpiry
                ? Math.max(
                    1,
                    Math.ceil((new Date(user.expireDate).getTime() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
                  )
                : null;
              const daysRemaining = isDeferredExpiry ? deferredDays || 0 : getDaysRemaining(user.expireDate);
              const session = sessionsByUserId[user.id];
              const isOnline = session?.online ?? onlineUuidSet.has(user.uuid);
              const activeKeyCount = Number.isFinite(session?.activeKeyCount)
                ? Number(session?.activeKeyCount)
                : Number(user.inbounds?.length || 0);
              const onlineKeyCount = Number.isFinite(session?.onlineKeyCount)
                ? Number(session?.onlineKeyCount)
                : isOnline
                ? Math.min(1, activeKeyCount || 1)
                : 0;
              const sessionMeta = getSessionMetaLabel(session);
              const lastSeenLabel = getLastSeenLabel(session);

              return (
                <Fragment key={user.id}>
                <tr
                  className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onMouseEnter={() => onPrefetch?.(user)}
                >
                  {onSelectionChange && (
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={() => handleSelectUser(user.id)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className="text-left text-sm font-medium text-gray-900 transition hover:text-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:text-white"
                        onClick={() => onView(user)}
                      >
                        {user.email}
                      </button>
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{user.uuid.substring(0, 8)}...</span>
                    </div>
                  </td>

                  <td className="px-6 py-4">{getStatusBadge(user.status)}</td>

                  <td className="px-6 py-4">
                    {renderOnlinePill(isOnline)}
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Keys {onlineKeyCount}/{activeKeyCount || 0} active
                    </p>
                    {sessionMeta ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sessionMeta}</p> : null}
                    {!isOnline ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Last seen {lastSeenLabel}</p> : null}
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm text-gray-900 dark:text-white">
                        {formatBytes(totalUsed)} / {formatBytes(dataLimit)}
                      </span>
                      <div className="mt-1 h-2 w-32 rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className={`h-2 rounded-full ${
                            Number.parseFloat(usagePercent) > 90
                              ? 'bg-red-600'
                              : Number.parseFloat(usagePercent) > 70
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                          }`}
                          style={{
                            width: `${Math.min(Number.parseFloat(usagePercent), 100)}%`
                          }}
                        />
                      </div>
                      <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">{usagePercent}% used</span>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-muted">IP</span>
                        <span className="font-semibold text-foreground">{Number(user.ipLimit || 0)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted">DEV</span>
                        <span className="font-semibold text-foreground">{Number(user.deviceLimit || 0)}</span>
                      </div>
                      {/* Edit in "More actions" to keep the row clean */}
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm text-gray-900 dark:text-white">
                        {isDeferredExpiry ? 'Starts on first connect' : new Date(user.expireDate).toLocaleDateString()}
                      </span>
                      {isDeferredExpiry ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          {deferredDays} days after first connect
                        </span>
                      ) : (
                        <span
                          className={`text-xs ${
                            daysRemaining < 7
                              ? 'text-red-600 dark:text-red-400'
                              : daysRemaining < 30
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {daysRemaining > 0 ? `${daysRemaining} days left` : 'Expired'}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpanded(user.id)}
                      aria-label={expandedUserIds.includes(user.id) ? 'Hide devices' : 'Show devices'}
                    >
                      {expandedUserIds.includes(user.id) ? (
                        <ChevronUp className="h-4 w-4 text-brand-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-brand-500" />
                      )}
                    </Button>
                  </td>

                  <td className="px-6 py-4">
                    {renderActionMenu(user)}
                  </td>
                </tr>
                {expandedUserIds.includes(user.id) ? (
                  <tr className="bg-panel/45">
                    <td
                      colSpan={(onSelectionChange ? 1 : 0) + 8}
                      className="px-6 py-4"
                    >
                      <UserDevicesInlinePanel userId={user.id} />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {renderedCount < users.length ? (
        <div className="flex items-center justify-center rounded-xl border border-line/60 bg-card/60 px-3 py-2 text-xs text-muted">
          Rendering {renderedCount} of {users.length} users...
        </div>
      ) : null}
    </div>
  );
};
