import { Eye, Trash2 } from 'lucide-react';

import type { User } from '../../types';
import { formatBytes, formatDate } from '../../utils/formatters';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';

interface UserRowProps {
  user: User;
  onView: (id: number) => void;
  onDelete: (id: number) => void;
}

export function UserRow({ user, onView, onDelete }: UserRowProps) {
  const badgeVariant: 'success' | 'warning' | 'danger' | 'info' =
    user.status === 'ACTIVE' ? 'success' : user.status === 'LIMITED' ? 'warning' : 'danger';

  return (
    <tr className="border-b border-slate-700/60 text-sm text-slate-200 last:border-0">
      <td className="px-3 py-3 font-medium">{user.email}</td>
      <td className="px-3 py-3 font-mono text-xs text-slate-400">{user.uuid.slice(0, 16)}...</td>
      <td className="px-3 py-3">{formatBytes(Number(user.dataLimit))}</td>
      <td className="px-3 py-3">{formatDate(user.expireDate)}</td>
      <td className="px-3 py-3">
        <Badge variant={badgeVariant}>{user.status}</Badge>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => onView(user.id)}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="danger" onClick={() => onDelete(user.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
