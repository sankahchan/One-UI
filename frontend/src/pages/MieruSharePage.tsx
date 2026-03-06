import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Copy, ExternalLink, Link2, QrCode, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { QRCodeDisplay } from '../components/molecules/QRCodeDisplay';
import { useToast } from '../hooks/useToast';
import { changeLanguage, languages } from '../i18n';
import { copyTextToClipboard } from '../utils/clipboard';
import { openDeepLinksWithFallback } from '../utils/deepLink';
import {
  buildImportLaunchUrls,
  detectPlatform,
  resolveSubscriptionApps,
  type Platform,
  type ResolvedClientApp
} from '../lib/subscriptionApps';

interface ShareQuota {
  days?: number;
  megabytes?: number;
}

interface MieruShareUsage {
  limitBytes: number;
  totalUsedBytes: number;
  remainingBytes: number;
  uploadBytes: number;
  downloadBytes: number;
  percent: number;
  derivedFromQuota?: boolean;
}

interface MieruShareInfo {
  user: {
    username: string;
    enabled: boolean;
    quotas: ShareQuota[];
    createdAt: string | null;
    updatedAt: string | null;
  };
  usage?: MieruShareUsage | null;
  profile: {
    server: string;
    portRange: string;
    transport: 'TCP' | 'UDP';
    udp: boolean;
    multiplexing: string;
  };
  subscription: {
    url: string;
    pageUrl: string;
  };
}

interface MieruShareResponse {
  success: boolean;
  message?: string;
  error?: {
    message?: string;
  };
  data?: MieruShareInfo;
}

const MIERU_APP_GROUPS: Array<{
  key: 'desktop' | 'android' | 'ios';
  platform: Platform;
  titleKey: string;
  defaultTitle: string;
  subtitleKey: string;
  defaultSubtitle: string;
  preferredIds: string[];
}> = [
  {
    key: 'desktop',
    platform: 'windows',
    titleKey: 'portal.addToApp.mieruGroups.desktop.title',
    defaultTitle: 'Desktop',
    subtitleKey: 'portal.addToApp.mieruGroups.desktop.subtitle',
    defaultSubtitle: 'Windows, macOS, Linux',
    preferredIds: ['clashvergerev', 'mihomoparty', 'nyamebox']
  },
  {
    key: 'android',
    platform: 'android',
    titleKey: 'portal.addToApp.mieruGroups.android.title',
    defaultTitle: 'Android',
    subtitleKey: 'portal.addToApp.mieruGroups.android.subtitle',
    defaultSubtitle: 'Phones and tablets',
    preferredIds: ['clashmeta_android', 'clashmi', 'exclave', 'husi_mieru_plugin', 'karing', 'nekobox_mieru_plugin']
  },
  {
    key: 'ios',
    platform: 'ios',
    titleKey: 'portal.addToApp.mieruGroups.ios.title',
    defaultTitle: 'iOS',
    subtitleKey: 'portal.addToApp.mieruGroups.ios.subtitle',
    defaultSubtitle: 'iPhone and iPad',
    preferredIds: ['clashmi', 'karing']
  }
];

function orderAppsByPreferredIds(apps: ResolvedClientApp[], preferredIds: string[]): ResolvedClientApp[] {
  const order = new Map(preferredIds.map((id, index) => [id, index]));

  return [...apps].sort((left, right) => {
    const leftRank = order.get(left.id);
    const rightRank = order.get(right.id);

    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    if (leftRank !== undefined) {
      return -1;
    }
    if (rightRank !== undefined) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function formatTimestamp(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toLocaleString();
}

function getQuotaMetric(quotas: ShareQuota[], key: 'days' | 'megabytes'): number | null {
  const quota = quotas.find((entry) => Number.isInteger(entry?.[key]));
  const value = quota?.[key];
  if (!Number.isInteger(value)) {
    return null;
  }
  return Number(value);
}

function formatQuotaDays(quotas: ShareQuota[], unlimitedLabel: string): string {
  const days = getQuotaMetric(quotas, 'days');
  return days === null ? unlimitedLabel : String(days);
}

function formatQuotaGigabytes(quotas: ShareQuota[], unlimitedLabel: string): string {
  const megabytes = getQuotaMetric(quotas, 'megabytes');
  if (megabytes === null) {
    return unlimitedLabel;
  }

  const gb = megabytes / 1024;
  if (!Number.isFinite(gb)) {
    return unlimitedLabel;
  }

  return gb.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIndex]}`;
}

export const MieruSharePage = () => {
  const { token } = useParams<{ token: string }>();
  const toast = useToast();
  const { t, i18n } = useTranslation();

  const [copiedKey, setCopiedKey] = useState('');
  const [preferredPlatform, setPreferredPlatform] = useState<Platform>(() => detectPlatform());
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(max-width: 1023px), (pointer: coarse)').matches;
  });
  const [isPageVisible, setIsPageVisible] = useState(() => {
    if (typeof document === 'undefined') {
      return true;
    }
    return document.visibilityState !== 'hidden';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const media = window.matchMedia('(max-width: 1023px), (pointer: coarse)');
    const update = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : media.matches);
    };
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      setIsPageVisible(document.visibilityState !== 'hidden');
    };

    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const infoUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    const basePath = window.location.pathname.replace(/\/page\/?$/, '');
    return `${window.location.origin}${basePath}/info`;
  }, []);

  const infoQuery = useQuery<MieruShareInfo>({
    queryKey: ['mieru-share-page', token, infoUrl],
    enabled: Boolean(token && infoUrl),
    queryFn: async () => {
      const response = await fetch(infoUrl, { cache: 'no-store' });
      const payload = await response.json() as MieruShareResponse;

      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.error?.message || payload?.message || 'Failed to load Mieru share page.');
      }

      return payload.data;
    },
    staleTime: 20_000,
    refetchInterval: isPageVisible ? 45_000 : false
  });

  const activeLanguageCode = useMemo(() => {
    const normalized = String(i18n.resolvedLanguage || i18n.language || 'en')
      .toLowerCase()
      .split('-')[0];
    return languages.some((entry) => entry.code === normalized) ? normalized : 'en';
  }, [i18n.language, i18n.resolvedLanguage]);
  const subscriptionUrl = infoQuery.data?.subscription?.url || '';
  const groupedApps = useMemo(() => {
    return MIERU_APP_GROUPS.map((group) => ({
      ...group,
      title: t(group.titleKey, { defaultValue: group.defaultTitle }),
      subtitle: t(group.subtitleKey, { defaultValue: group.defaultSubtitle }),
      apps: orderAppsByPreferredIds(
        resolveSubscriptionApps({
          platform: group.platform,
          urls: { mieru: subscriptionUrl },
          format: 'mieru'
        }),
        group.preferredIds
      )
    })).filter((group) => group.apps.length > 0);
  }, [subscriptionUrl, t]);
  const activeGroup = groupedApps.find((group) => group.platform === preferredPlatform) || groupedApps[0] || null;
  const recommendedApp = useMemo(() => {
    if (!activeGroup) {
      return null;
    }
    return activeGroup.apps.find((entry) => Boolean(entry.importUrl)) || activeGroup.apps[0] || null;
  }, [activeGroup]);
  const recommendedManualUrl = recommendedApp?.manualUrl || subscriptionUrl;
  const recommendedLaunchUrls = useMemo(() => {
    if (!recommendedApp || !recommendedApp.importUrl) {
      return null;
    }
    return buildImportLaunchUrls({
      appId: recommendedApp.id,
      importUrl: recommendedApp.importUrl,
      manualUrl: recommendedManualUrl
    });
  }, [recommendedApp, recommendedManualUrl]);
  const latestUpdatedAt = infoQuery.dataUpdatedAt ? new Date(infoQuery.dataUpdatedAt) : null;
  const reduceVisualEffects = useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }

    const reducedMotion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8);
    return reducedMotion || isMobileViewport || memory <= 4;
  }, [isMobileViewport]);
  const backgroundLayerMode = 'absolute';
  const endpointStatus = infoQuery.isError
    ? 'degraded'
    : infoQuery.isFetching
      ? 'checking'
      : 'healthy';
  const troubleshootingTips = useMemo(
    () => [
      t('portal.troubleshoot.mieru1', { defaultValue: 'Use One-Click Import first for compatible clients.' }),
      t('portal.troubleshoot.mieru2', { defaultValue: 'If handoff fails, copy the Mieru URL and import manually.' }),
      t('portal.troubleshoot.mieru3', { defaultValue: 'Restart app and refresh profile list.' })
    ],
    [t]
  );

  const copyToClipboard = async (value: string, key: string) => {
    if (!value) {
      return;
    }

    const copied = await copyTextToClipboard(value);
    if (!copied) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('common.copyFailed', { defaultValue: 'Failed to copy.' })
      );
      return;
    }

    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? '' : current));
    }, 1800);

    toast.success(
      t('common.copied', { defaultValue: 'Copied' }),
      t('portal.subscription.copySuccess', { defaultValue: 'Import URL copied.' })
    );
  };

  const onOneClickImport = (app: ResolvedClientApp, copyKey: string) => {
    const manualUrl = app.manualUrl || subscriptionUrl;
    const launchUrls = buildImportLaunchUrls({
      appId: app.id,
      importUrl: app.importUrl,
      manualUrl
    });

    openDeepLinksWithFallback(launchUrls, {
      onExhausted: () => {
        void copyToClipboard(manualUrl, copyKey);
        toast.warning(
          t('common.warning', { defaultValue: 'Warning' }),
          t('portal.addToApp.importFallbackCopied', {
            defaultValue: 'App handoff failed. Subscription URL was copied instead.'
          })
        );
      }
    });
  };

  if (infoQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-panel px-4 text-foreground">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-line/80 border-t-brand-500" />
      </div>
    );
  }

  if (infoQuery.isError || !infoQuery.data) {
    return (
      <div className="min-h-screen bg-panel px-4 py-10 text-foreground">
        <div className="mx-auto max-w-3xl">
          <Card className="space-y-4">
            <h1 className="text-2xl font-bold text-foreground">
              {t('portal.subscription.mieruShareTitle', { defaultValue: 'Mieru Access' })}
            </h1>
            <p className="text-sm text-muted">
              {String(infoQuery.error instanceof Error ? infoQuery.error.message : 'Unable to load this Mieru share page.')}
            </p>
            <Button variant="secondary" onClick={() => void infoQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const { user } = infoQuery.data;
  const unlimitedLabel = t('portal.subscription.stats.unlimited', { defaultValue: 'Unlimited' });
  const quotaDays = formatQuotaDays(user.quotas, unlimitedLabel);
  const quotaGigabytes = formatQuotaGigabytes(user.quotas, unlimitedLabel);
  const notSetLabel = t('common.notSet', { defaultValue: 'Not set' });
  const usage = infoQuery.data.usage;
  const usagePercent = Math.min(Math.max(Number(usage?.percent || 0), 0), 100);
  const usageLimitLabel = usage && usage.limitBytes > 0 ? formatBytes(usage.limitBytes) : '∞';

  return (
    <div className="mobile-scroll-page relative min-h-screen px-4 pb-44 pt-6 text-foreground sm:px-6 sm:pb-10 sm:pt-8">
      <div className={`pointer-events-none ${backgroundLayerMode} inset-0 -z-20 bg-slate-950`} />
      <div
        className={`pointer-events-none ${backgroundLayerMode} inset-0 -z-10 opacity-90`}
        style={{
          backgroundImage: reduceVisualEffects
            ? 'linear-gradient(160deg, rgba(15,23,42,.95), rgba(2,6,23,.98))'
            : 'radial-gradient(circle at 20% 10%, rgba(59,130,246,.35), transparent 42%), radial-gradient(circle at 80% 16%, rgba(99,102,241,.28), transparent 40%), linear-gradient(160deg, rgba(15,23,42,.95), rgba(2,6,23,.98))'
        }}
      />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-300">ONE-UI</p>
            <h1 className="text-3xl font-bold text-slate-50">
              {t('portal.subscription.mieruShareTitle', { defaultValue: 'Mieru Access' })}
            </h1>
            <p className="text-sm text-slate-300/85">
              {t('portal.subscription.mieruShareSubtitle', {
                defaultValue: 'Import this Mieru profile into a compatible client or copy the raw URL.'
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/55 px-3 py-2 text-sm text-slate-100">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('portal.language', { defaultValue: 'Language' })}
              </span>
              <select
                value={activeLanguageCode}
                onChange={(event) => {
                  changeLanguage(event.target.value);
                }}
                className="rounded-md border border-white/15 bg-slate-900/80 px-2 py-1 text-sm text-slate-100 focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                aria-label={t('portal.language', { defaultValue: 'Language' })}
              >
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.nativeName}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" onClick={() => void infoQuery.refetch()} loading={infoQuery.isFetching}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start 2xl:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="flex flex-col items-center gap-4 bg-slate-900/55 xl:self-start">
            <div className="rounded-3xl border border-line/70 bg-white p-4 shadow-soft">
              <QRCodeDisplay text={subscriptionUrl} size={240} />
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button onClick={() => void copyToClipboard(subscriptionUrl, 'subscription')}>
                <Copy className="mr-2 h-4 w-4" />
                {copiedKey === 'subscription'
                  ? t('common.copied', { defaultValue: 'Copied' })
                  : t('portal.subscription.copyImportUrl', { defaultValue: 'Copy Import URL' })}
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.open(subscriptionUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('portal.subscription.openImportUrl', { defaultValue: 'Open Import URL' })}
              </Button>
            </div>
          </Card>

          <Card className="space-y-4 bg-slate-900/55">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('auth.username', { defaultValue: 'Username' })}
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">{user.username}</p>
              </div>
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                user.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
              }`}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {user.enabled
                  ? t('common.enabled', { defaultValue: 'Enabled' })
                  : t('common.disabled', { defaultValue: 'Disabled' })}
              </span>
            </div>

            <div className="rounded-2xl border border-line/70 bg-panel/50 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">
                  {t('portal.hero.dataUsage', { defaultValue: 'Data Usage' })}
                </p>
                <p className="text-base font-semibold text-foreground sm:text-lg">
                  {formatBytes(usage?.totalUsedBytes)} / {usageLimitLabel}
                </p>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-line/40">
                <div
                  className={`h-full rounded-full ${
                    usagePercent >= 90
                      ? 'bg-gradient-to-r from-rose-500 to-red-400'
                      : usagePercent >= 70
                      ? 'bg-gradient-to-r from-amber-500 to-orange-400'
                      : 'bg-gradient-to-r from-brand-500 to-cyan-400'
                  } ${reduceVisualEffects ? '' : 'transition-all'}`}
                    style={{ width: `${usagePercent}%` }}
                />
              </div>
              <div className="mt-3 grid gap-3 text-xs text-muted sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-card/55 px-3 py-2">
                  <span>{t('portal.subscription.stats.dataUsed', { defaultValue: 'Data Used' })}</span>
                  <span className="font-medium text-foreground">{formatBytes(usage?.totalUsedBytes)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-card/55 px-3 py-2">
                  <span>{t('portal.subscription.stats.dataRemaining', { defaultValue: 'Data Remaining' })}</span>
                  <span className="font-medium text-foreground">
                    {usage && usage.limitBytes > 0
                      ? formatBytes(usage.remainingBytes)
                      : t('portal.subscription.stats.unlimited', { defaultValue: 'Unlimited' })}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('mieru.quotaDays', { defaultValue: 'Quota Days' })}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">{quotaDays}</p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('mieru.quotaGigabytes', { defaultValue: 'Quota GB' })}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">{quotaGigabytes}</p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('common.createdAt', { defaultValue: 'Created' })}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatTimestamp(user.createdAt, notSetLabel)}</p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('common.updatedAt', { defaultValue: 'Updated' })}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatTimestamp(user.updatedAt, notSetLabel)}</p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('portal.subscription.stats.lastUpdated', { defaultValue: 'Last Updated' })}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {latestUpdatedAt ? latestUpdatedAt.toLocaleString() : notSetLabel}
                </p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('portal.subscription.stats.endpoint', { defaultValue: 'Endpoint' })}
                </p>
                <p
                  className={`mt-1 text-sm font-semibold ${
                    endpointStatus === 'healthy'
                      ? 'text-emerald-400'
                      : endpointStatus === 'degraded'
                        ? 'text-amber-400'
                        : 'text-muted'
                  }`}
                >
                  {endpointStatus === 'healthy'
                    ? t('portal.subscription.stats.healthy', { defaultValue: 'Healthy' })
                    : endpointStatus === 'degraded'
                      ? t('portal.subscription.stats.degraded', { defaultValue: 'Degraded' })
                      : t('portal.subscription.stats.checking', { defaultValue: 'Checking...' })}
                </p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('portal.inbound', { defaultValue: 'Inbound' })}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {infoQuery.data.profile.server}:{infoQuery.data.profile.portRange}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400 lg:hidden">
                {t('portal.steps.import', { defaultValue: 'Step 2 · Import' })}
              </p>
              <p className="text-xs uppercase tracking-wide text-muted">
                {t('portal.subscription.importUrl', { defaultValue: 'Import URL' })}
              </p>
              <div className="flex flex-col gap-3 rounded-2xl border border-line/70 bg-panel/45 p-4 lg:flex-row lg:items-center">
                <code className="min-w-0 flex-1 break-all text-xs text-foreground">{subscriptionUrl}</code>
                <Button size="sm" variant="secondary" onClick={() => void copyToClipboard(subscriptionUrl, 'raw-url')}>
                  <Link2 className="mr-1 h-3.5 w-3.5" />
                  {copiedKey === 'raw-url'
                    ? t('common.copied', { defaultValue: 'Copied' })
                    : t('common.copy', { defaultValue: 'Copy' })}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recommendedApp?.importUrl && recommendedLaunchUrls ? (
                <Button
                  className="sm:col-span-2"
                  onClick={() => {
                    openDeepLinksWithFallback(recommendedLaunchUrls, {
                      onExhausted: () => {
                        void copyToClipboard(recommendedManualUrl, 'recommended-fallback');
                        toast.warning(
                          t('common.warning', { defaultValue: 'Warning' }),
                          t('portal.addToApp.importFallbackCopied', {
                            defaultValue: 'App handoff failed. Subscription URL was copied instead.'
                          })
                        );
                      }
                    });
                  }}
                >
                  <Smartphone className="mr-2 h-4 w-4" />
                  {t('portal.subscription.openInApp', {
                    defaultValue: 'Open in {{app}}',
                    app: recommendedApp.name
                  })}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => void copyToClipboard(recommendedManualUrl || subscriptionUrl, 'recommended-copy')}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t('portal.subscription.copyImportUrl', { defaultValue: 'Copy Import URL' })}
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.open(subscriptionUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('portal.subscription.openCurrentUrl', { defaultValue: 'Open Current URL' })}
              </Button>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              <p className="font-semibold text-amber-50">
                {t('portal.subscription.importFailedTitle', { defaultValue: 'Import failed?' })}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
                {troubleshootingTips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          </Card>

          <Card padding={false} className="overflow-hidden bg-slate-900/55 xl:col-span-2">
            <div className="border-b border-line/60 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400 lg:hidden">
                    {t('portal.steps.chooseClient', { defaultValue: 'Step 1 · Choose client' })}
                  </p>
                  <h2 className="text-lg font-semibold text-foreground">
                    {t('portal.addToApp.title', { defaultValue: 'Third Party Client Software' })}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {t('portal.addToApp.subtitle', {
                      defaultValue: 'Use one-click import where supported, or copy the URL into the app manually.'
                    })}
                  </p>
                </div>
                <div className="inline-flex rounded-2xl border border-line/70 bg-panel/45 p-1">
                  {groupedApps.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setPreferredPlatform(group.platform)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        activeGroup?.platform === group.platform
                          ? 'bg-brand-500 text-white'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      {group.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {activeGroup ? (
              <div className="space-y-3 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10">
                    <Smartphone className="h-4 w-4 text-brand-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{activeGroup.title}</p>
                    <p className="text-xs text-muted">{activeGroup.subtitle}</p>
                  </div>
                </div>

                {recommendedApp ? (
                  <div className="rounded-2xl border border-brand-500/30 bg-brand-500/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300">
                          {t('portal.addToApp.recommended', { defaultValue: 'Recommended client' })}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className="truncate text-sm font-semibold text-foreground">{recommendedApp.name}</p>
                          <p className="text-xs text-muted">{activeGroup.subtitle}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {recommendedApp.importUrl ? (
                          <Button size="sm" onClick={() => onOneClickImport(recommendedApp, `recommended-${recommendedApp.id}`)}>
                            <Smartphone className="mr-1.5 h-3.5 w-3.5" />
                            {t('portal.subscription.openInApp', {
                              defaultValue: 'Open in {{app}}',
                              app: recommendedApp.name
                            })}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant={recommendedApp.importUrl ? 'secondary' : 'primary'}
                          onClick={() => void copyToClipboard(recommendedApp.manualUrl || subscriptionUrl, `recommended-${recommendedApp.id}`)}
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          {t('portal.addToApp.copyUrl', { defaultValue: 'Copy URL' })}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {activeGroup.apps.map((app) => {
                    const actionGridClass = isMobileViewport
                      ? 'grid-cols-1'
                      : app.importUrl && app.storeLink
                        ? 'lg:grid-cols-3'
                        : app.importUrl || app.storeLink
                          ? 'lg:grid-cols-2'
                          : 'lg:grid-cols-1';

                    return (
                      <div key={app.id} className="rounded-2xl border border-line/70 bg-panel/45 p-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line/60 bg-slate-950/40 text-lg">
                              <span aria-hidden="true">{app.icon}</span>
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <p className="truncate text-sm font-semibold text-foreground">{app.name}</p>
                                {recommendedApp?.id === app.id ? (
                                  <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-300">
                                    {t('portal.addToApp.recommended', { defaultValue: 'Recommended client' })}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-xs text-muted">{app.description}</p>
                            </div>
                          </div>

                          <div className={`grid gap-2 ${actionGridClass} lg:min-w-[330px] lg:max-w-[420px]`}>
                            {app.importUrl ? (
                              <Button size="sm" className="w-full" onClick={() => onOneClickImport(app, `app-fallback-${app.id}`)}>
                                <QrCode className="mr-1 h-3.5 w-3.5" />
                                {t('portal.addToApp.oneClickImport', { defaultValue: 'One-Click Import' })}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="secondary"
                              className="w-full"
                              onClick={() => void copyToClipboard(app.manualUrl || subscriptionUrl, `app-${app.id}`)}
                            >
                              <Copy className="mr-1 h-3.5 w-3.5" />
                              {copiedKey === `app-${app.id}`
                                ? t('common.copied', { defaultValue: 'Copied' })
                                : t('portal.addToApp.copyUrl', { defaultValue: 'Copy URL' })}
                            </Button>
                            {app.storeLink ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="w-full"
                                onClick={() => window.open(app.storeLink, '_blank', 'noopener,noreferrer')}
                              >
                                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                {t('portal.addToApp.getApp', { defaultValue: 'Get App' })}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </Card>
        </div>

        {isMobileViewport && subscriptionUrl ? (
          <div className={`pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-40 border-t border-line/80 bg-card/95 lg:hidden ${reduceVisualEffects ? '' : 'backdrop-blur'}`}>
            <div className="pointer-events-auto mx-auto flex max-w-6xl gap-2 px-3 pb-2 pt-2">
              {recommendedApp?.importUrl && recommendedLaunchUrls ? (
                <Button
                  className="flex-1"
                  onClick={() => {
                    openDeepLinksWithFallback(recommendedLaunchUrls, {
                      onExhausted: () => {
                        void copyToClipboard(recommendedManualUrl || subscriptionUrl, 'mobile-sticky-copy-fallback');
                      }
                    });
                  }}
                >
                  <Smartphone className="mr-2 h-4 w-4" />
                  {t('portal.subscription.openInAppShort', { defaultValue: 'Open in App' })}
                </Button>
              ) : (
                <Button className="flex-1" onClick={() => window.open(subscriptionUrl, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t('portal.subscription.openImportUrl', { defaultValue: 'Open Import URL' })}
                </Button>
              )}
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => void copyToClipboard(subscriptionUrl, 'mobile-sticky-copy')}
              >
                {copiedKey === 'mobile-sticky-copy' ? (
                  <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {t('portal.addToApp.copyUrl', { defaultValue: 'Copy URL' })}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-line/70 bg-slate-900/45 p-3 text-center text-xs text-slate-400">
          <div className="inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('portal.subscription.stats.endpoint', { defaultValue: 'Endpoint' })}:</span>
            <span
              className={
                endpointStatus === 'healthy'
                  ? 'text-emerald-400'
                  : endpointStatus === 'degraded'
                    ? 'text-amber-400'
                    : 'text-slate-300'
              }
            >
              {endpointStatus === 'healthy'
                ? t('portal.subscription.stats.healthy', { defaultValue: 'Healthy' })
                : endpointStatus === 'degraded'
                  ? t('portal.subscription.stats.degraded', { defaultValue: 'Degraded' })
                  : t('portal.subscription.stats.checking', { defaultValue: 'Checking...' })}
            </span>
            <Clock className="ml-2 h-3.5 w-3.5 text-slate-400" />
            <span>
              {latestUpdatedAt
                ? latestUpdatedAt.toLocaleTimeString()
                : t('common.notSet', { defaultValue: 'Not set' })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MieruSharePage;
