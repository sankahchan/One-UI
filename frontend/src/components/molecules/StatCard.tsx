import type { LucideIcon } from 'lucide-react';

import { Card } from '../atoms/Card';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  helper?: string;
}

export function StatCard({ label, value, icon: Icon, helper }: StatCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{value}</p>
          {helper ? <p className="mt-1 text-xs text-slate-400">{helper}</p> : null}
        </div>
        <span className="rounded-lg bg-accent-500/20 p-2 text-accent-500">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </Card>
  );
}
