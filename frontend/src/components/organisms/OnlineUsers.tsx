import React from 'react';
import { Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useOnlineUsers } from '../../hooks/useXray';
import { formatBytes } from '../../utils/formatters';
import { Badge } from '../atoms/Badge';
import { Card } from '../atoms/Card';
import { Spinner } from '../atoms/Spinner';

export const OnlineUsers: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useOnlineUsers();

  if (isLoading) {
    return (
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {t('dashboard.onlineUsers', { defaultValue: 'Online Users' })}
          </h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {t('dashboard.onlineUsers', { defaultValue: 'Online Users' })}
          </h2>
        </div>
        <p className="py-4 text-sm text-muted">
          {t('dashboard.onlineUsersError', { defaultValue: 'Unable to fetch online users' })}
        </p>
      </Card>
    );
  }

  const onlineUsers = data?.users ?? [];

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-emerald-500" />
          <h2 className="text-lg font-semibold text-foreground">
            {t('dashboard.onlineUsers', { defaultValue: 'Online Users' })}
          </h2>
        </div>
        <Badge variant="success">
          {t('dashboard.onlineBadge', {
            defaultValue: '{{count}} online',
            count: onlineUsers.length
          })}
        </Badge>
      </div>

      {onlineUsers.length === 0 ? (
        <p className="py-4 text-sm text-muted">
          {t('dashboard.noOnlineUsers', { defaultValue: 'No users currently online' })}
        </p>
      ) : (
        <div className="space-y-3">
          {onlineUsers.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-3 rounded-xl border border-line/70 bg-card/65 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{user.email}</p>
                  <p className="text-xs text-muted">{user.protocol}</p>
                </div>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-sm font-medium text-foreground">
                  ↑ {formatBytes(user.upload)} / ↓ {formatBytes(user.download)}
                </p>
                {user.lastActivity ? (
                  <p className="text-xs text-muted">{new Date(user.lastActivity).toLocaleTimeString()}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
