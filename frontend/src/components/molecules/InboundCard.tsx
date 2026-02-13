import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';

import type { Inbound } from '../../types';

interface InboundCardProps {
  inbound: Inbound;
  onDelete: (id: number) => void;
}

export function InboundCard({ inbound, onDelete }: InboundCardProps) {
  const usersCount = inbound._count?.userInbounds ?? 0;

  return (
    <Card className="h-full">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{`${inbound.protocol} • ${inbound.port}`}</h3>
      <div className="space-y-3 text-sm text-slate-300">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Tag</span>
          <span className="font-mono text-xs">{inbound.tag}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Network</span>
          <span>{inbound.network}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Security</span>
          <span>{inbound.security}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Users</span>
          <Badge variant="info">{usersCount}</Badge>
        </div>
        <div className="pt-2">
          <Button variant="danger" className="w-full" onClick={() => onDelete(inbound.id)}>
            Delete Inbound
          </Button>
        </div>
      </div>
    </Card>
  );
}
