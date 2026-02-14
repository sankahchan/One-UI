import React from 'react';
import { RefreshCw, ShieldCheck, ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import apiClient from '../../api/client';
import { useHealth } from '../../hooks/useStats';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';
import { Spinner } from '../atoms/Spinner';

export const SystemHealthCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, isFetching } = useHealth();
  const { data: quality } = useQuery({
    queryKey: ['system-health-quality'],
    queryFn: () =>
      apiClient.get('/users/sessions', {
        params: {
          includeOffline: true,
          limit: 500
        }
      }),
    refetchInterval: 15_000
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['health'] });
    void queryClient.invalidateQueries({ queryKey: ['system-health-quality'] });
  };

  const qualitySummary = (quality?.data?.sessions || []).reduce(
    (acc: { connects: number; rejects: number; reconnects: number }, session: any) => {
      acc.connects += Number(session?.quality?.connectSuccesses || 0);
      acc.rejects += Number(session?.quality?.limitRejects || 0);
      acc.reconnects += Number(session?.quality?.reconnects || 0);
      return acc;
    },
    { connects: 0, rejects: 0, reconnects: 0 }
  );
  const topProtocolQuality = React.useMemo(() => {
    const aggregate = new Map<string, { protocol: string; connects: number; rejects: number; reconnects: number }>();

    for (const session of quality?.data?.sessions || []) {
      for (const entry of session?.quality?.byProtocol || []) {
        const protocol = String(entry?.protocol || 'UNKNOWN').toUpperCase();
        const existing = aggregate.get(protocol) || {
          protocol,
          connects: 0,
          rejects: 0,
          reconnects: 0
        };
        existing.connects += Number(entry?.connectSuccesses || 0);
        existing.rejects += Number(entry?.limitRejects || 0);
        existing.reconnects += Number(entry?.reconnects || 0);
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
      .slice(0, 3);
  }, [quality?.data?.sessions]);
  const topProfileQuality = React.useMemo(() => {
    const aggregate = new Map<
      string,
      {
        key: string;
        tag: string;
        protocol: string;
        port: number;
        connects: number;
        rejects: number;
        reconnects: number;
      }
    >();

    for (const session of quality?.data?.sessions || []) {
      for (const entry of session?.quality?.byProfile || []) {
        const inboundId = Number.isInteger(Number(entry?.inboundId)) ? Number(entry.inboundId) : null;
        const protocol = String(entry?.protocol || 'UNKNOWN').toUpperCase();
        const tag = String(entry?.tag || (inboundId ? `inbound-${inboundId}` : 'unknown'));
        const key = inboundId ? `id:${inboundId}` : `tag:${tag}`;
        const existing = aggregate.get(key) || {
          key,
          tag,
          protocol,
          port: Number(entry?.port || 0),
          connects: 0,
          rejects: 0,
          reconnects: 0
        };
        existing.connects += Number(entry?.connectSuccesses || 0);
        existing.rejects += Number(entry?.limitRejects || 0);
        existing.reconnects += Number(entry?.reconnects || 0);
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
      .slice(0, 3);
  }, [quality?.data?.sessions]);

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isError ? (
            <ShieldX className="h-5 w-5 text-red-500" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          )}
          <h2 className="text-lg font-semibold text-foreground">
            {t('systemHealth.title', { defaultValue: 'System Health' })}
          </h2>
        </div>

        {isLoading ? null : isError ? (
          <Badge variant="danger">
            {t('systemHealth.unreachable', { defaultValue: 'Unreachable' })}
          </Badge>
        ) : (
          <Badge variant="success">
            {t('systemHealth.healthy', { defaultValue: 'Healthy' })}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : isError ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {t('systemHealth.errorBody', {
              defaultValue: 'Could not reach backend health endpoint. Confirm `backend` is running on port `3000`.'
            })}
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={refresh} loading={isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('systemHealth.retry', { defaultValue: 'Retry Health Check' })}
          </Button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">{t('common.status', { defaultValue: 'Status' })}</span>
            <span className="font-semibold capitalize text-foreground">{data?.status || 'ok'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">{t('systemHealth.lastCheck', { defaultValue: 'Last Check' })}</span>
            <span className="font-medium text-foreground">
              {data?.timestamp ? new Date(data.timestamp).toLocaleString() : 'N/A'}
            </span>
          </div>
          <div className="pt-2">
            <Button type="button" size="sm" variant="secondary" onClick={refresh} loading={isFetching}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-line/70 bg-panel/45 p-3 text-xs sm:grid-cols-3">
            <div>
              <p className="text-muted">
                {t('dashboard.quality.connectSuccess60m', { defaultValue: 'Connect Success (60m)' })}
              </p>
              <p className="text-sm font-semibold text-foreground">{qualitySummary.connects}</p>
            </div>
            <div>
              <p className="text-muted">
                {t('dashboard.quality.limitRejects60m', { defaultValue: 'Limit Rejects (60m)' })}
              </p>
              <p className="text-sm font-semibold text-rose-400">{qualitySummary.rejects}</p>
            </div>
            <div>
              <p className="text-muted">
                {t('dashboard.quality.reconnects60m', { defaultValue: 'Reconnects (60m)' })}
              </p>
              <p className="text-sm font-semibold text-amber-300">{qualitySummary.reconnects}</p>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <p className="uppercase tracking-wide text-muted">
              {t('dashboard.topProtocolQuality.title', { defaultValue: 'Top Protocol Quality (60m)' })}
            </p>
            {topProtocolQuality.length === 0 ? (
              <p className="text-muted">
                {t('dashboard.topProtocolQuality.empty', { defaultValue: 'No protocol quality data yet.' })}
              </p>
            ) : (
              topProtocolQuality.map((row) => (
                <div key={row.protocol} className="flex items-center justify-between rounded-lg border border-line/70 bg-panel/35 px-2.5 py-1.5">
                  <p className="font-medium text-foreground">{row.protocol}</p>
                  <p className="text-muted">
                    C {row.connects} / R {row.rejects} / Re {row.reconnects}
                    <span className={`ml-2 font-semibold ${row.score >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {row.score}
                    </span>
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <p className="uppercase tracking-wide text-muted">
              {t('dashboard.topInboundProfiles.title', { defaultValue: 'Top Inbound Profiles (60m)' })}
            </p>
            {topProfileQuality.length === 0 ? (
              <p className="text-muted">
                {t('dashboard.topInboundProfiles.empty', { defaultValue: 'No inbound profile telemetry yet.' })}
              </p>
            ) : (
              topProfileQuality.map((row) => (
                <div key={row.key} className="rounded-lg border border-line/70 bg-panel/35 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground">
                      {row.protocol} {row.port ? `:${row.port}` : ''}
                    </p>
                    <span className={`font-semibold ${row.score >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{row.score}</span>
                  </div>
                  <p className="truncate text-muted" title={row.tag}>{row.tag}</p>
                  <p className="text-muted">C {row.connects} / R {row.rejects} / Re {row.reconnects}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
