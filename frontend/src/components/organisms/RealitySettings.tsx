import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Radar, ShieldCheck } from 'lucide-react';

import apiClient from '../../api/client';
import { useToast } from '../../hooks/useToast';
import { Input } from '../atoms/Input';
import { Button } from '../atoms/Button';

interface RealityDestination {
  name: string;
  dest: string;
  serverNames?: string[];
  region?: string;
  reliability?: string;
}

interface RealitySettingsProps {
  register: any;
  watch: any;
  setValue: any;
  errors: any;
}

function unwrapData(payload: any) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

export const RealitySettings: React.FC<RealitySettingsProps> = ({
  register,
  watch,
  setValue,
  errors
}) => {
  const toast = useToast();
  const selectedDest = (watch('realityDest') || '').trim();
  const serverName = (watch('serverName') || '').trim();
  const currentServerNames = String(watch('realityServerName') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const { data, isLoading } = useQuery({
    queryKey: ['reality-destinations'],
    queryFn: async () => {
      const response: any = await apiClient.get('/reality/destinations');
      const payload = unwrapData(response) || {};
      return {
        destinations: Array.isArray(payload.destinations) ? payload.destinations as RealityDestination[] : [],
        recommendedWsPaths: Array.isArray(payload.recommendedWsPaths) ? payload.recommendedWsPaths as string[] : []
      };
    }
  });

  const testDestinationMutation = useMutation({
    mutationFn: async (dest: string) => {
      const response: any = await apiClient.post('/reality/test-destination', { dest });
      return unwrapData(response);
    },
    onSuccess: (result: any) => {
      if (result?.accessible) {
        toast.success('Destination reachable', String(result.destination || 'Destination reachable'));
        return;
      }
      toast.warning(
        'Destination unavailable',
        String(result?.message || result?.destination || 'Destination is not reachable')
      );
    },
    onError: (error: any) => {
      toast.error('Test failed', error?.message || 'Failed to test destination');
    }
  });

  const applyDestination = (item: RealityDestination) => {
    setValue('realityDest', item.dest, { shouldDirty: true, shouldValidate: true });
    const joined = Array.isArray(item.serverNames) ? item.serverNames.join(',') : '';
    if (joined && currentServerNames.length === 0) {
      setValue('realityServerName', joined, { shouldDirty: true, shouldValidate: true });
    }
    if (!serverName && Array.isArray(item.serverNames) && item.serverNames[0]) {
      setValue('serverName', item.serverNames[0], { shouldDirty: true, shouldValidate: true });
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-line/70 bg-panel/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">REALITY Destination Controls</h4>
          <p className="mt-1 text-xs text-muted">Use a high-trust TLS destination to improve DPI resistance.</p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          Myanmar Optimized
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label="Reality Destination (host:port)"
          {...register('realityDest', {
            validate: (value: string) => {
              if (!value) {
                return true;
              }
              return /^[^:\s]+:\d{1,5}$/.test(String(value).trim()) || 'Use host:port format, e.g. www.microsoft.com:443';
            }
          })}
          error={errors.realityDest?.message}
          placeholder="www.microsoft.com:443"
        />

        <Input
          label="Reality Spider X (Optional)"
          {...register('realitySpiderX')}
          error={errors.realitySpiderX?.message}
          placeholder="/"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            if (!selectedDest) {
              toast.warning('Destination required', 'Select or enter a destination first.');
              return;
            }
            testDestinationMutation.mutate(selectedDest);
          }}
          loading={testDestinationMutation.isPending}
        >
          <Radar className="mr-2 h-4 w-4" />
          Test Current Destination
        </Button>

        {Array.isArray(data?.recommendedWsPaths) && data.recommendedWsPaths.length > 0 ? (
          <span className="text-xs text-muted">
            Suggested WS paths: {data.recommendedWsPaths.slice(0, 3).join(', ')}
          </span>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Curated Destinations</p>
        {isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-line/70 bg-card/60 px-3 py-2 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading destination catalog...
          </div>
        ) : null}

        {!isLoading && (!data?.destinations || data.destinations.length === 0) ? (
          <div className="rounded-lg border border-line/70 bg-card/60 px-3 py-2 text-xs text-muted">
            Destination catalog unavailable. You can still set destination manually.
          </div>
        ) : null}

        {!isLoading && Array.isArray(data?.destinations) ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.destinations.map((item) => {
              const active = selectedDest === item.dest;
              return (
                <button
                  key={item.dest}
                  type="button"
                  onClick={() => applyDestination(item)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? 'border-brand-500/60 bg-brand-500/10'
                      : 'border-line/70 bg-card/60 hover:border-brand-400/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.name}</p>
                    {active ? <CheckCircle2 className="h-4 w-4 text-brand-300" /> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">{item.dest}</p>
                  <p className="mt-1 text-[11px] text-muted">{item.region || 'Global'} • {item.reliability || 'High'}</p>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};
