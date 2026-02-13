import { Activity, HardDrive, Users } from 'lucide-react';

import { useSystemStats } from '../../hooks/useStats';
import { formatBytes } from '../../utils/formatters';
import { Spinner } from '../atoms/Spinner';
import { StatCard } from '../molecules/StatCard';

export function SystemStats() {
  const { data, isLoading } = useSystemStats();

  if (isLoading || !data) {
    return (
      <div className="flex h-28 items-center justify-center rounded-xl border border-slate-700 bg-surface-800/70">
        <Spinner />
      </div>
    );
  }

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <StatCard icon={Users} label="Users" value={data.users.total.toLocaleString()} helper="Total users in panel" />
      <StatCard icon={HardDrive} label="Active Users" value={data.users.active.toLocaleString()} helper="Users with ACTIVE status" />
      <StatCard
        icon={Activity}
        label="Total Traffic"
        value={formatBytes(Number(data.traffic.totalTraffic))}
        helper={`Upload: ${formatBytes(Number(data.traffic.totalUpload))}`}
      />
    </section>
  );
}
