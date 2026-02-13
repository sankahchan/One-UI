import React from 'react';
import { ArrowRight, RefreshCw, ShieldOff, ToggleLeft, ToggleRight, X } from 'lucide-react';

import type { Inbound } from '../../types';
import { Button } from '../atoms/Button';

export interface InboundDrawerClient {
  id: number;
  email: string;
  uuid: string;
  status: string;
  enabled: boolean;
  priority: number;
  expireDate: string;
  uploadUsed: number;
  downloadUsed: number;
  dataLimit: number;
  totalUsed: number;
}

interface SessionMeta {
  online: boolean;
  currentIp: string | null;
  lastSeenAt: string | null;
}

interface InboundClientsDrawerProps {
  inbound: Inbound;
  clients: InboundDrawerClient[];
  sessionsByUuid: Map<string, SessionMeta>;
  onClose: () => void;
  onViewUser: (userId: number) => void;
  onToggleAccess: (client: InboundDrawerClient) => void;
  onResetTraffic: (client: InboundDrawerClient) => void;
  onExtendExpiry: (client: InboundDrawerClient, days: number) => void;
  onDisableUser: (client: InboundDrawerClient) => void;
  onDecreasePriority: (client: InboundDrawerClient) => void;
  onIncreasePriority: (client: InboundDrawerClient) => void;
  actionLoadingKey?: string | null;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`;
}

function formatDaysLeft(expireDate: string) {
  const expire = new Date(expireDate);
  if (Number.isNaN(expire.getTime())) {
    return 'N/A';
  }
  const diff = expire.getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days > 0 ? `${days}d left` : 'Expired';
}

function formatLastSeen(lastSeenAt: string | null) {
  if (!lastSeenAt) {
    return 'No activity';
  }
  const timestamp = new Date(lastSeenAt).getTime();
  if (Number.isNaN(timestamp)) {
    return 'No activity';
  }
  const elapsedMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export function InboundClientsDrawer({
  inbound,
  clients,
  sessionsByUuid,
  onClose,
  onViewUser,
  onToggleAccess,
  onResetTraffic,
  onExtendExpiry,
  onDisableUser,
  onDecreasePriority,
  onIncreasePriority,
  actionLoadingKey = null
}: InboundClientsDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-line/70 bg-card/95 shadow-soft">
        <div className="flex items-start justify-between border-b border-line/70 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Inbound Details</p>
            <h3 className="text-xl font-semibold text-foreground">{inbound.remark || inbound.tag}</h3>
            <p className="mt-1 text-sm text-muted">
              {inbound.protocol} • Port {inbound.port} • {inbound.network}/{inbound.security}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card/80 hover:text-foreground"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {clients.length === 0 ? (
            <div className="rounded-xl border border-line/70 bg-panel/40 px-4 py-10 text-center text-sm text-muted">
              No clients are assigned to this inbound yet.
            </div>
          ) : (
            <div className="space-y-3">
              {clients.map((client) => {
                const session = sessionsByUuid.get(client.uuid);
                const online = Boolean(session?.online);
                const ratio = client.dataLimit > 0 ? Math.min((client.totalUsed / client.dataLimit) * 100, 100) : 0;
                const loadingPrefix = `u${client.id}-`;

                return (
                  <div key={`${inbound.id}-${client.id}`} className="rounded-xl border border-line/70 bg-panel/45 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{client.email}</p>
                        <p className="text-xs text-muted">{client.uuid.slice(0, 10)}...</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                            online
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-zinc-500/15 text-zinc-300'
                          }`}
                        >
                          <span className="relative inline-flex h-2.5 w-2.5">
                            {online ? (
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                            ) : null}
                            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
                          </span>
                          {online ? 'Online' : 'Offline'}
                        </span>
                        <span className="rounded-full bg-card/80 px-2 py-0.5 text-xs text-muted">{client.status}</span>
                        <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs text-brand-300">
                          Priority {client.priority}
                        </span>
                        {!client.enabled ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Key Off</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                      <div className="rounded-lg border border-line/60 bg-card/60 p-2.5">
                        <p className="text-muted">Traffic</p>
                        <p className="mt-1 text-sm text-foreground">
                          {formatBytes(client.totalUsed)} / {client.dataLimit > 0 ? formatBytes(client.dataLimit) : '∞'}
                        </p>
                        <div className="mt-2 h-2 rounded-full bg-panel/90">
                          <div className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600" style={{ width: `${ratio}%` }} />
                        </div>
                      </div>

                      <div className="rounded-lg border border-line/60 bg-card/60 p-2.5">
                        <p className="text-muted">Expiry</p>
                        <p className="mt-1 text-sm text-foreground">{formatDaysLeft(client.expireDate)}</p>
                        <p className="mt-1 text-muted">{new Date(client.expireDate).toLocaleDateString()}</p>
                      </div>

                      <div className="rounded-lg border border-line/60 bg-card/60 p-2.5">
                        <p className="text-muted">Session</p>
                        <p className="mt-1 text-sm text-foreground">{online ? (session?.currentIp || 'Connected') : `Last seen ${formatLastSeen(session?.lastSeenAt || null)}`}</p>
                        {!online && session?.currentIp ? <p className="mt-1 text-muted">{session.currentIp}</p> : null}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      <Button size="sm" variant="secondary" onClick={() => onViewUser(client.id)}>
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onDecreasePriority(client)}
                        loading={actionLoadingKey === `${loadingPrefix}priority-down`}
                      >
                        Priority -
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onIncreasePriority(client)}
                        loading={actionLoadingKey === `${loadingPrefix}priority-up`}
                      >
                        Priority +
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onToggleAccess(client)}
                        loading={actionLoadingKey === `${loadingPrefix}toggle`}
                      >
                        {client.enabled ? <ToggleRight className="mr-1 h-4 w-4" /> : <ToggleLeft className="mr-1 h-4 w-4" />}
                        Key
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onResetTraffic(client)}
                        loading={actionLoadingKey === `${loadingPrefix}reset`}
                      >
                        <RefreshCw className="mr-1 h-4 w-4" />
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onExtendExpiry(client, 7)}
                        loading={actionLoadingKey === `${loadingPrefix}extend7`}
                      >
                        +7d
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onExtendExpiry(client, 30)}
                        loading={actionLoadingKey === `${loadingPrefix}extend30`}
                      >
                        +30d
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => onDisableUser(client)}
                        loading={actionLoadingKey === `${loadingPrefix}disable`}
                      >
                        <ShieldOff className="mr-1 h-4 w-4" />
                        Disable
                      </Button>
                    </div>

                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onViewUser(client.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:text-brand-600"
                      >
                        Open user page
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default InboundClientsDrawer;
