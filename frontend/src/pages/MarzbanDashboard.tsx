import React from 'react';
import { Activity, HardDrive, TrendingUp, Users, Server, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { getSystemStats } from '../lib/api/users';
import { Card } from '../components/atoms/Card';
import { Skeleton } from '../components/atoms/Skeleton';
import { formatBytes } from '../utils/formatters';

export const Dashboard: React.FC = () => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['marzban-system-stats'],
    queryFn: getSystemStats,
    refetchInterval: 15_000
  });

  const statsData = stats || {
    total_user: 0,
    users_active: 0,
    users_disabled: 0,
    users_limited: 0,
    users_expired: 0,
    cpu_usage: 0,
    mem_used: 0,
    mem_total: 0,
    incoming_bandwidth: 0,
    outgoing_bandwidth: 0
  };

  const cards = [
    {
      key: 'total-users',
      icon: Users,
      label: 'Total Users',
      value: statsData.total_user,
      tone: 'from-brand-500/15 to-brand-600/5 text-brand-500'
    },
    {
      key: 'active-users',
      icon: Activity,
      label: 'Active Users',
      value: statsData.users_active,
      tone: 'from-emerald-500/15 to-emerald-500/5 text-emerald-500'
    },
    {
      key: 'limited-users',
      icon: TrendingUp,
      label: 'Limited Users',
      value: statsData.users_limited,
      tone: 'from-amber-500/15 to-amber-500/5 text-amber-500'
    },
    {
      key: 'expired-users',
      icon: TrendingUp,
      label: 'Expired Users',
      value: statsData.users_expired,
      tone: 'from-rose-500/15 to-rose-500/5 text-rose-500'
    },
    {
      key: 'cpu-usage',
      icon: Server,
      label: 'CPU Usage',
      value: `${statsData.cpu_usage.toFixed(1)}%`,
      tone: 'from-blue-500/15 to-blue-500/5 text-blue-500'
    },
    {
      key: 'memory-usage',
      icon: HardDrive,
      label: 'Memory (Used / Total)',
      value: `${formatBytes(statsData.mem_used)} / ${formatBytes(statsData.mem_total)}`,
      tone: 'from-cyan-500/15 to-cyan-500/5 text-cyan-500'
    },
    {
      key: 'bandwidth-in',
      icon: Zap,
      label: 'Incoming Bandwidth',
      value: formatBytes(statsData.incoming_bandwidth),
      tone: 'from-violet-500/15 to-violet-500/5 text-violet-500'
    },
    {
      key: 'bandwidth-out',
      icon: Zap,
      label: 'Outgoing Bandwidth',
      value: formatBytes(statsData.outgoing_bandwidth),
      tone: 'from-fuchsia-500/15 to-fuchsia-500/5 text-fuchsia-500'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{'System Dashboard'}</h1>
          <p className="mt-1 text-sm text-muted">
            {'Realtime Marzban integration overview'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-20" />
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
    </div>
  );
};

export const DashboardPage = Dashboard;
