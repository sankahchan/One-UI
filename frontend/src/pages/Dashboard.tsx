import React from 'react';
import { Activity, HardDrive, TrendingUp, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import apiClient from '../api/client';
import { Card } from '../components/atoms/Card';
import { OnlineUsers } from '../components/organisms/OnlineUsers';
import { SystemHealthCard } from '../components/organisms/SystemHealthCard';
import { UpdateHealthCard } from '../components/organisms/UpdateHealthCard';
import { Skeleton } from '../components/atoms/Skeleton';
import { formatBytes } from '../utils/formatters';

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['system-stats'],
    queryFn: () => apiClient.get('/users/stats')
  });
  const { data: sessionsSnapshot } = useQuery({
    queryKey: ['dashboard-session-quality'],
    queryFn: () =>
      apiClient.get('/users/sessions', {
        params: {
          includeOffline: true,
          limit: 500
        }
      }),
    refetchInterval: 15_000
  });

  const statsData = stats?.data || {
    total: 0,
    active: 0,
    expired: 0,
    totalUpload: 0,
    totalDownload: 0,
    totalTraffic: 0
  };

  const cards = [
    {
      key: 'total-users',
      icon: Users,
      label: t('dashboard.totalUsers'),
      value: statsData.total,
      tone: 'from-brand-500/15 to-brand-600/5 text-brand-500'
    },
    {
      key: 'active-users',
      icon: Activity,
      label: t('dashboard.activeUsers'),
      value: statsData.active,
      tone: 'from-emerald-500/15 to-emerald-500/5 text-emerald-500'
    },
    {
      key: 'total-traffic',
      icon: HardDrive,
      label: t('dashboard.totalTraffic'),
      value: formatBytes(statsData.totalTraffic),
      tone: 'from-violet-500/15 to-violet-500/5 text-violet-500'
    },
    {
      key: 'expired-users',
      icon: TrendingUp,
      label: t('dashboard.expiredUsers'),
      value: statsData.expired,
      tone: 'from-rose-500/15 to-rose-500/5 text-rose-500'
    }
  ];
  const qualitySummary = (sessionsSnapshot?.data?.sessions || []).reduce(
    (acc: { connects: number; rejects: number; reconnects: number; trafficPerMinute: number }, session: any) => {
      acc.connects += Number(session?.quality?.connectSuccesses || 0);
      acc.rejects += Number(session?.quality?.limitRejects || 0);
      acc.reconnects += Number(session?.quality?.reconnects || 0);
      acc.trafficPerMinute += Number(session?.quality?.avgTrafficPerMinute || 0);
      return acc;
    },
    { connects: 0, rejects: 0, reconnects: 0, trafficPerMinute: 0 }
  );
  const topProtocolQuality = React.useMemo(() => {
    const aggregate = new Map<string, { protocol: string; connects: number; rejects: number; reconnects: number; trafficPerMinute: number }>();

    for (const session of sessionsSnapshot?.data?.sessions || []) {
      for (const entry of session?.quality?.byProtocol || []) {
        const protocol = String(entry?.protocol || 'UNKNOWN').toUpperCase();
        const existing = aggregate.get(protocol) || {
          protocol,
          connects: 0,
          rejects: 0,
          reconnects: 0,
          trafficPerMinute: 0
        };

        existing.connects += Number(entry?.connectSuccesses || 0);
        existing.rejects += Number(entry?.limitRejects || 0);
        existing.reconnects += Number(entry?.reconnects || 0);
        existing.trafficPerMinute += Number(entry?.avgTrafficPerMinute || 0);
        aggregate.set(protocol, existing);
      }
    }

    const toScore = (item: { connects: number; rejects: number; reconnects: number }) => {
      const attempts = item.connects + item.rejects;
      const rejectRate = attempts > 0 ? item.rejects / attempts : 0;
      const reconnectPenalty = item.connects > 0 ? item.reconnects / item.connects : item.reconnects;
      return Number(((item.connects * 10) - (item.rejects * 16) - (item.reconnects * 6) - (rejectRate * 25) - (reconnectPenalty * 10)).toFixed(2));
    };

    return Array.from(aggregate.values())
      .map((item) => ({ ...item, score: toScore(item) }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.connects !== b.connects) return b.connects - a.connects;
        return a.protocol.localeCompare(b.protocol);
      })
      .slice(0, 4);
  }, [sessionsSnapshot?.data?.sessions]);
  const topProfileQuality = React.useMemo(() => {
    const aggregate = new Map<
      string,
      {
        key: string;
        inboundId: number | null;
        tag: string;
        protocol: string;
        port: number;
        connects: number;
        rejects: number;
        reconnects: number;
        trafficPerMinute: number;
      }
    >();

    for (const session of sessionsSnapshot?.data?.sessions || []) {
      for (const entry of session?.quality?.byProfile || []) {
        const inboundId = Number.isInteger(Number(entry?.inboundId)) ? Number(entry.inboundId) : null;
        const protocol = String(entry?.protocol || 'UNKNOWN').toUpperCase();
        const tag = String(entry?.tag || (inboundId ? `inbound-${inboundId}` : 'unknown'));
        const key = inboundId ? `id:${inboundId}` : `tag:${tag}`;
        const existing = aggregate.get(key) || {
          key,
          inboundId,
          tag,
          protocol,
          port: Number(entry?.port || 0),
          connects: 0,
          rejects: 0,
          reconnects: 0,
          trafficPerMinute: 0
        };

        existing.connects += Number(entry?.connectSuccesses || 0);
        existing.rejects += Number(entry?.limitRejects || 0);
        existing.reconnects += Number(entry?.reconnects || 0);
        existing.trafficPerMinute += Number(entry?.avgTrafficPerMinute || 0);
        aggregate.set(key, existing);
      }
    }

    const toScore = (item: { connects: number; rejects: number; reconnects: number }) => {
      const attempts = item.connects + item.rejects;
      const rejectRate = attempts > 0 ? item.rejects / attempts : 0;
      const reconnectPenalty = item.connects > 0 ? item.reconnects / item.connects : item.reconnects;
      return Number(((item.connects * 10) - (item.rejects * 16) - (item.reconnects * 6) - (rejectRate * 25) - (reconnectPenalty * 10)).toFixed(2));
    };

    return Array.from(aggregate.values())
      .map((item) => ({ ...item, score: toScore(item) }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.connects !== b.connects) return b.connects - a.connects;
        return a.tag.localeCompare(b.tag);
      })
      .slice(0, 6);
  }, [sessionsSnapshot?.data?.sessions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-muted">Realtime overview of your users, usage, and service status.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="relative overflow-hidden">
                <div className="flex items-start justify-between">
                  <div className="space-y-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-7 w-16" />
                  </div>
                  <Skeleton className="h-10 w-10 rounded-xl" />
                </div>
              </Card>
            ))
          : cards.map(({ key, icon: Icon, label, value, tone }) => (
              <Card key={key} className="relative overflow-hidden">
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone} opacity-90`} />
                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
                  </div>
                  <div className="rounded-xl border border-line/70 bg-card/70 p-2.5">
                    <Icon className="h-5 w-5 text-foreground" />
                  </div>
                </div>
              </Card>
            ))}
      </div>

      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-500/10 via-emerald-500/5 to-transparent" />
        <div className="relative grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Connect Success (60m)</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{qualitySummary.connects}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Limit Rejects (60m)</p>
            <p className="mt-1 text-xl font-semibold text-rose-400">{qualitySummary.rejects}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Reconnects (60m)</p>
            <p className="mt-1 text-xl font-semibold text-amber-300">{qualitySummary.reconnects}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Avg Traffic / Min</p>
            <p className="mt-1 text-xl font-semibold text-emerald-400">{formatBytes(qualitySummary.trafficPerMinute)}</p>
          </div>
        </div>
      </Card>

      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-violet-500/10 via-brand-500/5 to-transparent" />
        <div className="relative">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Top Profile Quality (60m)</h2>
          {topProtocolQuality.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No profile quality data yet.</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {topProtocolQuality.map((row) => (
                <div key={row.protocol} className="rounded-xl border border-line/70 bg-panel/45 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">{row.protocol}</p>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${row.score >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {row.score}
                    </span>
                  </div>
                  <p className="mt-2 text-muted">Connect {row.connects} • Reject {row.rejects} • Reconnect {row.reconnects}</p>
                  <p className="mt-1 text-muted">Traffic/min {formatBytes(row.trafficPerMinute)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-brand-500/5 to-transparent" />
        <div className="relative">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Top Inbound Profiles (60m)</h2>
          {topProfileQuality.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No inbound profile telemetry yet.</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {topProfileQuality.map((row) => (
                <div key={row.key} className="rounded-xl border border-line/70 bg-panel/45 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">
                      {row.protocol} • {row.port || '-'}
                    </p>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${row.score >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {row.score}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-muted" title={row.tag}>
                    {row.tag}
                  </p>
                  <p className="mt-2 text-muted">Connect {row.connects} • Reject {row.rejects} • Reconnect {row.reconnects}</p>
                  <p className="mt-1 text-muted">Traffic/min {formatBytes(row.trafficPerMinute)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <UpdateHealthCard />
        {isLoading ? (
          <Card>
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-32 w-full" />
            </div>
          </Card>
        ) : (
          <SystemHealthCard />
        )}
        {isLoading ? (
          <Card>
            <Skeleton className="mb-4 h-5 w-32" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-32 w-full" />
            </div>
          </Card>
        ) : (
          <OnlineUsers />
        )}
      </div>
    </div>
  );
};

export const DashboardPage = Dashboard;
