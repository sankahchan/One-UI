import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  LayoutDashboard,
  MoreVertical,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2
} from 'lucide-react';

import apiClient from '../api/client';
import { Badge } from '../components/atoms/Badge';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { DropdownMenu } from '../components/atoms/DropdownMenu';
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
  useRunUserDiagnostics,
  useTelemetrySyncStatus,
  useRevokeUserDevice,
  useToggleUserInbound,
  useUpdateUserInboundPriority,
  useUser,
  useUserDevices,
  useUserSessions
} from '../hooks/useUsers';
import { usersApi, type UserInboundPatternPreviewEntry, type UserInboundQualityPreviewEntry } from '../api/users';
import type { Inbound, UserDiagnosticsResult, UserInbound } from '../types';
import { copyTextToClipboard } from '../utils/clipboard';
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

const getRelativeLastSeenLabel = (
  t: TFunction,
  isOnline: boolean,
  lastActivity: string | null,
  nowTimestamp: number
) => {
  if (isOnline) {
    return t('users.sessions.liveNow', { defaultValue: 'Live now' });
  }

  if (!lastActivity) {
    return t('users.sessions.noActivity', { defaultValue: 'No activity' });
  }

  const lastSeenAt = new Date(lastActivity).getTime();
  if (Number.isNaN(lastSeenAt)) {
    return t('users.sessions.noActivity', { defaultValue: 'No activity' });
  }

  const elapsedMs = Math.max(0, nowTimestamp - lastSeenAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const elapsedDays = Math.floor(elapsedHours / 24);

  const relativeLabel = (() => {
    if (elapsedMinutes < 1) {
      return t('users.sessions.justNow', { defaultValue: 'just now' });
    }

    if (elapsedMinutes < 60) {
      return t('users.sessions.minutesAgo', { defaultValue: '{{count}}m ago', count: elapsedMinutes });
    }

    if (elapsedHours < 24) {
      return t('users.sessions.hoursAgo', { defaultValue: '{{count}}h ago', count: elapsedHours });
    }

    return t('users.sessions.daysAgo', { defaultValue: '{{count}}d ago', count: elapsedDays });
  })();

  return t('users.sessions.lastSeenPrefix', { defaultValue: 'Last seen {{label}}', label: relativeLabel });
};

export const UserDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();

  const [showEditModal, setShowEditModal] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingUserConfirm>(null);
  const [profileInbound, setProfileInbound] = useState<Inbound | null>(null);
  const [togglingInboundId, setTogglingInboundId] = useState<number | null>(null);
  const [copyingKeyInboundId, setCopyingKeyInboundId] = useState<number | null>(null);
  const [updatingPriorityInboundId, setUpdatingPriorityInboundId] = useState<number | null>(null);
  const [isReorderingByDrag, setIsReorderingByDrag] = useState(false);
  const [isApplyingMyanmarPriority, setIsApplyingMyanmarPriority] = useState(false);
  const [isApplyingQualityOrder, setIsApplyingQualityOrder] = useState(false);
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
  const [qualityPreviewState, setQualityPreviewState] = useState<{
    windowMinutes: number;
    totalKeys: number;
    scoredKeys: number;
    changedKeys: number;
    currentTop3: UserInboundQualityPreviewEntry[];
    newTop3: UserInboundQualityPreviewEntry[];
    previewLines: string[];
  } | null>(null);
  const [diagnosticsResult, setDiagnosticsResult] = useState<UserDiagnosticsResult | null>(null);

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
  const runUserDiagnosticsMutation = useRunUserDiagnostics();
  const telemetrySyncQuery = useTelemetrySyncStatus({
    refetchInterval: refreshInterval === 0 ? false : refreshInterval,
    staleTime: 5_000
  });
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

  useEffect(() => {
    setDiagnosticsResult(null);
  }, [userId]);

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
    () => getRelativeLastSeenLabel(t, isUserOnline, session?.lastSeenAt ?? null, nowTimestamp),
    [isUserOnline, nowTimestamp, session?.lastSeenAt, t]
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
      label:
        relation.inbound.remark
        || relation.inbound.tag
        || t('users.detail.keyFallback', { defaultValue: 'Key {{count}}', count: index + 1 }),
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
  }, [daysRemaining, inboundDeviceStats, isUserOnline, session?.lastSeenAt, t, user?.inbounds]);

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
  const telemetrySync = telemetrySyncQuery.data?.data;
  const telemetryStatusLabel = useMemo(() => {
    const statusValue = telemetrySync?.status || 'stopped';
    if (statusValue === 'healthy') {
      return t('users.telemetry.healthy', { defaultValue: 'Healthy' });
    }
    if (statusValue === 'degraded') {
      return t('users.telemetry.degraded', { defaultValue: 'Degraded' });
    }
    if (statusValue === 'stale') {
      return t('users.telemetry.stale', { defaultValue: 'Stale' });
    }
    if (statusValue === 'starting') {
      return t('users.telemetry.starting', { defaultValue: 'Starting' });
    }
    return t('users.telemetry.stopped', { defaultValue: 'Stopped' });
  }, [t, telemetrySync?.status]);

  const telemetryLagLabel = useMemo(() => {
    if (!telemetrySync || telemetrySync.lagMs === null || telemetrySync.lagMs === undefined) {
      return t('users.telemetry.noLag', { defaultValue: 'No lag data yet' });
    }
    return t('users.telemetry.lag', {
      defaultValue: 'Lag {{seconds}}s',
      seconds: Math.max(0, Math.round(telemetrySync.lagMs / 1000))
    });
  }, [t, telemetrySync]);

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
        <p className="text-muted">{t('users.detail.notFound', { defaultValue: 'User not found' })}</p>
        <Button className="mt-4" onClick={() => navigate('/users')}>
          {t('users.detail.backToUsers', { defaultValue: 'Back to Users' })}
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
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${active ? 'text-foreground' : 'text-muted hover:text-foreground'
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-300'
        }`}
    >
      <span className="relative inline-flex h-2.5 w-2.5">
        {online ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
        ) : null}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
      </span>
      <span>
        {online
          ? t('common.online', { defaultValue: 'Online' })
          : t('common.offline', { defaultValue: 'Offline' })}
      </span>
    </span>
  );

  const renderOnlineKeysPill = (onlineCount: number, enabledCount: number) => {
    const hasOnlineKeys = onlineCount > 0;
    const label = enabledCount > 0
      ? t('users.keysActive', {
        defaultValue: 'Keys active {{online}}/{{total}}',
        online: onlineCount,
        total: enabledCount
      })
      : t('users.detail.noKeysEnabled', { defaultValue: 'No keys enabled' });
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${hasOnlineKeys ? 'bg-emerald-500/15 text-emerald-300' : 'bg-panel/60 text-muted'
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
        label: t('common.enabled', { defaultValue: 'Enabled' })
      },
      {
        key: 'disabled',
        dotClass: 'bg-rose-400',
        value: row.enabled ? 0 : 1,
        label: t('common.disabled', { defaultValue: 'Disabled' })
      },
      {
        key: 'online',
        dotClass: 'bg-emerald-400',
        value: row.online ? 1 : 0,
        label: t('common.online', { defaultValue: 'Online' })
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

  const handleResetTraffic = () => {
    setPendingConfirm({ type: 'reset-traffic' });
  };

  const handleDelete = () => {
    setPendingConfirm({ type: 'delete-user' });
  };

  const handleRunDiagnostics = async () => {
    try {
      const result = await runUserDiagnosticsMutation.mutateAsync({
        id: user.id,
        payload: {
          windowMinutes: 60,
          portProbeTimeoutMs: 1200
        }
      });

      if (!result?.data) {
        throw new Error(t('users.detail.diagnostics.empty', { defaultValue: 'Diagnostics returned no data.' }));
      }

      setDiagnosticsResult(result.data);

      const summary = result.data.summary || { pass: 0, warn: 0, fail: 0 };
      const message = t('users.detail.diagnostics.summary', {
        defaultValue: 'PASS {{pass}} • WARN {{warn}} • FAIL {{fail}}',
        pass: summary.pass,
        warn: summary.warn,
        fail: summary.fail
      });

      if (summary.fail > 0 || summary.warn > 0) {
        toast.warning(
          t('users.detail.diagnostics.title', { defaultValue: 'Diagnostics completed' }),
          message
        );
      } else {
        toast.success(
          t('users.detail.diagnostics.title', { defaultValue: 'Diagnostics completed' }),
          message
        );
      }
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.diagnostics.failed', { defaultValue: 'Failed to run diagnostics' })
      );
    }
  };

  const copyToClipboard = async (field: string, text: string) => {
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('users.detail.toast.copyFailed', { defaultValue: 'Copy failed. Please copy manually.' })
      );
      return false;
    }

    setCopiedField(field);
    window.setTimeout(() => setCopiedField(''), 1800);
    return true;
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
        throw new Error(t('users.detail.toast.noKeyUrl', { defaultValue: 'No key URL available for this inbound' }));
      }

      const copied = await copyToClipboard(`key-${row.inboundId}`, keyUrl);
      if (!copied) {
        throw new Error(t('users.detail.toast.copyKeyFailed', { defaultValue: 'Failed to copy key' }));
      }
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.copyKeyFailed', { defaultValue: 'Failed to copy key' })
      );
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
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.keyStatusFailed', { defaultValue: 'Failed to update key status' })
      );
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
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.keyPriorityFailed', { defaultValue: 'Failed to update key priority' })
      );
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
          label: resetTraffic.isPending
            ? t('users.detail.actions.resettingTraffic', { defaultValue: 'Resetting traffic...' })
            : t('users.detail.actions.resetTraffic', { defaultValue: 'Reset traffic' }),
          icon: RotateCcw,
          disabled: resetTraffic.isPending,
          onClick: () => handleResetTraffic()
        },
        {
          key: 'delete-user',
          label: deleteUser.isPending
            ? t('users.detail.actions.deletingUser', { defaultValue: 'Deleting user...' })
            : t('users.detail.actions.deleteUser', { defaultValue: 'Delete user' }),
          icon: Trash2,
          tone: 'danger',
          disabled: deleteUser.isPending,
          onClick: () => handleDelete()
        }
      ];

    return (
      <DropdownMenu
        items={menuItems}
        ariaLabel={t('common.moreActions', { defaultValue: 'More actions' })}
        triggerClassName="inline-flex items-center rounded-xl border border-line/70 bg-card/75 px-3 py-2 text-foreground transition hover:bg-panel/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="inline-flex items-center gap-2">
          <MoreVertical className="h-4 w-4" />
          <span className="text-sm font-medium">{t('common.actions', { defaultValue: 'Actions' })}</span>
        </span>
      </DropdownMenu>
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
          label: t('users.detail.keyMenu.templates', { defaultValue: 'Client templates' }),
          icon: FileCode2,
          disabled: !row.inbound,
          onClick: () => setProfileInbound(row.inbound)
        },
        {
          key: 'copy',
          label: isCopying
            ? t('users.detail.keyMenu.copyingKey', { defaultValue: 'Copying key...' })
            : t('users.detail.keyMenu.copyKeyUrl', { defaultValue: 'Copy key URL' }),
          icon: Copy,
          disabled: inboundId <= 0 || isCopying,
          onClick: () => void copyKeyForInbound(row)
        },
        {
          key: 'toggle',
          label: isToggling
            ? t('users.detail.keyMenu.updating', { defaultValue: 'Updating...' })
            : row.enabled
              ? t('users.detail.keyMenu.disableKey', { defaultValue: 'Disable key' })
              : t('users.detail.keyMenu.enableKey', { defaultValue: 'Enable key' }),
          icon: row.enabled ? PowerOff : Power,
          disabled: inboundId <= 0 || isToggling,
          onClick: () => void handleToggleInboundKey(row)
        },
        {
          key: 'move-up',
          label: t('users.detail.keyMenu.moveUp', { defaultValue: 'Move up (higher priority)' }),
          icon: ArrowUp,
          disabled: inboundId <= 0 || isUpdatingPriority || isReorderingByDrag || keyRow.priority <= 1,
          onClick: () => void handleAdjustInboundPriority(row, -1)
        },
        {
          key: 'move-down',
          label: t('users.detail.keyMenu.moveDown', { defaultValue: 'Move down (lower priority)' }),
          icon: ArrowDown,
          disabled: inboundId <= 0 || isUpdatingPriority || isReorderingByDrag || keyRow.priority >= 9999,
          onClick: () => void handleAdjustInboundPriority(row, 1)
        },
        {
          key: 'open-inbounds',
          label: t('users.detail.keyMenu.openInbounds', { defaultValue: 'Open inbounds page' }),
          icon: ExternalLink,
          onClick: () => navigate('/inbounds?tab=inbounds')
        }
      ];

    return (
      <DropdownMenu
        items={menuItems}
        ariaLabel={t('common.moreActions', { defaultValue: 'More actions' })}
        triggerClassName={`rounded-lg border border-line/60 bg-card/70 px-2 py-1 text-foreground transition hover:bg-panel/70 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          mobile ? 'inline-flex h-10 w-10 items-center justify-center' : 'inline-flex h-8 w-8 items-center justify-center'
        }`}
      >
        <MoreVertical className="h-4 w-4" />
      </DropdownMenu>
    );
  };

  const handleApplyMyanmarPriority = async () => {
    const userInbounds = (user.inbounds || []).filter(
      (row) => Number.isInteger(Number(row.inboundId)) && Number(row.inboundId) > 0
    );
    if (userInbounds.length === 0) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('users.detail.toast.noKeys', { defaultValue: 'No keys available for this user.' })
      );
      return;
    }

    setIsApplyingMyanmarPriority(true);
    try {
      const dryRunResponse = await usersApi.previewUserInboundPatternReorder(user.id, 'myanmar');
      const dryRunData = dryRunResponse.data;
      if (!dryRunData) {
        throw new Error(t('users.detail.toast.previewGenerateFailed', { defaultValue: 'Failed to generate preview' }));
      }

      if ((dryRunData.matchedKeys || 0) === 0) {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          t('users.detail.toast.noMyanmarProfiles', {
            defaultValue: 'No Myanmar-compatible profiles found (expected REALITY / VLESS WS TLS / TROJAN WS TLS).'
          })
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
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.myanmarPreviewFailed', { defaultValue: 'Failed to preview Myanmar priority order' })
      );
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
        t('common.success', { defaultValue: 'Success' }),
        t('users.detail.toast.myanmarApplied', {
          defaultValue: 'Promoted {{count}} matching key(s).',
          count: appliedData?.matchedKeys ?? myanmarPreviewState.matchedKeys ?? 0
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.myanmarApplyFailed', { defaultValue: 'Failed to apply Myanmar priority order' })
      );
    } finally {
      setIsApplyingMyanmarPriority(false);
    }
  };

  const handlePreviewQualityOrder = async () => {
    if (!user) {
      return;
    }

    const userInbounds = (user.inbounds || []).filter(
      (row) => Number.isInteger(Number(row.inboundId)) && Number(row.inboundId) > 0
    );
    if (userInbounds.length === 0) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('users.detail.toast.noKeys', { defaultValue: 'No keys available for this user.' })
      );
      return;
    }

    setIsApplyingQualityOrder(true);
    try {
      const previewResponse = await usersApi.previewUserInboundQualityReorder(user.id, { windowMinutes: 60 });
      const previewData = previewResponse.data;
      if (!previewData) {
        throw new Error(t('users.detail.toast.previewGenerateFailed', { defaultValue: 'Failed to generate preview' }));
      }

      if ((previewData.scoredKeys || 0) === 0) {
        toast.warning(
          t('common.warning', { defaultValue: 'Warning' }),
          t('users.detail.toast.noTelemetry', {
            defaultValue: 'No recent connections were detected. Generate traffic on at least one key and try again.'
          })
        );
        return;
      }

      const previewLines = (previewData.preview || []).slice(0, 10).map((entry) => {
        const score = entry.score === null ? '-' : entry.score.toFixed(0);
        return `P${entry.toPriority} • ${entry.key} • score ${score} • connect ${entry.connectSuccesses} • reject ${entry.limitRejects} • reconnect ${entry.reconnects}`;
      });

      setQualityPreviewState({
        windowMinutes: previewData.windowMinutes ?? 60,
        totalKeys: previewData.totalKeys ?? 0,
        scoredKeys: previewData.scoredKeys ?? 0,
        changedKeys: previewData.changedKeys ?? 0,
        currentTop3: previewData.currentTop3 || [],
        newTop3: previewData.newTop3 || [],
        previewLines
      });
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.qualityPreviewFailed', { defaultValue: 'Failed to generate quality preview' })
      );
    } finally {
      setIsApplyingQualityOrder(false);
    }
  };

  const handleConfirmQualityOrderApply = async () => {
    if (!qualityPreviewState || !user) {
      return;
    }

    setIsApplyingQualityOrder(true);
    try {
      const applyResponse = await usersApi.reorderUserInboundsByQuality(user.id, {
        windowMinutes: qualityPreviewState.windowMinutes
      });
      const appliedData = applyResponse.data;

      setSortField('priority');
      setSortDirection('asc');
      setAccessKeyFilter('all');
      setQualityPreviewState(null);
      void refetch();
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('users.detail.toast.qualityApplied', {
          defaultValue: 'Reordered {{count}} key(s) with telemetry.',
          count: appliedData?.scoredKeys ?? qualityPreviewState.scoredKeys
        })
      );
    } catch (error: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.qualityApplyFailed', { defaultValue: 'Failed to apply quality ordering' })
      );
    } finally {
      setIsApplyingQualityOrder(false);
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
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('users.detail.toast.reorderFailed', { defaultValue: 'Failed to reorder keys' })
      );
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
        toast.success(
          t('common.success', { defaultValue: 'Success' }),
          t('users.detail.toast.trafficReset', { defaultValue: 'User traffic counters were reset.' })
        );
        void refetch();
      } else if (pendingConfirm.type === 'delete-user') {
        await deleteUser.mutateAsync(user.id);
        toast.success(
          t('common.success', { defaultValue: 'Success' }),
          t('users.detail.toast.userDeleted', { defaultValue: 'User was deleted successfully.' })
        );
        setPendingConfirm(null);
        navigate('/users');
        return;
      } else if (pendingConfirm.type === 'revoke-device') {
        await revokeUserDevice.mutateAsync({
          id: user.id,
          fingerprint: pendingConfirm.fingerprint
        });
        toast.success(
          t('common.success', { defaultValue: 'Success' }),
          t('users.detail.toast.deviceRevoked', { defaultValue: 'Device session was revoked.' })
        );
        void userDevicesQuery.refetch();
        void userSessionQuery.refetch();
      }
      setPendingConfirm(null);
    } catch (error: any) {
      if (pendingConfirm.type === 'reset-traffic') {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          error?.message || t('users.detail.toast.resetFailed', { defaultValue: 'Failed to reset traffic' })
        );
      } else if (pendingConfirm.type === 'delete-user') {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          error?.message || t('users.detail.toast.deleteFailed', { defaultValue: 'Failed to delete user' })
        );
      } else {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          error?.message || t('users.detail.toast.revokeFailed', { defaultValue: 'Failed to revoke device session' })
        );
      }
    }
  };

  const confirmTitle = pendingConfirm?.type === 'reset-traffic'
    ? t('users.actions.resetTrafficTitle', { defaultValue: 'Reset traffic?' })
    : pendingConfirm?.type === 'delete-user'
      ? t('users.detail.confirm.deleteTitle', { defaultValue: 'Delete user?' })
      : pendingConfirm?.type === 'revoke-device'
        ? t('users.devices.revokeTitle', { defaultValue: 'Revoke Device Session' })
        : '';
  const confirmDescription = pendingConfirm?.type === 'reset-traffic'
    ? t('users.actions.resetTrafficDescription', { defaultValue: "Reset this user's upload/download counters." })
    : pendingConfirm?.type === 'delete-user'
      ? t('users.detail.confirm.deleteDescription', {
        defaultValue: 'Are you sure you want to delete this user? This action cannot be undone.'
      })
      : pendingConfirm?.type === 'revoke-device'
        ? t('users.devices.revokeDescription', { defaultValue: 'Revoke this device? It will need to reconnect.' })
        : '';
  const confirmLabel = pendingConfirm?.type === 'delete-user'
    ? t('common.delete', { defaultValue: 'Delete' })
    : pendingConfirm?.type === 'reset-traffic'
      ? t('common.reset', { defaultValue: 'Reset' })
      : t('common.revoke', { defaultValue: 'Revoke' });
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
            <p className="mt-1 text-sm text-muted">
              {t('users.detail.subtitle', { defaultValue: 'User details & access keys' })}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {renderOnlineKeysPill(onlineKeyCount, enabledKeyCount)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              const panelPath = (import.meta.env.VITE_PANEL_PATH as string | undefined)?.replace(/\/+$/, '') || '';
              window.open(`${panelPath}/user/${user.subscriptionToken}`, '_blank');
            }}
          >
            <LayoutDashboard className="mr-2 h-4 w-4" />
            {t('users.detail.openDashboard', { defaultValue: 'User Dashboard' })}
          </Button>
          <Button variant="secondary" onClick={() => setShowEditModal(true)}>
            <Edit className="mr-2 h-4 w-4" />
            {t('common.edit', { defaultValue: 'Edit' })}
          </Button>
          <Button
            variant="secondary"
            loading={runUserDiagnosticsMutation.isPending}
            onClick={() => {
              void handleRunDiagnostics();
            }}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {t('users.detail.runDiagnostics', { defaultValue: 'Run Diagnostics' })}
          </Button>
          {renderUserHeaderActionMenu()}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <Card>
          <p className="text-sm text-muted">{t('common.status', { defaultValue: 'Status' })}</p>
          <div className="mt-2">{getStatusBadge()}</div>
        </Card>

        <Card>
          <p className="text-sm text-muted">{t('common.online', { defaultValue: 'Online' })}</p>
          <div className="mt-2">{renderOnlinePill(isUserOnline)}</div>
          <p className="mt-1 text-xs text-muted">{lastSeenLabel}</p>
        </Card>

        <Card>
          <p className="text-sm text-muted">{t('users.dataUsed', { defaultValue: 'Data Used' })}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{formatBytes(totalUsed)}</p>
          <p className="mt-1 text-xs text-muted">
            {t('users.detail.dataLimitCaption', {
              defaultValue: 'Limit: {{limit}}',
              limit: formatBytes(dataLimit)
            })}
          </p>
        </Card>

        <Card>
          <p className="text-sm text-muted">{t('users.detail.remaining', { defaultValue: 'Remaining' })}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{formatBytes(remaining)}</p>
          <p className="mt-1 text-xs text-muted">
            {t('users.detail.remainingPercentLeft', {
              defaultValue: '{{percent}}% left',
              percent: remainingPercent.toFixed(1)
            })}
          </p>
        </Card>

        <Card>
          <p className="text-sm text-muted">
            {isDeferredExpiry
              ? t('common.expiry', { defaultValue: 'Expiry' })
              : t('users.detail.expiresIn', { defaultValue: 'Expires in' })}
          </p>
          {isDeferredExpiry ? (
            <>
              <p className="mt-2 text-base font-semibold text-foreground">
                {t('users.startOnFirstConnect', { defaultValue: 'Starts on first connect' })}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t('users.detail.expiry.afterFirstConnect', {
                  defaultValue: '{{days}} days after first connect',
                  days: daysRemaining
                })}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {t('users.detail.expiry.daysValue', { defaultValue: '{{count}} days', count: daysRemaining })}
              </p>
              <p className="mt-1 text-xs text-muted">{formatDate(user.expireDate)}</p>
            </>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {t('users.detail.diagnostics.panelTitle', { defaultValue: 'Connection diagnostics' })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('users.detail.diagnostics.panelSubtitle', {
                defaultValue: 'Run health checks for runtime, key config, port reachability, and live sessions.'
              })}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={runUserDiagnosticsMutation.isPending}
            onClick={() => {
              void handleRunDiagnostics();
            }}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {t('users.detail.runDiagnostics', { defaultValue: 'Run Diagnostics' })}
          </Button>
        </div>

        <div className="mb-4 rounded-xl border border-line/70 bg-panel/55 p-3 text-xs text-muted">
          <p>
            {t('users.telemetry.label', { defaultValue: 'Telemetry' })}:{' '}
            <span className="font-medium text-foreground">{telemetryStatusLabel}</span>
            {' • '}
            {telemetryLagLabel}
          </p>
          {telemetrySync?.lastErrorMessage ? (
            <p className="mt-1 text-rose-300">
              {t('users.telemetry.lastError', { defaultValue: 'Last error: {{message}}', message: telemetrySync.lastErrorMessage })}
            </p>
          ) : null}
        </div>

        {!diagnosticsResult ? (
          <div className="rounded-xl border border-line/70 bg-panel/45 p-4 text-sm text-muted">
            {t('users.detail.diagnostics.empty', {
              defaultValue: 'No diagnostics report yet. Click "Run Diagnostics" to generate one.'
            })}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-line/70 bg-card/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted">{t('common.pass', { defaultValue: 'Pass' })}</p>
                <p className="mt-1 text-lg font-semibold text-emerald-400">{diagnosticsResult.summary.pass}</p>
              </div>
              <div className="rounded-lg border border-line/70 bg-card/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted">{t('common.warning', { defaultValue: 'Warning' })}</p>
                <p className="mt-1 text-lg font-semibold text-amber-300">{diagnosticsResult.summary.warn}</p>
              </div>
              <div className="rounded-lg border border-line/70 bg-card/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted">{t('common.fail', { defaultValue: 'Fail' })}</p>
                <p className="mt-1 text-lg font-semibold text-rose-400">{diagnosticsResult.summary.fail}</p>
              </div>
              <div className="rounded-lg border border-line/70 bg-card/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted">{t('common.total', { defaultValue: 'Total' })}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{diagnosticsResult.summary.total}</p>
              </div>
            </div>

            <div className="space-y-2">
              {(diagnosticsResult.checks || []).map((check) => (
                <div
                  key={check.id}
                  className="rounded-xl border border-line/70 bg-panel/45 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{check.label}</p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        check.status === 'PASS'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : check.status === 'WARN'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {check.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{check.details}</p>
                  {check.recommendedAction ? (
                    <p className="mt-1 text-xs text-amber-300">{check.recommendedAction}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">
          {t('users.detail.userInfoTitle', { defaultValue: 'User Information' })}
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="text-sm text-muted">{t('users.email', { defaultValue: 'Email' })}</label>
            <p className="mt-1 font-medium text-foreground">{user.email}</p>
          </div>

          <div>
            <label className="text-sm text-muted">{t('users.uuid', { defaultValue: 'UUID' })}</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded-lg border border-line/70 bg-panel/70 px-2 py-1 font-mono text-sm text-foreground">
                {user.uuid}
              </code>
              <button
                onClick={() => {
                  void copyToClipboard('uuid', user.uuid);
                }}
                className="rounded p-1 transition-colors hover:bg-card"
                aria-label={t('users.detail.copyUuid', { defaultValue: 'Copy UUID' })}
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
            <label className="text-sm text-muted">{t('auth.password', { defaultValue: 'Password' })}</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded-lg border border-line/70 bg-panel/70 px-2 py-1 font-mono text-sm text-foreground">
                {user.password}
              </code>
              <button
                onClick={() => {
                  void copyToClipboard('password', user.password);
                }}
                className="rounded p-1 transition-colors hover:bg-card"
                aria-label={t('users.detail.copyPassword', { defaultValue: 'Copy password' })}
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
            <label className="text-sm text-muted">{t('users.detail.createdAt', { defaultValue: 'Created at' })}</label>
            <p className="mt-1 text-foreground">{formatDate(user.createdAt)}</p>
          </div>

          {user.note ? (
            <div className="md:col-span-2">
              <label className="text-sm text-muted">{t('users.note', { defaultValue: 'Note' })}</label>
              <p className="mt-1 text-foreground">{user.note}</p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {t('users.detail.effectiveInbounds.title', { defaultValue: 'Effective inbound access' })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('users.detail.effectiveInbounds.subtitle', {
                defaultValue: 'Combined view of direct assignments and inherited group mappings.'
              })}
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
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>

        {effectiveInboundsQuery.isLoading ? (
          <div className="py-4 text-sm text-muted">
            {t('users.detail.effectiveInbounds.loading', { defaultValue: 'Loading effective access...' })}
          </div>
        ) : !effectiveInboundsPayload || effectiveInboundsPayload.effectiveInbounds.length === 0 ? (
          <div className="rounded-xl border border-line/70 bg-panel/55 p-4 text-sm text-muted">
            {t('users.detail.effectiveInbounds.empty', { defaultValue: 'No effective inbounds found for this user.' })}
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
                    {entry.inbound.enabled
                      ? t('users.detail.effectiveInbounds.badgeEnabled', { defaultValue: 'Inbound enabled' })
                      : t('users.detail.effectiveInbounds.badgeDisabled', { defaultValue: 'Inbound disabled' })}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.sources.map((source, index) => (
                    <span
                      key={`effective-source-${entry.inboundId}-${index}`}
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${source.type === 'DIRECT'
                        ? 'bg-brand-500/20 text-brand-200'
                        : 'bg-violet-500/20 text-violet-200'
                        }`}
                    >
                      {source.type === 'DIRECT'
                        ? t('users.detail.effectiveInbounds.sourceDirect', { defaultValue: 'Direct' })
                        : t('users.detail.effectiveInbounds.sourceGroup', {
                          defaultValue: 'Group: {{name}}',
                          name: source.groupName || String(source.groupId)
                        })}
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
            <h2 className="text-xl font-bold text-foreground">
              {t('users.detail.policy.title', { defaultValue: 'Effective policy' })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('users.detail.policy.subtitle', {
                defaultValue: 'Compare direct user policy with inherited group policy overrides.'
              })}
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
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>

        {effectivePolicyQuery.isLoading ? (
          <div className="py-4 text-sm text-muted">
            {t('users.detail.policy.loading', { defaultValue: 'Loading effective policy...' })}
          </div>
        ) : !effectivePolicyPayload ? (
          <div className="rounded-xl border border-line/70 bg-panel/55 p-4 text-sm text-muted">
            {t('users.detail.policy.unavailable', { defaultValue: 'Effective policy is unavailable for this user.' })}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-line/70 bg-panel/55">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="bg-panel/80 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      {t('users.detail.policy.table.field', { defaultValue: 'Field' })}
                    </th>
                    <th className="px-4 py-3 text-left">
                      {t('users.detail.policy.table.direct', { defaultValue: 'Direct' })}
                    </th>
                    <th className="px-4 py-3 text-left">
                      {t('users.detail.policy.table.inherited', { defaultValue: 'Inherited' })}
                    </th>
                    <th className="px-4 py-3 text-left">
                      {t('users.detail.policy.table.effective', { defaultValue: 'Effective' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {t('users.dataLimit', { defaultValue: 'Data Limit' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatBytes(Number(effectivePolicyPayload.directPolicy.dataLimit || 0))}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.dataLimit !== null
                        ? formatBytes(Number(effectivePolicyPayload.inheritedPolicy.dataLimit || 0))
                        : t('common.noOverride', { defaultValue: 'No override' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatBytes(Number(effectivePolicyPayload.effectivePolicy.dataLimit || 0))}
                      {effectivePolicyPayload.drift.dataLimit ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                          {t('common.drift', { defaultValue: 'Drift' })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {t('common.expiry', { defaultValue: 'Expiry' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">{formatDate(effectivePolicyPayload.directPolicy.expireDate)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.expireDate
                        ? formatDate(effectivePolicyPayload.inheritedPolicy.expireDate)
                        : t('common.noOverride', { defaultValue: 'No override' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatDate(effectivePolicyPayload.effectivePolicy.expireDate)}
                      {effectivePolicyPayload.drift.expireDate ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                          {t('common.drift', { defaultValue: 'Drift' })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {t('users.form.ipLimitLabel', { defaultValue: 'IP Limit' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">{effectivePolicyPayload.directPolicy.ipLimit}</td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.ipLimit ?? t('common.noOverride', { defaultValue: 'No override' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.effectivePolicy.ipLimit}
                      {effectivePolicyPayload.drift.ipLimit ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                          {t('common.drift', { defaultValue: 'Drift' })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {t('common.status', { defaultValue: 'Status' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">{effectivePolicyPayload.directPolicy.status}</td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.status || t('common.noOverride', { defaultValue: 'No override' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.effectivePolicy.status}
                      {effectivePolicyPayload.drift.status ? (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                          {t('common.drift', { defaultValue: 'Drift' })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  <tr className="border-t border-line/70">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {t('users.detail.policy.table.trafficReset', { defaultValue: 'Traffic reset' })}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.directPolicy.trafficResetPeriod}
                      {effectivePolicyPayload.directPolicy.trafficResetDay
                        ? ` @${effectivePolicyPayload.directPolicy.trafficResetDay}`
                        : ''}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {effectivePolicyPayload.inheritedPolicy.trafficResetPeriod
                        ? `${effectivePolicyPayload.inheritedPolicy.trafficResetPeriod}${effectivePolicyPayload.inheritedPolicy.trafficResetDay
                          ? ` @${effectivePolicyPayload.inheritedPolicy.trafficResetDay}`
                          : ''
                        }`
                        : t('common.noOverride', { defaultValue: 'No override' })}
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
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                {t('users.detail.policy.groupSources', { defaultValue: 'Group policy sources' })}
              </p>
              <div className="flex flex-wrap gap-2">
                {effectivePolicyPayload.groups.length === 0 ? (
                  <span className="text-sm text-muted">
                    {t('users.detail.policy.noGroups', { defaultValue: 'No active groups assigned' })}
                  </span>
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
              <h2 className="text-xl font-bold text-foreground">
                {t('users.detail.keys.title', { defaultValue: 'Access keys' })}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {t('users.detail.keys.subtitle', {
                  defaultValue: 'Manage per-inbound keys, status, online visibility, and client templates.'
                })}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={accessKeyFilter}
                onChange={(event) => setAccessKeyFilter(event.target.value as AccessKeyFilter)}
                className="rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="all">{t('users.detail.keys.filter.all', { defaultValue: 'All keys' })}</option>
                <option value="enabled">{t('common.enabled', { defaultValue: 'Enabled' })}</option>
                <option value="disabled">{t('common.disabled', { defaultValue: 'Disabled' })}</option>
                <option value="online">{t('common.online', { defaultValue: 'Online' })}</option>
                <option value="offline">{t('common.offline', { defaultValue: 'Offline' })}</option>
              </select>

              <select
                value={String(refreshInterval)}
                onChange={(event) => setRefreshInterval(Number(event.target.value))}
                className="rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                {REFRESH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t('common.refresh', { defaultValue: 'Refresh' })} {option.label}
                  </option>
                ))}
              </select>

              <select
                value={accessKeyDensity}
                onChange={(event) => setAccessKeyDensity(event.target.value as AccessKeyDensity)}
                className="rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="comfortable">{t('users.detail.keys.density.comfortable', { defaultValue: 'Comfortable rows' })}</option>
                <option value="compact">{t('users.detail.keys.density.compact', { defaultValue: 'Compact rows' })}</option>
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
                {t('common.refresh', { defaultValue: 'Refresh' })}
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
                {t('users.myanmarPriority', { defaultValue: 'Myanmar Priority' })}
              </Button>

              <Button
                size="sm"
                variant="secondary"
                loading={isApplyingQualityOrder}
                disabled={isReorderingByDrag || (user.inbounds || []).length === 0}
                onClick={() => {
                  void handlePreviewQualityOrder();
                }}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {t('users.autoTune', { defaultValue: 'Auto-tune' })}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            {isDragReorderEnabled
              ? t('users.detail.keys.dragHintEnabled', {
                defaultValue: 'Drag rows from the Menu column to reorder key priority. The order controls subscription fallback.'
              })
              : t('users.detail.keys.dragHintDisabled', {
                defaultValue: 'Enable drag reorder by setting Filter: All keys and Sort: Priority ascending.'
              })}
          </p>
        </div>

        {filteredAndSortedKeyRows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted">
            {t('users.detail.keys.empty', { defaultValue: 'No keys match the selected filter.' })}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className={`min-w-[1100px] w-full ${accessKeyDensity === 'compact' ? 'text-xs' : 'text-sm'}`}>
                <thead className="bg-panel/65">
                  <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-muted">
                    <th className={tableHeaderCellClass}>
                      {t('users.detail.keys.table.menu', { defaultValue: 'Menu' })}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {renderSortableHeader(t('common.enabled', { defaultValue: 'Enabled' }), 'enabled')}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {renderSortableHeader(t('common.online', { defaultValue: 'Online' }), 'online')}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {renderSortableHeader(t('users.detail.keys.table.clientKey', { defaultValue: 'Client / Key' }), 'key')}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {renderSortableHeader(t('users.detail.keys.table.protocol', { defaultValue: 'Protocol' }), 'protocol')}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {renderSortableHeader(t('users.detail.keys.table.port', { defaultValue: 'Port' }), 'port')}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {renderSortableHeader(t('users.detail.keys.table.priority', { defaultValue: 'Priority' }), 'priority')}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {t('users.detail.keys.table.traffic', { defaultValue: 'Traffic' })}
                    </th>
                    <th className={tableHeaderCellClass}>
                      {renderSortableHeader(t('users.detail.keys.table.expiration', { defaultValue: 'Expiration' }), 'expiration')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedKeyRows.map((keyRow) => {
                    const row = keyRow.relation;
                    const inboundId = Number.parseInt(String(row.inboundId || 0), 10);
                    const rowLastSeenLabel = getRelativeLastSeenLabel(t, keyRow.online, keyRow.lastSeenAt, nowTimestamp);
                    const isInboundDragEnabled = isDragReorderEnabled && inboundId > 0 && !isReorderingByDrag;
                    const isDraggedRow = draggingInboundId === inboundId;
                    const isDropTargetRow = dragOverInboundId === inboundId && draggingInboundId !== inboundId;
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-line/70 transition-colors hover:bg-panel/35 ${isDraggedRow ? 'bg-brand-500/10' : ''
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
                              className={`inline-flex items-center rounded p-1 ${isInboundDragEnabled ? 'cursor-grab text-muted hover:bg-panel/70 hover:text-foreground' : 'text-muted/40'
                                }`}
                              title={
                                isDragReorderEnabled
                                  ? t('users.detail.keys.dragHandleEnabled', { defaultValue: 'Drag to reorder priority' })
                                  : t('users.detail.keys.dragHandleDisabled', {
                                    defaultValue: 'Sort by priority ascending to enable drag reorder'
                                  })
                              }
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
                            aria-label={
                              row.enabled
                                ? t('users.detail.keyMenu.disableKey', { defaultValue: 'Disable key' })
                                : t('users.detail.keyMenu.enableKey', { defaultValue: 'Enable key' })
                            }
                            title={
                              row.enabled
                                ? t('users.detail.keyMenu.disableKey', { defaultValue: 'Disable key' })
                                : t('users.detail.keyMenu.enableKey', { defaultValue: 'Enable key' })
                            }
                            disabled={togglingInboundId === row.inboundId}
                            onClick={() => {
                              void handleToggleInboundKey(row);
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full border border-line/70 transition focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${row.enabled ? 'bg-emerald-500/25' : 'bg-panel/70'
                              }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full border border-line/70 bg-white shadow-sm transition ${row.enabled ? 'translate-x-5' : 'translate-x-1'
                                }`}
                            />
                          </button>
                        </td>

                        <td className={tableBodyCellClass}>
                          {renderOnlinePill(keyRow.online)}
                          <p className="mt-1 text-[11px] text-muted">{rowLastSeenLabel}</p>
                          {keyRow.seenDevices > 0 ? (
                            <p className="mt-0.5 text-[11px] text-muted">
                              {t('users.detail.keys.devicesCount', {
                                defaultValue: 'Devices {{online}}/{{seen}}',
                                online: keyRow.onlineDevices,
                                seen: keyRow.seenDevices
                              })}
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
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs ${keyRow.expirationDays <= 0
                              ? 'bg-red-500/20 text-red-300'
                              : keyRow.expirationDays <= 7
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-brand-500/20 text-brand-200'
                              }`}
                          >
                            {keyRow.expirationDays <= 0
                              ? t('common.expired', { defaultValue: 'Expired' })
                              : t('users.detail.keys.shortDays', { defaultValue: '{{count}}d', count: keyRow.expirationDays })}
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
                const rowLastSeenLabel = getRelativeLastSeenLabel(t, keyRow.online, keyRow.lastSeenAt, nowTimestamp);
                return (
                  <div key={`mobile-${row.id}`} className={`rounded-xl border border-line/70 bg-card/70 ${mobileCardPaddingClass}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{keyRow.label}</p>
                        <p className="text-xs text-muted">
                          {keyRow.protocol} · {t('users.detail.keys.portLabelShort', { defaultValue: 'Port' })} {keyRow.port}
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
                            {t('users.detail.keys.devicesCount', {
                              defaultValue: 'Devices {{online}}/{{seen}}',
                              online: keyRow.onlineDevices,
                              seen: keyRow.seenDevices
                            })}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className={`mt-3 ${mobileSectionSpacingClass}`}>
                      <p className="text-xs text-muted">
                        {t('users.detail.keys.table.priority', { defaultValue: 'Priority' })}:{' '}
                        <span className="inline-flex items-center rounded-full border border-line/70 bg-card/70 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                          {keyRow.priority}
                        </span>
                      </p>
                      <p className="text-xs text-muted">
                        {t('users.detail.keys.usageLabel', { defaultValue: 'Usage' })}:{' '}
                        {formatBytes(totalUsed)} / {dataLimit > 0 ? formatBytes(dataLimit) : '∞'}
                      </p>
                      <div className="h-2 rounded-full bg-panel/80">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted">
                        {t('users.detail.keys.table.expiration', { defaultValue: 'Expiration' })}:{' '}
                        {keyRow.expirationDays <= 0
                          ? t('common.expired', { defaultValue: 'Expired' })
                          : t('common.daysLeft', { defaultValue: '{{count}} days left', count: keyRow.expirationDays })}
                      </p>
                    </div>

                    <div className={`${mobileActionsMarginClass} flex items-center justify-between rounded-xl border border-line/70 bg-panel/40 px-3 py-2`}>
                      <span className="text-xs font-medium text-foreground">{t('common.enabled', { defaultValue: 'Enabled' })}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.enabled}
                        aria-label={
                          row.enabled
                            ? t('users.detail.keyMenu.disableKey', { defaultValue: 'Disable key' })
                            : t('users.detail.keyMenu.enableKey', { defaultValue: 'Enable key' })
                        }
                        title={
                          row.enabled
                            ? t('users.detail.keyMenu.disableKey', { defaultValue: 'Disable key' })
                            : t('users.detail.keyMenu.enableKey', { defaultValue: 'Enable key' })
                        }
                        disabled={togglingInboundId === row.inboundId}
                        onClick={() => {
                          void handleToggleInboundKey(row);
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full border border-line/70 transition focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${row.enabled ? 'bg-emerald-500/25' : 'bg-card/70'
                          }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full border border-line/70 bg-white shadow-sm transition ${row.enabled ? 'translate-x-5' : 'translate-x-1'
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
            <h2 className="text-xl font-bold text-foreground">
              {t('users.detail.devicesSessions.title', { defaultValue: 'Device sessions' })}
            </h2>
            <p className="text-xs text-muted">
              {t('users.detail.devicesSessions.subtitle', {
                defaultValue: '{{online}} online / {{total}} seen in last {{minutes}} minutes',
                online: userDevicesQuery.data?.data?.online || 0,
                total: userDevicesQuery.data?.data?.total || 0,
                minutes: 60
              })}
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
          <p className="text-sm text-muted">
            {t('users.devices.noneRecent', { defaultValue: 'No devices tracked in the last {{minutes}} minutes.', minutes: 60 })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line/70">
                  <th className="py-2 pr-3">{t('common.status', { defaultValue: 'Status' })}</th>
                  <th className="py-2 pr-3">{t('users.detail.devicesSessions.columns.fingerprint', { defaultValue: 'Fingerprint' })}</th>
                  <th className="py-2 pr-3">{t('users.detail.devicesSessions.columns.ip', { defaultValue: 'IP' })}</th>
                  <th className="py-2 pr-3">{t('users.detail.devicesSessions.columns.lastSeen', { defaultValue: 'Last seen' })}</th>
                  <th className="py-2 text-right">{t('common.action', { defaultValue: 'Action' })}</th>
                </tr>
              </thead>
              <tbody>
                {userDevices.slice(0, 12).map((device) => (
                  <tr key={device.fingerprint} className="border-b border-line/50">
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${device.online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-300'
                          }`}
                      >
                        <span className="relative inline-flex h-2.5 w-2.5">
                          {device.online ? (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                          ) : null}
                          <span
                            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${device.online ? 'bg-emerald-400' : 'bg-zinc-400'
                              }`}
                          />
                        </span>
                        {device.online
                          ? t('common.online', { defaultValue: 'Online' })
                          : t('common.offline', { defaultValue: 'Offline' })}
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
                        {t('common.revoke', { defaultValue: 'Revoke' })}
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
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
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
        title={t('users.myanmarPriorityPreviewTitle', { defaultValue: 'Myanmar Priority Preview' })}
        description={t('users.myanmarPriorityPreviewBody', { defaultValue: 'Review current and new fallback order before applying.' })}
        summaryRows={[
          { label: t('users.preview.totalKeys', { defaultValue: 'Total keys' }), value: myanmarPreviewState?.totalKeys ?? 0 },
          { label: t('users.preview.matchedKeys', { defaultValue: 'Matched keys' }), value: myanmarPreviewState?.matchedKeys ?? 0 },
          { label: t('users.preview.keysToReorder', { defaultValue: 'Keys to reorder' }), value: myanmarPreviewState?.changedKeys ?? 0 }
        ]}
        currentTop3={myanmarPreviewState?.currentTop3 || []}
        newTop3={myanmarPreviewState?.newTop3 || []}
        confirmLabel={t('users.applyPriority', { defaultValue: 'Apply Priority' })}
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

      <MyanmarPriorityPreviewModal
        open={Boolean(qualityPreviewState)}
        title={t('users.qualityAutoTunePreviewTitle', { defaultValue: 'Quality Auto-tune Preview' })}
        description={t('users.qualityAutoTunePreviewBody', { defaultValue: 'Reorder keys based on recent connect success, rejects, and reconnects.' })}
        summaryRows={[
          { label: t('users.preview.totalKeys', { defaultValue: 'Total keys' }), value: qualityPreviewState?.totalKeys ?? 0 },
          { label: t('users.preview.telemetryKeys', { defaultValue: 'Telemetry keys' }), value: qualityPreviewState?.scoredKeys ?? 0 },
          { label: t('users.preview.keysToReorder', { defaultValue: 'Keys to reorder' }), value: qualityPreviewState?.changedKeys ?? 0 }
        ]}
        currentTop3={(qualityPreviewState?.currentTop3 || []).map((entry) => ({ key: entry.key, toPriority: entry.fromPriority }))}
        newTop3={(qualityPreviewState?.newTop3 || []).map((entry) => ({ key: entry.key, toPriority: entry.toPriority }))}
        previewLines={qualityPreviewState?.previewLines || []}
        confirmLabel={t('users.applyAutoTune', { defaultValue: 'Apply Auto-tune' })}
        loading={isApplyingQualityOrder}
        disableConfirm={!qualityPreviewState || qualityPreviewState.changedKeys === 0}
        onClose={() => {
          if (!isApplyingQualityOrder) {
            setQualityPreviewState(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmQualityOrderApply();
        }}
      />
    </div>
  );
};

export const UserDetailPage = UserDetail;
