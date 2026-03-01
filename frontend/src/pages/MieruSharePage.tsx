import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, Link2, QrCode, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { QRCodeDisplay } from '../components/molecules/QRCodeDisplay';
import { useToast } from '../hooks/useToast';
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

interface MieruShareInfo {
  user: {
    username: string;
    enabled: boolean;
    quotas: ShareQuota[];
    createdAt: string | null;
    updatedAt: string | null;
  };
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
  title: string;
  subtitle: string;
  preferredIds: string[];
}> = [
  {
    key: 'desktop',
    platform: 'windows',
    title: 'Desktop',
    subtitle: 'Windows, macOS, Linux',
    preferredIds: ['clashvergerev', 'mihomoparty', 'nyamebox']
  },
  {
    key: 'android',
    platform: 'android',
    title: 'Android',
    subtitle: 'Phones and tablets',
    preferredIds: ['clashmeta_android', 'clashmi', 'exclave', 'husi_mieru_plugin', 'karing', 'nekobox_mieru_plugin']
  },
  {
    key: 'ios',
    platform: 'ios',
    title: 'iOS',
    subtitle: 'iPhone and iPad',
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

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Not set';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not set';
  }

  return parsed.toLocaleString();
}

function getQuotaValue(quotas: ShareQuota[], key: 'days' | 'megabytes'): string {
  const quota = quotas.find((entry) => Number.isInteger(entry?.[key]));
  const value = quota?.[key];
  if (!Number.isInteger(value)) {
    return 'Unlimited';
  }
  return String(value);
}

export const MieruSharePage = () => {
  const { token } = useParams<{ token: string }>();
  const toast = useToast();
  const { t } = useTranslation();

  const [copiedKey, setCopiedKey] = useState('');
  const [preferredPlatform, setPreferredPlatform] = useState<Platform>(() => detectPlatform());

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
    staleTime: 30_000
  });

  const subscriptionUrl = infoQuery.data?.subscription?.url || '';
  const groupedApps = useMemo(
    () => MIERU_APP_GROUPS.map((group) => ({
      ...group,
      apps: orderAppsByPreferredIds(
        resolveSubscriptionApps({
          platform: group.platform,
          urls: { mieru: subscriptionUrl },
          format: 'mieru'
        }),
        group.preferredIds
      )
    })).filter((group) => group.apps.length > 0),
    [subscriptionUrl]
  );
  const activeGroup = groupedApps.find((group) => group.platform === preferredPlatform) || groupedApps[0] || null;

  const copyToClipboard = async (value: string, key: string) => {
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

  const onOneClickImport = (app: ResolvedClientApp) => {
    const launchUrls = buildImportLaunchUrls({
      appId: app.id,
      importUrl: app.importUrl,
      manualUrl: app.manualUrl || subscriptionUrl
    });

    openDeepLinksWithFallback(launchUrls, {
      onExhausted: () => {
        if (app.storeLink) {
          window.open(app.storeLink, '_blank', 'noopener,noreferrer');
        }
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
          <Card className="space-y-3">
            <h1 className="text-2xl font-bold text-foreground">
              {t('portal.subscription.mieruShareTitle', { defaultValue: 'Mieru Access' })}
            </h1>
            <p className="text-sm text-muted">
              {String(infoQuery.error instanceof Error ? infoQuery.error.message : 'Unable to load this Mieru share page.')}
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const { user } = infoQuery.data;
  const quotaDays = getQuotaValue(user.quotas, 'days');
  const quotaMegabytes = getQuotaValue(user.quotas, 'megabytes');

  return (
    <div className="min-h-screen bg-panel px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-400">ONE-UI</p>
          <h1 className="text-3xl font-bold text-foreground">
            {t('portal.subscription.mieruShareTitle', { defaultValue: 'Mieru Access' })}
          </h1>
          <p className="text-sm text-muted">
            {t('portal.subscription.mieruShareSubtitle', {
              defaultValue: 'Import this Mieru profile into a compatible client or copy the raw URL.'
            })}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start 2xl:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="flex flex-col items-center gap-4 xl:self-start">
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

          <Card className="space-y-4">
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

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('mieru.quotaDays', { defaultValue: 'Quota Days' })}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">{quotaDays}</p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('mieru.quotaMegabytes', { defaultValue: 'Quota MB' })}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">{quotaMegabytes}</p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('common.createdAt', { defaultValue: 'Created' })}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatTimestamp(user.createdAt)}</p>
              </div>
              <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t('common.updatedAt', { defaultValue: 'Updated' })}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatTimestamp(user.updatedAt)}</p>
              </div>
            </div>

            <div className="space-y-2">
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
          </Card>

          <Card className="space-y-4 xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
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

              {activeGroup ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-4 w-4 text-brand-400" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{activeGroup.title}</p>
                      <p className="text-xs text-muted">{activeGroup.subtitle}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    {activeGroup.apps.map((app) => (
                      <div key={app.id} className="rounded-2xl border border-line/70 bg-panel/45 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{app.name}</p>
                            <p className="mt-1 text-xs text-muted">{app.description}</p>
                          </div>
                          <span className="text-lg" aria-hidden="true">{app.icon}</span>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {app.importUrl ? (
                            <Button size="sm" onClick={() => onOneClickImport(app)}>
                              <QrCode className="mr-1 h-3.5 w-3.5" />
                              {t('portal.addToApp.oneClickImport', { defaultValue: 'One-Click Import' })}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
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
                              onClick={() => window.open(app.storeLink, '_blank', 'noopener,noreferrer')}
                            >
                              <ExternalLink className="mr-1 h-3.5 w-3.5" />
                              {t('portal.addToApp.getApp', { defaultValue: 'Get App' })}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MieruSharePage;
