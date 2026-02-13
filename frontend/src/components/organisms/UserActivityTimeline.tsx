import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Globe2, RefreshCw, ShieldAlert, Wifi, WifiOff } from 'lucide-react';

import { Card } from '../atoms/Card';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { useUserActivity } from '../../hooks/useUsers';
import type {
  UserActivityAlert,
  UserActivityAlertSeverity,
  UserActivityQueryParams,
  UserActivityTimelineEvent
} from '../../types';
import { formatBytes, formatDateTime } from '../../utils/formatters';

interface UserActivityTimelineProps {
  userId: number;
}

interface ActivityRuleDraft {
  hours: number;
  eventLimit: number;
  ipChurnThreshold: number;
  reconnectThreshold: number;
  reconnectWindowMinutes: number;
  trafficSpikeFactor: number;
  trafficSpikeMinMb: number;
}

const DEFAULT_RULE_DRAFT: ActivityRuleDraft = {
  hours: 24,
  eventLimit: 300,
  ipChurnThreshold: 4,
  reconnectThreshold: 15,
  reconnectWindowMinutes: 10,
  trafficSpikeFactor: 3,
  trafficSpikeMinMb: 500
};

function toActivityQueryParams(rules: ActivityRuleDraft): UserActivityQueryParams {
  return {
    hours: rules.hours,
    eventLimit: rules.eventLimit,
    ipChurnThreshold: rules.ipChurnThreshold,
    reconnectThreshold: rules.reconnectThreshold,
    reconnectWindowMinutes: rules.reconnectWindowMinutes,
    trafficSpikeFactor: rules.trafficSpikeFactor,
    trafficSpikeMinBytes: String(Math.max(0, Math.floor(rules.trafficSpikeMinMb * 1024 * 1024)))
  };
}

function severityPillClass(severity: UserActivityAlertSeverity) {
  const palette = {
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    critical: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300'
  } as const;

  return palette[severity] || palette.low;
}

function eventIcon(event: UserActivityTimelineEvent) {
  if (event.type === 'connect') {
    return <Wifi className="h-4 w-4 text-emerald-500" />;
  }
  if (event.type === 'disconnect') {
    return <WifiOff className="h-4 w-4 text-rose-500" />;
  }
  if (event.type === 'alert') {
    return <ShieldAlert className="h-4 w-4 text-amber-500" />;
  }
  return <Activity className="h-4 w-4 text-brand-500" />;
}

function eventTitle(event: UserActivityTimelineEvent) {
  if (event.type === 'connect') {
    return `Connect from ${event.ip || 'unknown IP'}`;
  }
  if (event.type === 'disconnect') {
    return `Disconnect from ${event.ip || 'unknown IP'}`;
  }
  if (event.type === 'alert') {
    return event.message || event.alertType || 'Anomaly alert';
  }

  return `Traffic sample: ${formatBytes(event.total || 0)}`;
}

function eventSubtitle(event: UserActivityTimelineEvent) {
  if (event.type === 'traffic') {
    return `Uplink ${formatBytes(event.upload || 0)} • Downlink ${formatBytes(event.download || 0)}`;
  }

  if (event.type === 'alert') {
    const severity = event.severity ? event.severity.toUpperCase() : 'UNKNOWN';
    return `${severity}${event.alertType ? ` • ${event.alertType}` : ''}`;
  }

  const inboundMeta = [
    event.inboundTag || null,
    event.inboundProtocol || null,
    event.inboundPort ? `:${event.inboundPort}` : null
  ]
    .filter(Boolean)
    .join(' ');

  return inboundMeta || 'Inbound information unavailable';
}

export const UserActivityTimeline: React.FC<UserActivityTimelineProps> = ({ userId }) => {
  const [draftRules, setDraftRules] = useState<ActivityRuleDraft>(DEFAULT_RULE_DRAFT);
  const [activeRules, setActiveRules] = useState<ActivityRuleDraft>(DEFAULT_RULE_DRAFT);

  const queryParams = useMemo(() => toActivityQueryParams(activeRules), [activeRules]);
  const activityQuery = useUserActivity(userId, queryParams);

  const activity = activityQuery.data;
  const alerts = activity?.alerts || [];
  const timeline = activity?.timeline || [];

  const applyRules = () => {
    setActiveRules({ ...draftRules });
  };

  const resetRules = () => {
    setDraftRules(DEFAULT_RULE_DRAFT);
    setActiveRules(DEFAULT_RULE_DRAFT);
  };

  const openAlerts = alerts.filter((entry) => ['high', 'critical'].includes(entry.severity)).length;

  return (
    <Card>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Activity Timeline & Alert Rules</h2>
            <p className="mt-1 text-sm text-muted">
              Detect suspicious IP churn, reconnect bursts, and traffic spikes for this user.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void activityQuery.refetch();
            }}
            loading={activityQuery.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-line/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Total Traffic</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {formatBytes(activity?.summary.trafficTotal || 0)}
            </p>
          </div>
          <div className="rounded-xl border border-line/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Unique IPs</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{activity?.summary.uniqueIpCount || 0}</p>
          </div>
          <div className="rounded-xl border border-line/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Alerts</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{activity?.summary.alertCount || 0}</p>
          </div>
          <div className="rounded-xl border border-line/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Risk Score</p>
            <p className={`mt-1 text-lg font-semibold ${openAlerts > 0 ? 'text-rose-500' : 'text-foreground'}`}>
              {activity?.summary.anomalyScore || 0}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line/70 bg-panel/45 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Alerting Rules</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input
              label="Window (Hours)"
              type="number"
              min={1}
              max={720}
              value={draftRules.hours}
              onChange={(event) => setDraftRules((previous) => ({ ...previous, hours: Number(event.target.value) }))}
            />
            <Input
              label="Timeline Events"
              type="number"
              min={50}
              max={1000}
              value={draftRules.eventLimit}
              onChange={(event) =>
                setDraftRules((previous) => ({ ...previous, eventLimit: Number(event.target.value) }))
              }
            />
            <Input
              label="IP Churn Threshold"
              type="number"
              min={2}
              max={50}
              value={draftRules.ipChurnThreshold}
              onChange={(event) =>
                setDraftRules((previous) => ({ ...previous, ipChurnThreshold: Number(event.target.value) }))
              }
            />
            <Input
              label="Reconnect Threshold"
              type="number"
              min={3}
              max={200}
              value={draftRules.reconnectThreshold}
              onChange={(event) =>
                setDraftRules((previous) => ({ ...previous, reconnectThreshold: Number(event.target.value) }))
              }
            />
            <Input
              label="Reconnect Window (Min)"
              type="number"
              min={1}
              max={120}
              value={draftRules.reconnectWindowMinutes}
              onChange={(event) =>
                setDraftRules((previous) => ({ ...previous, reconnectWindowMinutes: Number(event.target.value) }))
              }
            />
            <Input
              label="Traffic Spike Factor"
              type="number"
              min={1.1}
              max={20}
              step={0.1}
              value={draftRules.trafficSpikeFactor}
              onChange={(event) =>
                setDraftRules((previous) => ({ ...previous, trafficSpikeFactor: Number(event.target.value) }))
              }
            />
            <Input
              label="Spike Min Traffic (MB)"
              type="number"
              min={0}
              value={draftRules.trafficSpikeMinMb}
              onChange={(event) =>
                setDraftRules((previous) => ({ ...previous, trafficSpikeMinMb: Number(event.target.value) }))
              }
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={applyRules}>Apply Rules</Button>
            <Button variant="secondary" onClick={resetRules}>
              Reset
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">Anomaly Alerts</h3>
          {activityQuery.isLoading ? (
            <div className="rounded-xl border border-line/70 bg-card/50 p-4 text-sm text-muted">Loading alerts...</div>
          ) : alerts.length === 0 ? (
            <div className="rounded-xl border border-line/70 bg-card/50 p-4 text-sm text-muted">
              No active anomaly alerts in this window.
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert: UserActivityAlert) => (
                <div key={alert.id} className="rounded-xl border border-line/70 bg-card/55 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">{alert.message}</p>
                        <p className="text-xs text-muted">{formatDateTime(alert.timestamp)}</p>
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${severityPillClass(alert.severity)}`}>
                      {alert.severity.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">Timeline</h3>
          {activityQuery.isLoading ? (
            <div className="rounded-xl border border-line/70 bg-card/50 p-4 text-sm text-muted">Loading timeline...</div>
          ) : timeline.length === 0 ? (
            <div className="rounded-xl border border-line/70 bg-card/50 p-4 text-sm text-muted">No activity in this window.</div>
          ) : (
            <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
              {timeline.map((event: UserActivityTimelineEvent) => (
                <div key={event.id} className="rounded-xl border border-line/70 bg-card/55 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{eventIcon(event)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{eventTitle(event)}</p>
                      <p className="mt-1 text-xs text-muted">{eventSubtitle(event)}</p>
                    </div>
                    <div className="text-right text-xs text-muted">
                      <Globe2 className="ml-auto h-3.5 w-3.5" />
                      <span className="mt-1 block whitespace-nowrap">{formatDateTime(event.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
