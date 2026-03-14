import React from 'react';
import { Activity, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '../atoms/Card';
import { useObservatoryStatus } from '../../hooks/useXray';

export const ObservatoryCard: React.FC = () => {
  const { t } = useTranslation();
  const { data: status, isLoading } = useObservatoryStatus();

  if (!status?.enabled && !isLoading) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line/50 px-4 py-3">
        <Activity className="h-4 w-4 text-brand-400" />
        <h3 className="text-sm font-semibold text-heading">
          {t('observatory.title', { defaultValue: 'Observatory' })}
        </h3>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-line/60 border-t-brand-500" />
          </div>
        ) : !status?.outbounds?.length ? (
          <p className="text-center text-sm text-muted py-4">
            {t('observatory.noOutbounds', { defaultValue: 'No outbounds being monitored' })}
          </p>
        ) : (
          <div className="space-y-2">
            {status.outbounds.map((ob) => (
              <div
                key={ob.tag}
                className="flex items-center justify-between rounded-xl border border-line/50 bg-card/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {ob.alive ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-400" />
                  )}
                  <span className="text-sm font-medium text-heading">{ob.tag}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  {ob.delay > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {ob.delay}ms
                    </span>
                  )}
                  {ob.lastErrorReason && (
                    <span className="text-rose-400 max-w-[200px] truncate" title={ob.lastErrorReason}>
                      {ob.lastErrorReason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
