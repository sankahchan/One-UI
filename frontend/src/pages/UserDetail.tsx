import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  CheckCircle,
  Copy,
  Edit,
  ExternalLink,
  FileCode2,
  GripVertical,
  MoreVertical,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Trash2
} from 'lucide-react';

import apiClient from '../api/client';
import { Badge } from '../components/atoms/Badge';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { ConfirmDialog } from '../components/organisms/ConfirmDialog';
import { InboundClientProfileModal } from '../components/organisms/InboundClientProfileModal';
import { MyanmarPriorityPreviewModal } from '../components/organisms/MyanmarPriorityPreviewModal';
import { Skeleton } from '../components/atoms/Skeleton';
import { UserFormModal } from '../components/organisms/UserFormModal';
import { useToast } from '../hooks/useToast';
import { useUserEffectiveInbounds, useUserEffectivePolicy } from '../hooks/useGroups';
import {
  useDeleteUser,
  useResetTraffic,
  useReorderUserInbounds,
  useRevokeUserDevice,
  useToggleUserInbound,
  useUpdateUserInboundPriority,
  useUser,
  useUserDevices,
  useUserSessions
} from '../hooks/useUsers';
import { usersApi, type UserInboundPatternPreviewEntry } from '../api/users';
import type { Inbound, UserInbound } from '../types';
import { formatBytes, formatDate } from '../utils/formatters';

const TrafficChart = React.lazy(() =>
  import('../components/organisms/TrafficChart').then((m) => ({ default: m.TrafficChart }))
);
const UserActivityTimeline = React.lazy(() =>
  import('../components/organisms/UserActivityTimeline').then((m) => ({ default: m.UserActivityTimeline }))
);
const SubscriptionLinksPanel = React.lazy(() =>
  import('../components/organisms/SubscriptionLinksPanel').then((m) => ({ default: m.SubscriptionLinksPanel }))
);

const ChunkSkeleton: React.FC = () => (
  <Card>
    <div className="space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full" />
    </div>
  </Card>
);

interface TemplateShape {
  id?: string;
  content?: string;
}

type AccessKeyFilter = 'all' | 'enabled' | 'disabled' | 'online' | 'offline';
type AccessKeySortField = 'key' | 'protocol' | 'port' | 'priority' | 'enabled' | 'online' | 'expiration';
type AccessKeySortDirection = 'asc' | 'desc';
type AccessKeyDensity = 'compact' | 'comfortable';

interface AccessKeyRow {
  relation: UserInbound;
  index: number;
  label: string;
  protocol: string;
  port: number;
  priority: number;
  enabled: boolean;
  online: boolean;
  lastSeenAt: string | null;
  onlineDevices: number;
  seenDevices: number;
  expirationDays: number;
}

type PendingUserConfirm =
  | { type: 'reset-traffic' }
  | { type: 'delete-user' }
  | { type: 'revoke-device'; fingerprint: string }
  | null;

const REFRESH_OPTIONS = [
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: 'Manual', value: 0 }
];

const getRelativeLastSeenLabel = (isOnline: boolean, lastActivity: string | null, nowTimestamp: number) => {
  if (isOnline) {
    return 'Live now';
  }

  if (!lastActivity) {
    return 'No recent activity';
  }

  const lastSeenAt = new Date(lastActivity).getTime();
  if (Number.isNaN(lastSeenAt)) {
    return 'No recent activity';
  }

  const elapsedMs = Math.max(0, nowTimestamp - lastSeenAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedMinutes < 1) {
    return 'Last seen just now';
  }

  if (elapsedMinutes < 60) {
    return `Last seen ${elapsedMinutes}m ago`;
  }

  if (elapsedHours < 24) {
    return `Last seen ${elapsedHours}h ago`;
  }

  return `Last seen ${elapsedDays}d ago`;
};

export const UserDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [showEditModal, setShowEditModal] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingUserConfirm>(null);
  const [profileInbound, setProfileInbound] = useState<Inbound | null>(null);
  const [togglingInboundId, setTogglingInboundId] = useState<number | null>(null);
  const [copyingKeyInboundId, setCopyingKeyInboundId] = useState<number | null>(null);
  const [updatingPriorityInboundId, setUpdatingPriorityInboundId] = useState<number | null>(null);
  const [isReorderingByDrag, setIsReorderingByDrag] = useState(false);
  const [isApplyingMyanmarPriority, setIsApplyingMyanmarPriority] = useState(false);
  const [draggingInboundId, setDraggingInboundId] = useState<number | null>(null);
  const [dragOverInboundId, setDragOverInboundId] = useState<number | null>(null);
  const [nowTimestamp, setNowTimestamp] = useState<number>(() => Date.now());
  const [refreshInterval, setRefreshInterval] = useState<number>(10000);
  const [accessKeyFilter, setAccessKeyFilter] = useState<AccessKeyFilter>('all');
  const [sortField, setSortField] = useState<AccessKeySortField>('priority');
  const [sortDirection, setSortDirection] = useState<AccessKeySortDirection>('asc');
  const [accessKeyDensity, setAccessKeyDensity] = useState<AccessKeyDensity>('comfortable');
  const [myanmarPreviewState, setMyanmarPreviewState] = useState<{
    totalKeys: number;
    matchedKeys: number;
    changedKeys: number;
    currentTop3: UserInboundPatternPreviewEntry[];
    newTop3: UserInboundPatternPreviewEntry[];
  } | null>(null);

  const userId = Number.parseInt(id || '', 10);
  const { data, isLoading, refetch } = useUser(userId);
  const userDevicesQuery = useUserDevices(userId, 60, {
    refetchInterval: refreshInterval === 0 ? false : refreshInterval,
    staleTime: 5_000
  });
  const effectiveInboundsQuery = useUserEffectiveInbounds(userId);
  const effectivePolicyQuery = useUserEffectivePolicy(userId);
  const resetTraffic = useResetTraffic();
  const deleteUser = useDeleteUser();
  const revokeUserDevice = useRevokeUserDevice();
  const toggleUserInbound = useToggleUserInbound();
  const updateInboundPriority = useUpdateUserInboundPriority();
  const reorderUserInbounds = useReorderUserInbounds();
  const userSessionQuery = useUserSessions(
    Number.isInteger(userId) && userId > 0 ? [userId] : [],
    {
      includeOffline: true,
      live: refreshInterval !== 0,
      refetchInterval: refreshInterval === 0 ? false : refreshInterval,
      staleTime: 5_000,
      streamInterval: 2000
    }
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTimestamp(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const user = data?.data ?? null;
  const session = useMemo(
    () => (userSessionQuery.data?.sessions || []).find((entry) => entry.userId === userId) || null,
    [userSessionQuery.data?.sessions, userId]
  );
  const effectiveInboundsPayload = effectiveInboundsQuery.data?.data;
  const effectivePolicyPayload = effectivePolicyQuery.data?.data;
  const dataLimit = Number(user?.dataLimit || 0);
  const uploadUsed = Number(user?.uploadUsed || 0);
  const downloadUsed = Number(user?.downloadUsed || 0);
  const totalUsed = Number(user?.totalUsed ?? uploadUsed + downloadUsed);
  const remaining = Number(user?.remaining ?? Math.max(0, dataLimit - totalUsed));
  const remainingPercent = Number(user?.remainingPercent ?? (dataLimit > 0 ? (remaining / dataLimit) * 100 : 0));
  const usagePercent = dataLimit > 0 ? Math.min((totalUsed / dataLimit) * 100, 100) : 0;
  const daysRemaining = Number(
    user?.daysRemaining ?? Math.ceil((new Date(user?.expireDate || nowTimestamp).getTime() - nowTimestamp) / (1000 * 60 * 60 * 24))
  );
  const isDeferredExpiry = Boolean(user?.startOnFirstUse) && !user?.firstUsedAt;

  const isUserOnline = Boolean(session?.online);
  const lastSeenLabel = useMemo(
    () => getRelativeLastSeenLabel(isUserOnline, session?.lastSeenAt ?? null, nowTimestamp),
    [isUserOnline, nowTimestamp, session?.lastSeenAt]
  );
  const isRefreshingOnline = userSessionQuery.isFetching || userSessionQuery.streamStatus === 'connecting';
  const userDevices = useMemo(() => userDevicesQuery.data?.data?.devices ?? [], [userDevicesQuery.data?.data?.devices]);
  const inboundDeviceStats = useMemo(() => {
    const stats = new Map<number, { onlineDevices: number; seenDevices: number; lastSeenAt: string | null }>();

    for (const device of userDevices) {
      const inboundId = Number(device?.inbound?.id);
      if (!Number.isInteger(inboundId) || inboundId <= 0) {
        continue;
      }

      const existing = stats.get(inboundId) || { onlineDevices: 0, seenDevices: 0, lastSeenAt: null };
      const isOnline = Boolean(device?.online);
      const lastSeenAt = typeof device?.lastSeenAt === 'string' ? device.lastSeenAt : null;

      const nextLastSeenAt = (() => {
        if (!lastSeenAt) {
          return existing.lastSeenAt;
        }

        if (!existing.lastSeenAt) {
          return lastSeenAt;
        }

        return new Date(lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime() ? lastSeenAt : existing.lastSeenAt;
      })();

      stats.set(inboundId, {
        onlineDevices: existing.onlineDevices + (isOnline ? 1 : 0),
        seenDevices: existing.seenDevices + 1,
        lastSeenAt: nextLastSeenAt
      });
    }

    return stats;
  }, [userDevices]);

  const tableHeaderCellClass = accessKeyDensity === 'compact' ? 'px-3 py-2.5' : 'px-4 py-3';
  const tableBodyCellClass = accessKeyDensity === 'compact' ? 'px-3 py-2' : 'px-4 py-3';
  const mobileCardPaddingClass = accessKeyDensity === 'compact' ? 'p-3' : 'p-4';
  const mobileSectionSpacingClass = accessKeyDensity === 'compact' ? 'space-y-1.5' : 'space-y-2';
  const mobileActionsMarginClass = accessKeyDensity === 'compact' ? 'mt-2.5' : 'mt-3';

  const accessKeyRows = useMemo<AccessKeyRow[]>(() => {
    const inboundRows = user?.inbounds || [];
    const allowSingleKeyFallback = isUserOnline && inboundRows.length === 1;

    return inboundRows.map((relation, index) => ({
      relation,
      index,
      label: relation.inbound.remark || relation.inbound.tag || `Key ${index + 1}`,
      protocol: relation.inbound.protocol,
      port: Number(relation.inbound.port || 0),
      priority: Number.isInteger(Number(relation.priority)) ? Number(relation.priority) : 100 + index,
      enabled: Boolean(relation.enabled),
      online: (() => {
        if (!relation.enabled) {
          return false;
        }

        const inboundId = Number(relation.inboundId || relation.inbound?.id);
        if (Number.isInteger(inboundId) && inboundId > 0) {
          const stats = inboundDeviceStats.get(inboundId);
          if (stats && stats.onlineDevices > 0) {
            return true;
          }
        }

        return allowSingleKeyFallback;
      })(),
      lastSeenAt: (() => {
        const inboundId = Number(relation.inboundId || relation.inbound?.id);
        if (Number.isInteger(inboundId) && inboundId > 0) {
          const stats = inboundDeviceStats.get(inboundId);
          if (stats?.lastSeenAt) {
            return stats.lastSeenAt;
          }
        }

        return allowSingleKeyFallback ? (session?.lastSeenAt ?? null) : null;
      })(),
      onlineDevices: (() => {
        const inboundId = Number(relation.inboundId || relation.inbound?.id);
        if (Number.isInteger(inboundId) && inboundId > 0) {
          return inboundDeviceStats.get(inboundId)?.onlineDevices ?? 0;
        }
        return allowSingleKeyFallback ? 1 : 0;
      })(),
      seenDevices: (() => {
        const inboundId = Number(relation.inboundId || relation.inbound?.id);
        if (Number.isInteger(inboundId) && inboundId > 0) {
          return inboundDeviceStats.get(inboundId)?.seenDevices ?? 0;
        }
        return allowSingleKeyFallback ? 1 : 0;
      })(),
      expirationDays: daysRemaining
    }));
  }, [daysRemaining, inboundDeviceStats, isUserOnline, session?.lastSeenAt, user?.inbounds]);

  const enabledKeyCount = useMemo(() => accessKeyRows.filter((row) => row.enabled).length, [accessKeyRows]);
  const onlineKeyCount = useMemo(() => accessKeyRows.filter((row) => row.online).length, [accessKeyRows]);

  const filteredAndSortedKeyRows = useMemo(() => {
    const filtered = accessKeyRows.filter((row) => {
      if (accessKeyFilter === 'enabled') return row.enabled;
      if (accessKeyFilter === 'disabled') return !row.enabled;
      if (accessKeyFilter === 'online') return row.online;
      if (accessKeyFilter === 'offline') return !row.online;
      return true;
    });

    const multiplier = sortDirection === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let result = 0;

      switch (sortField) {
        case 'key':
          result = a.label.localeCompare(b.label);
          break;
        case 'protocol':
          result = a.protocol.localeCompare(b.protocol);
          break;
        case 'port':
          result = a.port - b.port;
          break;
        case 'priority':
          result = a.priority - b.priority;
          break;
        case 'enabled':
          result = Number(a.enabled) - Number(b.enabled);
          break;
        case 'online':
          result = Number(a.online) - Number(b.online);
          break;
        case 'expiration':
          result = a.expirationDays - b.expirationDays;
          break;
        default:
          result = 0;
      }

      if (result === 0) {
        result = a.index - b.index;
      }

      return result * multiplier;
    });

    return filtered;
  }, [accessKeyFilter, accessKeyRows, sortDirection, sortField]);
  const isDragReorderEnabled = accessKeyFilter === 'all' && sortField === 'priority' && sortDirection === 'asc';

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted">User not found</p>
        <Button className="mt-4" onClick={() => navigate('/users')}>
          Back to Users
        </Button>
      </div>
    );
  }

  const handleSort = (field: AccessKeySortField) => {
    if (sortField === field) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('asc');
  };

  const renderSortableHeader = (label: string, field: AccessKeySortField) => {
    const active = sortField === field;
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${
          active ? 'text-foreground' : 'text-muted hover:text-foreground'
        }`}
        onClick={() => handleSort(field)}
      >
        <span>{label}</span>
        <ArrowUpDown className={`h-3.5 w-3.5 ${active ? 'opacity-100' : 'opacity-40'}`} />
      </button>
    );
  };

  const renderOnlinePill = (online: boolean) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-300'
      }`}
    >
      <span className="relative inline-flex h-2.5 w-2.5">
        {online ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
        ) : null}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
      </span>
      <span>{online ? 'Online' : 'Offline'}</span>
    </span>
  );

  const renderOnlineKeysPill = (onlineCount: number, enabledCount: number) => {
    const hasOnlineKeys = onlineCount > 0;
    const label = enabledCount > 0 ? `Keys online ${onlineCount}/${enabledCount}` : 'No keys enabled';
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          hasOnlineKeys ? 'bg-emerald-500/15 text-emerald-300' : 'bg-panel/60 text-muted'
        }`}
        title={label}
      >
        <span className="relative inline-flex h-2.5 w-2.5">
          {hasOnlineKeys ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          ) : null}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${hasOnlineKeys ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
        </span>
        <span>{label}</span>
      </span>
    );
  };

  const renderSignalCounters = (row: AccessKeyRow) => {
    const counters = [
      {
        key: 'enabled',
        dotClass: 'bg-sky-400',
        value: row.enabled ? 1 : 0,
        label: 'Enabled'
      },
      {
        key: 'disabled',
        dotClass: 'bg-rose-400',
        value: row.enabled ? 0 : 1,
        label: 'Disabled'
      },
      {
        key: 'online',
        dotClass: 'bg-emerald-400',
        value: row.online ? 1 : 0,
        label: 'Online'
      }
    ];

    return (
      <div className="mt-1 flex items-center gap-2">
        {counters.map((counter) => (
          <span
            key={`${row.relation.id}-${counter.key}`}
            title={counter.label}
            className="inline-flex items-center gap-1 rounded-full border border-line/60 bg-panel/65 px-1.5 py-0.5 text-[10px] font-medium text-muted"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${counter.dotClass}`} />
            <span>{counter.value}</span>
          </span>
        ))}
      </div>
    );
  };

  const closeActionMenu = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    const details = element?.closest('details') as HTMLDetailsElement | null;
    if (details) {
      details.open = false;
    }
  };

  const runMenuAction = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: (() => void) | undefined
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (action) {
      action();
    }
    closeActionMenu(event.currentTarget);
  };

  const handleResetTraffic = () => {
    setPendingConfirm({ type: 'reset-traffic' });
  };

  const handleDelete = () => {
    setPendingConfirm({ type: 'delete-user' });
  };

  const copyToClipboard = async (field: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(''), 1800);
  };

  const getFirstTemplateUrl = (templates: TemplateShape[]) => {
    const ordered = templates
      .map((template) => ({
        id: String(template.id || ''),
        content: String(template.content || '').trim()
      }))
      .filter((template) => Boolean(template.content));

    const protocolUrl = ordered.find((template) =>
      /^(vless|vmess|trojan|ss|socks5|http|wireguard):\/\//i.test(template.content)
    );
    if (protocolUrl) {
      return protocolUrl.content;
    }

    const urlLike = ordered.find((template) => template.id.includes('url'));
    if (urlLike) {
      return urlLike.content;
    }

    if (user.subscriptionToken) {
      return `${window.location.origin}/sub/${user.subscriptionToken}?target=v2ray`;
    }

    return '';
  };

  const copyKeyForInbound = async (row: UserInbound) => {
    if (!row.inboundId) {
      return;
    }

    setCopyingKeyInboundId(row.inboundId);
    try {
      const payload = (await apiClient.get(`/inbounds/${row.inboundId}/client-templates`, {
        params: {
          userId: user.id
        }
      })) as {
        data?: {
          templates?: TemplateShape[];
        };
      };

      const templates = payload?.data?.templates || [];
      const keyUrl = getFirstTemplateUrl(templates);
      if (!keyUrl) {
        throw new Error('No key URL available for this inbound');
      }

      await copyToClipboard(`key-${row.inboundId}`, keyUrl);
    } catch (error: any) {
      toast.error('Copy failed', error?.message || 'Failed to copy key');
    } finally {
      setCopyingKeyInboundId(null);
    }
  };

  const handleToggleInboundKey = async (row: UserInbound) => {
    if (!row.inboundId) {
      return;
    }

    setTogglingInboundId(row.inboundId);
    try {
      await toggleUserInbound.mutateAsync({
        id: user.id,
        inboundId: row.inboundId,
        enabled: !row.enabled
      });
      void refetch();
    } catch (error: any) {
      toast.error('Update failed', error?.message || 'Failed to update key status');
    } finally {
      setTogglingInboundId(null);
    }
  };

  const handleAdjustInboundPriority = async (row: UserInbound, delta: number) => {
    if (!row.inboundId) {
      return;
    }

    const currentPriority = Number.isInteger(Number(row.priority)) ? Number(row.priority) : 100;
    const nextPriority = Math.max(1, Math.min(9999, currentPriority + delta));
    if (nextPriority === currentPriority) {
      return;
    }

    setUpdatingPriorityInboundId(row.inboundId);
    try {
      await updateInboundPriority.mutateAsync({
        id: user.id,
        inboundId: row.inboundId,
        priority: nextPriority
      });
      void refetch();
    } catch (error: any) {
      toast.error('Priority update failed', error?.message || 'Failed to update key priority');
    } finally {
      setUpdatingPriorityInboundId(null);
    }
  };

  const renderUserHeaderActionMenu = () => {
    const menuItems: Array<{
      key: string;
      label: string;
      icon?: React.ComponentType<{ className?: string }>;
      tone?: 'default' | 'danger';
      disabled?: boolean;
      onClick?: () => void;
    }> = [
      {
        key: 'reset-traffic',
        label: resetTraffic.isPending ? 'Resetting traffic…' : 'Reset traffic',
        icon: RotateCcw,
        disabled: resetTraffic.isPending,
        onClick: () => handleResetTraffic()
      },
      {
        key: 'delete-user',
        label: deleteUser.isPending ? 'Deleting user…' : 'Delete user',
        icon: Trash2,
        tone: 'danger',
        disabled: deleteUser.isPending,
        onClick: () => handleDelete()
      }
    ];

    return (
      <details className="relative">
        <summary
          className="list-none cursor-pointer rounded-xl border border-line/70 bg-card/75 px-3 py-2 text-foreground transition hover:bg-panel/60 [&::-webkit-details-marker]:hidden"
          aria-label="More actions"
          title="More actions"
        >
          <span className="inline-flex items-center gap-2">
            <MoreVertical className="h-4 w-4" />
            <span className="text-sm font-medium">Actions</span>
          </span>
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-line/70 bg-card/95 p-1 shadow-lg shadow-black/10 backdrop-blur-sm">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.tone === 'danger'
                    ? 'text-red-500 hover:bg-red-500/10'
                    : 'text-foreground hover:bg-panel/70'
                }`}
                disabled={item.disabled}
                onClick={(event) => runMenuAction(event, item.onClick)}
              >
                {Icon ? <Icon className={`h-4 w-4 ${item.tone === 'danger' ? 'text-red-500' : 'text-muted'}`} /> : null}
                {item.label}
              </button>
            );
          })}
        </div>
      </details>
    );
  };

  const renderKeyActionMenu = (keyRow: AccessKeyRow, options: { mobile?: boolean } = {}) => {
    const row = keyRow.relation;
    const mobile = Boolean(options.mobile);
    const inboundId = Number.parseInt(String(row.inboundId || 0), 10);
    const isCopying = inboundId > 0 && copyingKeyInboundId === inboundId;
    const isToggling = inboundId > 0 && togglingInboundId === inboundId;
    const isUpdatingPriority = inboundId > 0 && updatingPriorityInboundId === inboundId;

    const menuItems: Array<{
      key: string;
      label: string;
      icon?: React.ComponentType<{ className?: string }>;
      tone?: 'default' | 'danger';
      disabled?: boolean;
      onClick?: () => void;
    }> = [
      {
        key: 'templates',
        label: 'Client templates',
        icon: FileCode2,
        disabled: !row.inbound,
        onClick: () => setProfileInbound(row.inbound)
      },
      {
        key: 'copy',
        label: isCopying ? 'Copying key…' : 'Copy key URL',
        icon: Copy,
        disabled: inboundId <= 0 || isCopying,
        onClick: () => void copyKeyForInbound(row)
      },
      {
        key: 'toggle',
        label: isToggling ? 'Updating…' : (row.enabled ? 'Disable key' : 'Enable key'),
        icon: row.enabled ? PowerOff : Power,
        disabled: inboundId <= 0 || isToggling,
        onClick: () => void handleToggleInboundKey(row)
      },
      {
        key: 'move-up',
        label: 'Move up (higher priority)',
        icon: ArrowUp,
        disabled: inboundId <= 0 || isUpdatingPriority || isReorderingByDrag || keyRow.priority <= 1,
        onClick: () => void handleAdjustInboundPriority(row, -1)
      },
      {
        key: 'move-down',
        label: 'Move down (lower priority)',
        icon: ArrowDown,
        disabled: inboundId <= 0 || isUpdatingPriority || isReorderingByDrag || keyRow.priority >= 9999,
        onClick: () => void handleAdjustInboundPriority(row, 1)
      },
      {
        key: 'open-inbounds',
        label: 'Open inbounds page',
        icon: ExternalLink,
        onClick: () => navigate('/inbounds?tab=inbounds')
      }
    ];

    return (
      <details className="relative">
        <summary
          className={`list-none cursor-pointer rounded-lg border border-line/60 bg-card/70 px-2 py-1 text-foreground transition hover:bg-panel/70 [&::-webkit-details-marker]:hidden ${
            mobile ? 'inline-flex h-10 w-10 items-center justify-center' : 'inline-flex h-8 w-8 items-center justify-center'
          }`}
          aria-label="More actions"
          title="More actions"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="inline-flex items-center">
            <MoreVertical className="h-4 w-4" />
          </span>
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-line/70 bg-card/95 p-1 shadow-lg shadow-black/10 backdrop-blur-sm">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={`${row.id}-${item.key}`}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.tone === 'danger'
                    ? 'text-red-500 hover:bg-red-500/10'
                    : 'text-foreground hover:bg-panel/70'
                }`}
                disabled={item.disabled}
                onClick={(event) => runMenuAction(event, item.onClick)}
              >
                {Icon ? <Icon className={`h-4 w-4 ${item.tone === 'danger' ? 'text-red-500' : 'text-muted'}`} /> : null}
                {item.label}
              </button>
            );
          })}
        </div>
      </details>
    );
  };

  const handleApplyMyanmarPriority = async () => {
    const userInbounds = (user.inbounds || []).filter(
      (row) => Number.isInteger(Number(row.inboundId)) && Number(row.inboundId) > 0
    );
    if (userInbounds.length === 0) {
      toast.error('No keys found', 'No keys available for this user.');
      return;
    }

    setIsApplyingMyanmarPriority(true);
    try {
      const dryRunResponse = await usersApi.previewUserInboundPatternReorder(user.id, 'myanmar');
      const dryRunData = dryRunResponse.data;
      if (!dryRunData) {
        throw new Error('Failed to generate preview');
      }

      if ((dryRunData.matchedKeys || 0) === 0) {
        toast.error(
          'No matching profiles',
          'No Myanmar-compatible profiles found (expected REALITY / VLESS WS TLS / TROJAN WS TLS).'
        );
        return;
      }
      setMyanmarPreviewState({
        totalKeys: dryRunData.totalKeys ?? 0,
        matchedKeys: dryRunData.matchedKeys ?? 0,
        changedKeys: dryRunData.changedKeys ?? 0,
        currentTop3: dryRunData.currentTop3 || [],
        newTop3: dryRunData.newTop3 || []
      });
    } catch (error: any) {
      toast.error('Preview failed', error?.message || 'Failed to apply Myanmar priority order');
    } finally {
      setIsApplyingMyanmarPriority(false);
    }
  };

  const handleConfirmMyanmarPriorityApply = async () => {
    if (!myanmarPreviewState) {
      return;
    }

    setIsApplyingMyanmarPriority(true);
    try {
      const applyResponse = await usersApi.reorderUserInboundsByPattern(user.id, { pattern: 'myanmar' });
      const appliedData = applyResponse.data;

      setSortField('priority');
      setSortDirection('asc');
      setAccessKeyFilter('all');
      setMyanmarPreviewState(null);
      void refetch();
      toast.success(
        'Myanmar priority applied',
        `Promoted ${appliedData?.matchedKeys ?? myanmarPreviewState.matchedKeys ?? 0} matching key(s).`
      );
    } catch (error: any) {
      toast.error('Apply failed', error?.message || 'Failed to apply Myanmar priority order');
    } finally {
      setIsApplyingMyanmarPriority(false);
    }
  };

  const clearDragState = () => {
    setDraggingInboundId(null);
    setDragOverInboundId(null);
  };

  const handleInboundDragStart = (inboundId: number) => {
    if (!isDragReorderEnabled || isReorderingByDrag) {
      return;
    }
    setDraggingInboundId(inboundId);
    setDragOverInboundId(inboundId);
  };

  const handleInboundDragOver = (event: React.DragEvent<HTMLTableRowElement>, inboundId: number) => {
    if (!isDragReorderEnabled || isReorderingByDrag || draggingInboundId === null) {
      return;
    }
    event.preventDefault();
    if (dragOverInboundId !== inboundId) {
      setDragOverInboundId(inboundId);
    }
  };

  const handleInboundDrop = async (targetInboundId: number) => {
    if (!isDragReorderEnabled || isReorderingByDrag || draggingInboundId === null) {
      clearDragState();
      return;
    }

    if (draggingInboundId === targetInboundId) {
      clearDragState();
      return;
    }

    const orderedRows = filteredAndSortedKeyRows.filter((entry) =>
      Number.isInteger(Number(entry.relation.inboundId)) && Number(entry.relation.inboundId) > 0
    );
    const sourceIndex = orderedRows.findIndex((entry) => entry.relation.inboundId === draggingInboundId);
    const targetIndex = orderedRows.findIndex((entry) => entry.relation.inboundId === targetInboundId);
    if (sourceIndex < 0 || targetIndex < 0) {
      clearDragState();
      return;
    }

    const reorderedRows = [...orderedRows];
    const [moved] = reorderedRows.splice(sourceIndex, 1);
    reorderedRows.splice(targetIndex, 0, moved);

    const assignments = reorderedRows.map((entry, index) => ({
      inboundId: Number(entry.relation.inboundId),
      priority: 100 + index,
      enabled: Boolean(entry.relation.enabled)
    }));

    setIsReorderingByDrag(true);
    try {
      await reorderUserInbounds.mutateAsync({
        id: user.id,
        assignments
      });
      void refetch();
    } catch (error: any) {
      toast.error('Reorder failed', error?.message || 'Failed to reorder keys');
    } finally {
      setIsReorderingByDrag(false);
      clearDragState();
    }
  };

  const handleRevokeDevice = (fingerprint: string) => {
    setPendingConfirm({
      type: 'revoke-device',
      fingerprint
    });
  };

  const confirmLoading = pendingConfirm?.type === 'reset-traffic'
    ? resetTraffic.isPending
    : pendingConfirm?.type === 'delete-user'
    ? deleteUser.isPending
    : pendingConfirm?.type === 'revoke-device'
    ? revokeUserDevice.isPending
    : false;

  const handleConfirmPending = async () => {
    if (!pendingConfirm) {
      return;
    }

    try {
      if (pendingConfirm.type === 'reset-traffic') {
        await resetTraffic.mutateAsync(user.id);
        toast.success('Traffic reset', 'User traffic counters were reset.');
        void refetch();
      } else if (pendingConfirm.type === 'delete-user') {
        await deleteUser.mutateAsync(user.id);
        toast.success('User deleted', 'User was deleted successfully.');
        setPendingConfirm(null);
        navigate('/users');
        return;
      } else if (pendingConfirm.type === 'revoke-device') {
        await revokeUserDevice.mutateAsync({
          id: user.id,
          fingerprint: pendingConfirm.fingerprint
        });
        toast.success('Device revoked', 'Device session was revoked.');
        void userDevicesQuery.refetch();
        void userSessionQuery.refetch();
      }
      setPendingConfirm(null);
    } catch (error: any) {
      if (pendingConfirm.type === 'reset-traffic') {
        toast.error('Reset failed', error?.message || 'Failed to reset traffic');
      } else if (pendingConfirm.type === 'delete-user') {
        toast.error('Delete failed', error?.message || 'Failed to delete user');
      } else {
        toast.error('Revoke failed', error?.message || 'Failed to revoke device session');
      }
    }
  };

  const confirmTitle = pendingConfirm?.type === 'reset-traffic'
    ? 'Reset Traffic'
    : pendingConfirm?.type === 'delete-user'
    ? 'Delete User'
    : pendingConfirm?.type === 'revoke-device'
    ? 'Revoke Device Session'
    : '';
  const confirmDescription = pendingConfirm?.type === 'reset-traffic'
    ? 'Reset traffic for this user?'
    : pendingConfirm?.type === 'delete-user'
    ? 'Are you sure you want to delete this user? This action cannot be undone.'
    : pendingConfirm?.type === 'revoke-device'
    ? 'Revoke this device session? The device will need to fetch subscription again.'
    : '';
  const confirmLabel = pendingConfirm?.type === 'delete-user'
    ? 'Delete'
    : pendingConfirm?.type === 'reset-traffic'
    ? 'Reset'
    : 'Revoke';
  const confirmTone = pendingConfirm?.type === 'delete-user' ? 'danger' : 'primary';

  const getStatusBadge = () => {
    const variants = {
      ACTIVE: 'success',
      EXPIRED: 'danger',
      DISABLED: 'warning',
      LIMITED: 'warning'
    } as const;

    return <Badge variant={variants[user.status as keyof typeof variants]}>{user.status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <Button variant="ghost" onClick={() => navigate('/users')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{user.email}</h1>
            <p className="mt-1 text-sm text-muted">User Details &amp; Access Keys</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {renderOnlineKeysPill(onlineKeyCount, enabledKeyCount)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Button variant="secondary" onClick={() => setShowEditModal(true)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          {renderUserHeaderActionMenu()}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <Card>
          <p className="text-sm text-muted">Status</p>
          <div className="mt-2">{getStatusBadge()}</div>
        </Card>

        <Card>
          <p className="text-sm text-muted">Online</p>
          <div className="mt-2">{renderOnlinePill(isUserOnline)}</div>
          <p className="mt-1 text-xs text-muted">{lastSeenLabel}</p>
        </Card>

        <Card>
          <p className="text-sm text-muted">Data Used</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{formatBytes(totalUsed)}</p>
          <p className="mt-1 text-xs text-muted">of {formatBytes(dataLimit)}</p>
        </Card>

        <Card>
          <p className="text-sm text-muted">Remaining</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{formatBytes(remaining)}</p>
          <p className="mt-1 text-xs text-muted">{remainingPercent.toFixed(1)}% left</p>
        </Card>

        <Card>
          <p className="text-sm text-muted">{isDeferredExpiry ? 'Expiry' : 'Expires In'}</p>
          {isDeferredExpiry ? (
            <>
              <p className="mt-2 text-base font-semibold text-foreground">Starts on first connect</p>
              <p className="mt-1 text-xs text-muted">{daysRemaining} days after first connect</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold text-foreground">{daysRemaining} days</p>
              <p className="mt-1 text-xs text-muted">{formatDate(user.expireDate)}</p>
            </>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">User Information</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="text-sm text-muted">Email</label>
            <p className="mt-1 font-medium text-foreground">{user.email}</p>
          </div>

          <div>
            <label className="text-sm text-muted">UUID</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded-lg border border-line/70 bg-panel/70 px-2 py-1 font-mono text-sm text-foreground">
                {user.uuid}
              </code>
              <button
                onClick={() => {
                  void copyToClipboard('uuid', user.uuid);
                }}
                className="rounded p-1 transition-colors hover:bg-card"
                aria-label="Copy UUID"
              >
                {copiedField === 'uuid' ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4 text-muted" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm text-muted">Password</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded-lg border border-line/70 bg-panel/70 px-2 py-1 font-mono text-sm text-foreground">
                {user.password}
              </code>
              <button
                onClick={() => {
                  void copyToClipboard('password', user.password);
                }}
                className="rounded p-1 transition-colors hover:bg-card"
                aria-label="Copy password"
              >
                {copiedField === 'password' ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4 text-muted" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm text-muted">Created At</label>
            <p className="mt-1 text-foreground">{formatDate(user.createdAt)}</p>
          </div>

          {user.note ? (
            <div className="md:col-span-2">
              <label className="text-sm text-muted">Note</label>
              <p className="mt-1 text-foreground">{user.note}</p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Effective Inbound Access</h2>
            <p className="mt-1 text-sm text-muted">
              Combined view of direct assignments and inherited group mappings.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={effectiveInboundsQuery.isFetching}
            onClick={() => {
              void effectiveInboundsQuery.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {effectiveInboundsQuery.isLoading ? (
          <div className="py-4 text-sm text-muted">Loading effective access...</div>
        ) : !effectiveInboundsPayload || effectiveInboundsPayload.effectiveInbounds.length === 0 ? (
          <div className="rounded-xl border border-line/70 bg-panel/55 p-4 text-sm text-muted">
            No effective inbounds found for this user.
          </div>
        ) : (
          <div className="space-y-3">
            {effectiveInboundsPayload.effectiveInbounds.map((entry) => (
              <div
                key={`effective-inbound-${entry.inboundId}`}
                className="rounded-xl border border-line/70 bg-panel/55 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">
                      {entry.inbound.protocol} • {entry.inbound.port}
                    </p>
                    <p className="text-sm text-muted">{entry.inbound.remark || entry.inbound.tag}</p>
                  </div>
                  <Badge variant={entry.inbound.enabled ? 'success' : 'warning'}>
                    {entry.inbound.enabled ? 'Inbound enabled' : 'Inbound disabled'}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.sources.map((source, index) => (
                    <span
                      key={`effective-source-${entry.inboundId}-${index}`}
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        source.type === 'DIRECT'
                          ? 'bg-brand-500/20 text-brand-200'
                          : 'bg-violet-500/20 text-violet-200'
                      }`}
                    >
                      {source.type === 'DIRECT' ? 'Direct' : `Group: ${source.groupName || source.groupId}`}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Effective Policy</h2>
            <p className="mt-1 text-sm text-muted">
              Compare direct user policy with inherited group policy overrides.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={effectivePolicyQuery.isFetching}
            onClick={() => {
              void effectivePolicyQuery.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {effectivePolicyQuery.isLoading ? (
          <div className="py-4 text-sm text-muted">Loading effective policy...</div>
        ) : !effectivePolicyPayload ? (
          <div className="rounded-xl border border-line/70 bg-panel/55 p-4 text-sm text-muted">
            Effective policy is unavailable for this user.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-line/70 bg-panel/55">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="bg-panel/80 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">Field</th>
                    <th className="px-4 py-3 text-left">Direct</th>
                    <th className="px-4 py-3 text-left">Inherited</th>
                    <th className="px-4 py-3 text-left">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">Data Limit</td>
                    <td className="px-4 py-3 text-foreground">
                      {formatBytes(Number(effectivePolicyPayload.directPolicy.dataLimit || 0))}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.dataLimit !== null
                        ? formatBytes(Number(effectivePolicyPayload.inheritedPolicy.dataLimit || 0))
                        : 'No override'}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatBytes(Number(effectivePolicyPayload.effectivePolicy.dataLimit || 0))}
                      {effectivePolicyPayload.drift.dataLimit ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">Drift</span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">Expiry</td>
                    <td className="px-4 py-3 text-foreground">{formatDate(effectivePolicyPayload.directPolicy.expireDate)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.expireDate
                        ? formatDate(effectivePolicyPayload.inheritedPolicy.expireDate)
                        : 'No override'}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatDate(effectivePolicyPayload.effectivePolicy.expireDate)}
                      {effectivePolicyPayload.drift.expireDate ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">Drift</span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">IP Limit</td>
                    <td className="px-4 py-3 text-foreground">{effectivePolicyPayload.directPolicy.ipLimit}</td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.ipLimit ?? 'No override'}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.effectivePolicy.ipLimit}
                      {effectivePolicyPayload.drift.ipLimit ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">Drift</span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">Status</td>
                    <td className="px-4 py-3 text-foreground">{effectivePolicyPayload.directPolicy.status}</td>
                    <td className="px-4 py-3 text-foreground">{effectivePolicyPayload.inheritedPolicy.status || 'No override'}</td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.effectivePolicy.status}
                      {effectivePolicyPayload.drift.status ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">Drift</span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">Traffic Reset</td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.directPolicy.trafficResetPeriod}
                      {effectivePolicyPayload.directPolicy.trafficResetDay
                        ? ` @${effectivePolicyPayload.directPolicy.trafficResetDay}`
                        : ''}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.trafficResetPeriod
                        ? `${effectivePolicyPayload.inheritedPolicy.trafficResetPeriod}${
                            effectivePolicyPayload.inheritedPolicy.trafficResetDay
                              ? ` @${effectivePolicyPayload.inheritedPolicy.trafficResetDay}`
                              : ''
                          }`
                        : 'No override'}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.effectivePolicy.trafficResetPeriod}
                      {effectivePolicyPayload.effectivePolicy.trafficResetDay
                        ? ` @${effectivePolicyPayload.effectivePolicy.trafficResetDay}`
                        : ''}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Group policy sources</p>
              <div className="flex flex-wrap gap-2">
                {effectivePolicyPayload.groups.length === 0 ? (
                  <span className="text-sm text-muted">No active groups assigned</span>
                ) : (
                  effectivePolicyPayload.groups.map((group) => (
                    <span
                      key={`policy-group-${group.id}`}
                      className="rounded-full border border-line/70 bg-card/70 px-3 py-1 text-xs text-foreground"
                    >
                      {group.name}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-line/70 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">Access Keys</h2>
              <p className="mt-1 text-sm text-muted">
                Manage per-inbound keys, key status, online visibility, and quick template actions.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={accessKeyFilter}
                onChange={(event) => setAccessKeyFilter(event.target.value as AccessKeyFilter)}
                className="rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="all">All Keys</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>

              <select
                value={String(refreshInterval)}
                onChange={(event) => setRefreshInterval(Number(event.target.value))}
                className="rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                {REFRESH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Refresh {option.label}
                  </option>
                ))}
              </select>

              <select
                value={accessKeyDensity}
                onChange={(event) => setAccessKeyDensity(event.target.value as AccessKeyDensity)}
                className="rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="comfortable">Comfortable rows</option>
                <option value="compact">Compact rows</option>
              </select>

              <Button
                size="sm"
                variant="secondary"
                loading={isRefreshingOnline}
                onClick={() => {
                  void userSessionQuery.refetch();
                  void userDevicesQuery.refetch();
                  void refetch();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>

              <Button
                size="sm"
                variant="secondary"
                loading={isApplyingMyanmarPriority}
                disabled={isReorderingByDrag || (user.inbounds || []).length === 0}
                onClick={() => {
                  void handleApplyMyanmarPriority();
                }}
              >
                <ArrowUpDown className="mr-2 h-4 w-4" />
                Myanmar Priority
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            {isDragReorderEnabled
              ? 'Drag rows from the Menu column to reorder key priority. New order controls subscription fallback.'
              : 'Enable drag reorder by setting Filter: All Keys and Sort: Priority ascending.'}
          </p>
        </div>

        {filteredAndSortedKeyRows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted">No keys match the selected filter.</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className={`min-w-[1100px] w-full ${accessKeyDensity === 'compact' ? 'text-xs' : 'text-sm'}`}>
                <thead className="bg-panel/65">
                  <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-muted">
                    <th className={tableHeaderCellClass}>Menu</th>
                    <th className={tableHeaderCellClass}>{renderSortableHeader('Enabled', 'enabled')}</th>
                    <th className={tableHeaderCellClass}>{renderSortableHeader('Online', 'online')}</th>
                    <th className={tableHeaderCellClass}>{renderSortableHeader('Client / Key', 'key')}</th>
                    <th className={tableHeaderCellClass}>{renderSortableHeader('Protocol', 'protocol')}</th>
                    <th className={tableHeaderCellClass}>{renderSortableHeader('Port', 'port')}</th>
                    <th className={tableHeaderCellClass}>{renderSortableHeader('Priority', 'priority')}</th>
                    <th className={tableHeaderCellClass}>Traffic</th>
                    <th className={tableHeaderCellClass}>{renderSortableHeader('Expiration', 'expiration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedKeyRows.map((keyRow) => {
                    const row = keyRow.relation;
                    const inboundId = Number.parseInt(String(row.inboundId || 0), 10);
                    const rowLastSeenLabel = getRelativeLastSeenLabel(keyRow.online, keyRow.lastSeenAt, nowTimestamp);
                    const isInboundDragEnabled = isDragReorderEnabled && inboundId > 0 && !isReorderingByDrag;
                    const isDraggedRow = draggingInboundId === inboundId;
                    const isDropTargetRow = dragOverInboundId === inboundId && draggingInboundId !== inboundId;
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-line/70 transition-colors hover:bg-panel/35 ${
                          isDraggedRow ? 'bg-brand-500/10' : ''
                        } ${isDropTargetRow ? 'ring-1 ring-inset ring-brand-500/50' : ''}`}
                        draggable={isInboundDragEnabled}
                        onDragStart={() => {
                          handleInboundDragStart(inboundId);
                        }}
                        onDragOver={(event) => {
                          handleInboundDragOver(event, inboundId);
                        }}
                        onDrop={() => {
                          void handleInboundDrop(inboundId);
                        }}
                        onDragEnd={clearDragState}
                      >
                        <td className={tableBodyCellClass}>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded p-1 ${
                                isInboundDragEnabled ? 'cursor-grab text-muted hover:bg-panel/70 hover:text-foreground' : 'text-muted/40'
                              }`}
                              title={isDragReorderEnabled ? 'Drag to reorder priority' : 'Sort by priority asc to enable drag reorder'}
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                            {renderKeyActionMenu(keyRow)}
                          </div>
                        </td>

                        <td className={tableBodyCellClass}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={row.enabled}
                            aria-label={row.enabled ? 'Disable key' : 'Enable key'}
                            title={row.enabled ? 'Disable key' : 'Enable key'}
                            disabled={togglingInboundId === row.inboundId}
                            onClick={() => {
                              void handleToggleInboundKey(row);
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full border border-line/70 transition focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                              row.enabled ? 'bg-emerald-500/25' : 'bg-panel/70'
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full border border-line/70 bg-white shadow-sm transition ${
                                row.enabled ? 'translate-x-5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>

                        <td className={tableBodyCellClass}>
                          {renderOnlinePill(keyRow.online)}
                          <p className="mt-1 text-[11px] text-muted">{rowLastSeenLabel}</p>
                          {keyRow.seenDevices > 0 ? (
                            <p className="mt-0.5 text-[11px] text-muted">
                              Devices {keyRow.onlineDevices}/{keyRow.seenDevices}
                            </p>
                          ) : null}
                        </td>

                        <td className={tableBodyCellClass}>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{user.email}</span>
                            <span className="text-xs text-muted">{keyRow.label}</span>
                            {renderSignalCounters(keyRow)}
                          </div>
                        </td>

                        <td className={tableBodyCellClass}>
                          <Badge variant="info">{keyRow.protocol}</Badge>
                        </td>

                        <td className={tableBodyCellClass}>
                          <span className="font-semibold text-foreground">{keyRow.port}</span>
                        </td>

                        <td className={tableBodyCellClass}>
                          <span className="inline-flex items-center rounded-full border border-line/70 bg-card/70 px-3 py-1 text-xs font-semibold text-foreground">
                            {keyRow.priority}
                          </span>
                        </td>

                        <td className={tableBodyCellClass}>
                          <div className="w-48">
                            <p className="text-xs text-muted">
                              {formatBytes(totalUsed)} / {dataLimit > 0 ? formatBytes(dataLimit) : '∞'}
                            </p>
                            <div className="mt-1 h-2 rounded-full bg-panel/80">
                              <div
                                className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                                style={{ width: `${usagePercent}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        <td className={tableBodyCellClass}>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                              keyRow.expirationDays <= 0
                                ? 'bg-red-500/20 text-red-300'
                                : keyRow.expirationDays <= 7
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-brand-500/20 text-brand-200'
                            }`}
                          >
                            {keyRow.expirationDays <= 0 ? 'Expired' : `${keyRow.expirationDays}d`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 p-4 lg:hidden">
              {filteredAndSortedKeyRows.map((keyRow) => {
                const row = keyRow.relation;
                const rowLastSeenLabel = getRelativeLastSeenLabel(keyRow.online, keyRow.lastSeenAt, nowTimestamp);
                return (
                  <div key={`mobile-${row.id}`} className={`rounded-xl border border-line/70 bg-card/70 ${mobileCardPaddingClass}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{keyRow.label}</p>
                        <p className="text-xs text-muted">
                          {keyRow.protocol} · Port {keyRow.port}
                        </p>
                        {renderSignalCounters(keyRow)}
                      </div>
                      <div className="flex flex-col items-end gap-2 text-right">
                        <div className="flex items-center gap-2">
                          {renderOnlinePill(keyRow.online)}
                          {renderKeyActionMenu(keyRow, { mobile: true })}
                        </div>
                        <p className="text-[11px] text-muted">{rowLastSeenLabel}</p>
                        {keyRow.seenDevices > 0 ? (
                          <p className="text-[11px] text-muted">
                            Devices {keyRow.onlineDevices}/{keyRow.seenDevices}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className={`mt-3 ${mobileSectionSpacingClass}`}>
                      <p className="text-xs text-muted">
                        Priority:{' '}
                        <span className="inline-flex items-center rounded-full border border-line/70 bg-card/70 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                          {keyRow.priority}
                        </span>
                      </p>
                      <p className="text-xs text-muted">
                        Usage: {formatBytes(totalUsed)} / {dataLimit > 0 ? formatBytes(dataLimit) : '∞'}
                      </p>
                      <div className="h-2 rounded-full bg-panel/80">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted">
                        Expiration: {keyRow.expirationDays <= 0 ? 'Expired' : `${keyRow.expirationDays} days`}
                      </p>
                    </div>

                    <div className={`${mobileActionsMarginClass} flex items-center justify-between rounded-xl border border-line/70 bg-panel/40 px-3 py-2`}>
                      <span className="text-xs font-medium text-foreground">Enabled</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.enabled}
                        aria-label={row.enabled ? 'Disable key' : 'Enable key'}
                        title={row.enabled ? 'Disable key' : 'Enable key'}
                        disabled={togglingInboundId === row.inboundId}
                        onClick={() => {
                          void handleToggleInboundKey(row);
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full border border-line/70 transition focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                          row.enabled ? 'bg-emerald-500/25' : 'bg-card/70'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full border border-line/70 bg-white shadow-sm transition ${
                            row.enabled ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Device Sessions</h2>
            <p className="text-xs text-muted">
              {userDevicesQuery.data?.data?.online || 0} online / {userDevicesQuery.data?.data?.total || 0} seen in last 60 minutes
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void userDevicesQuery.refetch();
            }}
            loading={userDevicesQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {userDevicesQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : userDevices.length === 0 ? (
          <p className="text-sm text-muted">No tracked devices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line/70">
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Fingerprint</th>
                  <th className="py-2 pr-3">IP</th>
                  <th className="py-2 pr-3">Last Seen</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {userDevices.slice(0, 12).map((device) => (
                  <tr key={device.fingerprint} className="border-b border-line/50">
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
                          device.online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-300'
                        }`}
                      >
                        <span className="relative inline-flex h-2.5 w-2.5">
                          {device.online ? (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                          ) : null}
                          <span
                            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                              device.online ? 'bg-emerald-400' : 'bg-zinc-400'
                            }`}
                          />
                        </span>
                        {device.online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted">{device.shortFingerprint}</td>
                    <td className="py-2 pr-3 text-muted">{device.clientIp || '-'}</td>
                    <td className="py-2 pr-3 text-muted">{formatDate(device.lastSeenAt)}</td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void handleRevokeDevice(device.fingerprint);
                        }}
                        loading={revokeUserDevice.isPending}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <React.Suspense fallback={<ChunkSkeleton />}>
        <TrafficChart userId={user.id} />
      </React.Suspense>
      <React.Suspense fallback={<ChunkSkeleton />}>
        <UserActivityTimeline userId={user.id} />
      </React.Suspense>
      <React.Suspense fallback={<ChunkSkeleton />}>
        <SubscriptionLinksPanel userId={user.id} />
      </React.Suspense>

      {showEditModal ? (
        <UserFormModal
          user={user}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            void refetch();
          }}
        />
      ) : null}

      {profileInbound ? (
        <InboundClientProfileModal
          inbound={profileInbound}
          initialUserId={user.id}
          onClose={() => setProfileInbound(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        cancelLabel="Cancel"
        tone={confirmTone}
        loading={confirmLoading}
        onCancel={() => {
          if (!confirmLoading) {
            setPendingConfirm(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmPending();
        }}
      />

      <MyanmarPriorityPreviewModal
        open={Boolean(myanmarPreviewState)}
        title="Myanmar Priority Preview"
        description="Review current and new fallback order before applying."
        summaryRows={[
          { label: 'Total Keys', value: myanmarPreviewState?.totalKeys ?? 0 },
          { label: 'Matched Keys', value: myanmarPreviewState?.matchedKeys ?? 0 },
          { label: 'Keys To Reorder', value: myanmarPreviewState?.changedKeys ?? 0 }
        ]}
        currentTop3={myanmarPreviewState?.currentTop3 || []}
        newTop3={myanmarPreviewState?.newTop3 || []}
        confirmLabel="Apply Priority"
        loading={isApplyingMyanmarPriority}
        disableConfirm={!myanmarPreviewState || myanmarPreviewState.changedKeys === 0}
        onClose={() => {
          if (!isApplyingMyanmarPriority) {
            setMyanmarPreviewState(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmMyanmarPriorityApply();
        }}
      />
    </div>
  );
};

export const UserDetailPage = UserDetail;
