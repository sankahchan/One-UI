import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Info,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { QRCodeDisplay } from '../components/molecules/QRCodeDisplay';
import { useToast } from '../hooks/useToast';
import { changeLanguage, languages } from '../i18n';
import type { SubscriptionLink } from '../types';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  detectPlatform,
  resolveSubscriptionApps,
  type FormatTab,
  type Platform,
  type SubscriptionBrandingMetadata
} from '../lib/subscriptionApps';

interface BrandingInfo {
  appName?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  profileTitle?: string | null;
  profileDescription?: string | null;
  supportUrl?: string | null;
  customFooter?: string | null;
  metadata?: SubscriptionBrandingMetadata | null;
}

interface UserInfo {
  email: string;
  status: string;
  usage: {
    upload: number;
    download: number;
    total: number;
    limit: number;
    remaining: number;
    percent: number;
  };
  expiry: {
    date: string;
    daysRemaining: number;
  };
  subscription: {
    url: string;
    clashUrl: string;
    qrUrl: string;
  };
  inbounds: Array<{
    id: number;
    tag: string;
    protocol: string;
    remark: string | null;
  }>;
  trafficResetPeriod: string;
  lastTrafficReset: string | null;
  branding?: BrandingInfo | null;
}

interface PublicSubscriptionLinksResponse {
  success: boolean;
  data?: {
    subscription?: {
      urls?: {
        v2ray?: string;
        clash?: string;
        singbox?: string;
        wireguard?: string;
      };
    };
    links?: SubscriptionLink[];
    shareUrl?: string;
  };
}

interface PublicDeviceEntry {
  fingerprint: string;
  shortFingerprint: string;
  online: boolean;
  lastSeenAt: string;
  clientIp?: string | null;
  userAgent?: string | null;
  inbound?: {
    id: number;
    tag: string;
    protocol: string;
    port: number;
  } | null;
}

interface PublicDevicesResponse {
  success: boolean;
  data?: {
    user: {
      id: number;
      email: string;
      ipLimit?: number | null;
      deviceLimit?: number | null;
    };
    windowMinutes: number;
    total: number;
    online: number;
    devices: PublicDeviceEntry[];
  };
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
};

function normalizeBackendUrl(apiUrl: string): string {
  if (!apiUrl) return '';
  return apiUrl.replace(/\/api\/?$/, '');
}

function sanitizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) return trimmed;
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const six = normalized.length === 3
    ? normalized.split('').map((value) => `${value}${value}`).join('')
    : normalized;
  const parsed = Number.parseInt(six, 16);
  const r = (parsed >> 16) & 255;
  const g = (parsed >> 8) & 255;
  const b = parsed & 255;
  const safeAlpha = Math.min(Math.max(alpha, 0), 1);
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function sanitizeHttpUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export const UserInfoPage = () => {
  const { token } = useParams<{ token: string }>();
  const toast = useToast();
  const { t, i18n } = useTranslation();

  const [platform, setPlatform] = useState<Platform>('android');
  const [activeFormat, setActiveFormat] = useState<FormatTab>('v2ray');
  const [expandedQr, setExpandedQr] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string>('');
  const [devicesWindowMinutes] = useState(60);
  const [revokingFingerprint, setRevokingFingerprint] = useState<string | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const apiUrl = import.meta.env.VITE_API_URL || '';
  const backendUrl = normalizeBackendUrl(apiUrl);

  const { data: userInfo, isLoading, error, refetch } = useQuery({
    queryKey: ['userInfo', token],
    queryFn: async () => {
      const res = await fetch(`${backendUrl}/user/${token}/info`);
      if (!res.ok) throw new Error('Failed to load user info');
      return (await res.json()).data as UserInfo;
    },
    enabled: !!token
  });

  const { data: publicLinks, refetch: refetchLinks } = useQuery({
    queryKey: ['publicSubLinks', token],
    queryFn: async () => {
      const res = await fetch(`${backendUrl}/sub/${token}/links`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error('Failed to load subscription links');
      return (await res.json()) as PublicSubscriptionLinksResponse;
    },
    enabled: !!token
  });

  const { data: devicesResponse, refetch: refetchDevices, isFetching: isFetchingDevices } = useQuery({
    queryKey: ['publicDevices', token, devicesWindowMinutes],
    queryFn: async () => {
      const res = await fetch(`${backendUrl}/user/${token}/devices?windowMinutes=${devicesWindowMinutes}`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error('Failed to load devices');
      return (await res.json()) as PublicDevicesResponse;
    },
    enabled: Boolean(token) && Boolean(backendUrl),
    refetchInterval: 12_000,
    staleTime: 5_000
  });

  const revokeDeviceMutation = useMutation({
    mutationFn: async (fingerprint: string) => {
      const res = await fetch(`${backendUrl}/user/${token}/devices/${encodeURIComponent(fingerprint)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || t('portal.toast.revokeFailed', { defaultValue: 'Failed to revoke device' }));
      }
      return (await res.json()) as { success: boolean };
    },
    onSuccess: async () => {
      toast.success(t('common.success', { defaultValue: 'Success' }), t('portal.devicesRevoked', { defaultValue: 'Device revoked.' }));
      await refetchDevices();
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('portal.toast.revokeFailed', { defaultValue: 'Failed to revoke device' })
      );
    }
  });

  const branding = userInfo?.branding || null;
  const brandingMetadata = branding?.metadata || null;
  const accentColor = sanitizeHexColor(branding?.accentColor) || '#22d3ee';
  const primaryColor = sanitizeHexColor(branding?.primaryColor) || '#3b82f6';

  const urls = useMemo(() => {
    const candidate = publicLinks?.data?.subscription?.urls || {};
    const fallbackBase = userInfo?.subscription?.url || '';
    return {
      v2ray: candidate.v2ray || (fallbackBase ? `${fallbackBase}?target=v2ray` : ''),
      clash: candidate.clash || (fallbackBase ? `${fallbackBase}?target=clash` : ''),
      singbox: candidate.singbox || (fallbackBase ? `${fallbackBase}?target=singbox` : ''),
      wireguard: candidate.wireguard || (fallbackBase ? `${fallbackBase}?target=wireguard` : '')
    };
  }, [publicLinks, userInfo?.subscription?.url]);

  const shareUrl = publicLinks?.data?.shareUrl || '';
  const nodeLinks = publicLinks?.data?.links || [];
  const activeLanguageCode = useMemo(() => {
    const normalized = String(i18n.resolvedLanguage || i18n.language || 'en')
      .toLowerCase()
      .split('-')[0];
    return languages.some((entry) => entry.code === normalized) ? normalized : 'en';
  }, [i18n.language, i18n.resolvedLanguage]);

  const availableFormats = useMemo(() => {
    const entries: Array<{ key: FormatTab; label: string }> = [
      { key: 'v2ray', label: t('portal.formats.v2ray', { defaultValue: 'V2Ray' }) },
      { key: 'clash', label: t('portal.formats.clash', { defaultValue: 'Clash' }) },
      { key: 'singbox', label: t('portal.formats.singbox', { defaultValue: 'Sing-box' }) },
      { key: 'wireguard', label: t('portal.formats.wireguard', { defaultValue: 'WireGuard' }) }
    ];
    return entries.filter((entry) => Boolean(urls[entry.key]));
  }, [t, urls]);

  const getResetPeriodLabel = (period: string) => {
    const normalized = String(period || '').toUpperCase();
    if (!normalized) return '';
    if (normalized === 'NEVER') {
      return t('portal.resetPeriods.never', { defaultValue: 'never' });
    }
    return t(`portal.resetPeriods.${normalized.toLowerCase()}`, {
      defaultValue: normalized.toLowerCase()
    });
  };

  const getUserStatusLabel = (status: string) => {
    const normalized = String(status || '').toUpperCase();
    const key = `status.${normalized.toLowerCase()}`;
    return t(key, { defaultValue: normalized || status || '-' });
  };

  const getFormatBadgeLabel = (format: FormatTab) => {
    if (format === 'clash') {
      return t('portal.subscription.formatHint.clash', { defaultValue: 'Clash / Meta clients' });
    }
    if (format === 'v2ray') {
      return t('portal.subscription.formatHint.v2ray', { defaultValue: 'V2Ray subscription' });
    }
    if (format === 'singbox') {
      return t('portal.subscription.formatHint.singbox', { defaultValue: 'Sing-box subscription' });
    }
    return t('portal.subscription.formatHint.wireguard', { defaultValue: 'WireGuard subscription' });
  };

  const getPlatformLabel = (entry: Platform) => {
    if (entry === 'android') return t('portal.addToApp.platform.android', { defaultValue: 'Android' });
    if (entry === 'ios') return t('portal.addToApp.platform.ios', { defaultValue: 'iOS' });
    return t('portal.addToApp.platform.desktop', { defaultValue: 'Desktop' });
  };

  useEffect(() => {
    if (availableFormats.length === 0) return;
    const hasActive = availableFormats.some((entry) => entry.key === activeFormat);
    if (!hasActive) {
      setActiveFormat(availableFormats[0].key);
    }
  }, [activeFormat, availableFormats]);

  const selectedUrl = urls[activeFormat] || '';
  const devices = devicesResponse?.data?.devices || [];
  const devicesSummary = devicesResponse?.data || null;

  const copyToClipboard = async (text: string, key: string) => {
    if (!text) return;
    const copied = await copyTextToClipboard(text);
    if (copied) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 1600);
      toast.success(
        t('common.copied', { defaultValue: 'Copied' }),
        t('portal.linkCopied', { defaultValue: 'Link copied to clipboard.' })
      );
      return;
    }

    toast.error(
      t('common.error', { defaultValue: 'Error' }),
      t('portal.copyFailed', { defaultValue: 'Please copy manually.' })
    );
  };

  const toggleNodeQr = (inboundId: number) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(inboundId)) {
        next.delete(inboundId);
      } else {
        next.add(inboundId);
      }
      return next;
    });
  };

  const appsForPlatform = useMemo(() => {
    return resolveSubscriptionApps({
      platform,
      urls,
      metadata: brandingMetadata
    });
  }, [platform, urls, brandingMetadata]);

  const heroStyle = useMemo(() => {
    return {
      backgroundImage: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`
    } as const;
  }, [accentColor, primaryColor]);

  const wallpaperUrl = useMemo(
    () => sanitizeHttpUrl(brandingMetadata?.wallpaperUrl as string | undefined),
    [brandingMetadata?.wallpaperUrl]
  );
  const wallpaperOverlayOpacity = useMemo(
    () => clampNumber(brandingMetadata?.wallpaperOverlayOpacity, 10, 90, 62),
    [brandingMetadata?.wallpaperOverlayOpacity]
  );
  const wallpaperBlurPx = useMemo(
    () => clampNumber(brandingMetadata?.wallpaperBlurPx, 0, 24, 0),
    [brandingMetadata?.wallpaperBlurPx]
  );
  const wallpaperPositionX = useMemo(
    () => clampNumber((brandingMetadata as any)?.wallpaperPositionX, 0, 100, 50),
    [brandingMetadata]
  );
  const wallpaperPositionY = useMemo(
    () => clampNumber((brandingMetadata as any)?.wallpaperPositionY, 0, 100, 50),
    [brandingMetadata]
  );
  const wallpaperGradientFrom = useMemo(
    () => sanitizeHexColor((brandingMetadata as any)?.wallpaperGradientFrom as string | undefined) || primaryColor,
    [brandingMetadata, primaryColor]
  );
  const wallpaperGradientTo = useMemo(
    () => sanitizeHexColor((brandingMetadata as any)?.wallpaperGradientTo as string | undefined) || accentColor,
    [accentColor, brandingMetadata]
  );
  const wallpaperGradientOpacity = useMemo(
    () => clampNumber((brandingMetadata as any)?.wallpaperGradientOpacity, 0, 100, 62),
    [brandingMetadata]
  );
  const hasWallpaper = Boolean(wallpaperUrl);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-line/80 border-t-brand-500" />
      </div>
    );
  }

  if (error || !userInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <Card className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400">
            <Info className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-bold text-foreground">
            {t('portal.notFound.title', { defaultValue: 'Subscription Not Found' })}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {t('portal.notFound.body', {
              defaultValue: 'The subscription token is invalid, expired, or has been revoked.'
            })}
          </p>
        </Card>
      </div>
    );
  }

  const usageAlert = (() => {
    if (userInfo.usage.limit <= 0) {
      return null;
    }

    const thresholdsRaw = brandingMetadata?.usageAlertThresholds;
    const thresholds = Array.isArray(thresholdsRaw) && thresholdsRaw.length > 0
      ? thresholdsRaw
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .sort((a, b) => b - a)
      : [95, 90, 80];

    const hit = thresholds.find((value) => userInfo.usage.percent >= value);
    if (!hit) return null;

    if (hit >= 95) {
      return {
        label: t('portal.hero.usageAlert.almostOut', {
          defaultValue: 'Almost out of data ({{percent}}%)',
          percent: hit
        }),
        tone: 'bg-rose-500/15 text-rose-200 border-rose-500/25'
      };
    }
    if (hit >= 90) {
      return {
        label: t('portal.hero.usageAlert.high', {
          defaultValue: 'High usage ({{percent}}%)',
          percent: hit
        }),
        tone: 'bg-amber-500/15 text-amber-100 border-amber-500/25'
      };
    }
    return {
      label: t('portal.hero.usageAlert.normal', {
        defaultValue: 'Usage alert ({{percent}}%)',
        percent: hit
      }),
      tone: 'bg-sky-500/15 text-sky-100 border-sky-500/25'
    };
  })();

  const qrLogoSizePercent = (() => {
    const raw = brandingMetadata?.qrLogoSizePercent;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return Math.min(Math.max(value, 10), 40);
  })();

  const handleRefreshAll = async () => {
    try {
      await Promise.all([refetch(), refetchLinks()]);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('portal.toast.refreshed', { defaultValue: 'Subscription data refreshed.' })
      );
    } catch (err: any) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        err?.message || t('portal.toast.refreshFailed', { defaultValue: 'Unable to refresh.' })
      );
    }
  };

  const downloadNodeLinks = () => {
    if (nodeLinks.length === 0) {
      toast.info(
        t('common.info', { defaultValue: 'Info' }),
        t('portal.toast.noNodes', { defaultValue: 'There are no node links to download.' })
      );
      return;
    }

    const content = nodeLinks
      .map((link) => `# ${link.remark} [${link.protocol}] (${link.network}/${link.security})\n${link.url}`)
      .join('\n\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `one-ui-nodes-${token || 'subscription'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      {hasWallpaper ? (
        <>
          <div
            className="pointer-events-none fixed inset-0 -z-20 bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url(${wallpaperUrl})`,
              backgroundPosition: `${wallpaperPositionX}% ${wallpaperPositionY}%`,
              filter: wallpaperBlurPx > 0 ? `blur(${wallpaperBlurPx}px)` : undefined,
              transform: wallpaperBlurPx > 0 ? 'scale(1.03)' : undefined
            }}
          />
          <div
            className="pointer-events-none fixed inset-0 -z-10"
            style={{
              backgroundImage: `linear-gradient(135deg, ${hexToRgba(wallpaperGradientFrom, wallpaperGradientOpacity / 100)} 0%, ${hexToRgba(wallpaperGradientTo, wallpaperGradientOpacity / 100)} 100%)`
            }}
          />
          <div
            className="pointer-events-none fixed inset-0 -z-10"
            style={{ backgroundColor: `rgba(2, 6, 23, ${wallpaperOverlayOpacity / 100})` }}
          />
        </>
      ) : null}
      {!hasWallpaper ? (
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            backgroundImage: `linear-gradient(135deg, ${hexToRgba(wallpaperGradientFrom, Math.min(Math.max(wallpaperGradientOpacity / 150, 0.2), 0.6))} 0%, ${hexToRgba(wallpaperGradientTo, Math.min(Math.max(wallpaperGradientOpacity / 130, 0.25), 0.7))} 100%)`
          }}
        />
      ) : null}
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Brand header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {branding?.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.appName || t('portal.header.logoAlt', { defaultValue: 'Logo' })}
                className="h-12 w-12 rounded-2xl border border-line/70 bg-card object-contain p-2"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line/70 bg-card text-lg font-bold text-foreground">
                {String(branding?.appName || 'One-UI').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted">
                {branding?.appName || 'One-UI'}
              </p>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
                {branding?.profileTitle || t('portal.header.defaultTitle', { defaultValue: 'Subscription Center' })}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {branding?.profileDescription ||
                  t('portal.header.defaultDescription', {
                    defaultValue: 'Import your subscription and manage your access.'
                  })}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-line/70 bg-card/70 px-3 py-2 text-sm text-foreground">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('portal.language', { defaultValue: 'Language' })}
              </span>
              <select
                value={activeLanguageCode}
                onChange={(event) => {
                  changeLanguage(event.target.value);
                }}
                className="rounded-md border border-line/60 bg-panel/70 px-2 py-1 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                aria-label={t('portal.language', { defaultValue: 'Language' })}
              >
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.nativeName}
                  </option>
                ))}
              </select>
            </label>
            {branding?.supportUrl ? (
              <Button
                variant="secondary"
                onClick={() => window.open(branding.supportUrl as string, '_blank', 'noopener,noreferrer')}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                {t('portal.header.support', { defaultValue: 'Support' })}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => void handleRefreshAll()}>
              <Clock className="mr-2 h-4 w-4" />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </div>

        {/* Hero */}
        <section className="overflow-hidden rounded-3xl border border-line/70 shadow-soft">
          <div className="p-6 text-white sm:p-8" style={heroStyle}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm/5 opacity-90">{t('portal.hero.account', { defaultValue: 'Account' })}</p>
                <h2 className="mt-1 truncate text-xl font-semibold sm:text-2xl">{userInfo.email}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                      userInfo.status === 'ACTIVE'
                        ? 'border-emerald-200/40 bg-emerald-100/20 text-emerald-50'
                        : userInfo.status === 'EXPIRED'
                          ? 'border-rose-200/35 bg-rose-100/20 text-rose-50'
                        : 'border-amber-200/35 bg-amber-100/20 text-amber-50'
                    }`}
                  >
                    {getUserStatusLabel(userInfo.status)}
                  </span>
                  {userInfo.trafficResetPeriod !== 'NEVER' ? (
                    <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
                      <Clock className="mr-1 h-3 w-3" />
                      {t('portal.hero.resets', {
                        defaultValue: 'Resets {{period}}',
                        period: getResetPeriodLabel(userInfo.trafficResetPeriod)
                      })}
                    </span>
                  ) : null}
                  {usageAlert ? (
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${usageAlert.tone}`}>
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      {usageAlert.label}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/25 bg-white/10 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-white/80">
                  {t('portal.hero.validUntil', { defaultValue: 'Valid Until' })}
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <Calendar className="h-4 w-4" />
                  {new Date(userInfo.expiry.date).toLocaleDateString()}
                </p>
                <p className="mt-1 text-xs text-white/75">
                  {t('portal.hero.daysRemaining', {
                    defaultValue: '{{days}} days remaining',
                    days: userInfo.expiry.daysRemaining
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white/10 px-6 py-5 text-white sm:px-8">
            <div className="mb-2 flex justify-between text-sm">
              <span className="opacity-90">{t('portal.hero.dataUsage', { defaultValue: 'Data Usage' })}</span>
              <span className="font-semibold">
                {formatBytes(userInfo.usage.total)} / {userInfo.usage.limit > 0 ? formatBytes(userInfo.usage.limit) : '∞'}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white/70 transition-all duration-500"
                style={{ width: `${Math.min(userInfo.usage.percent, 100)}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2 text-white/90">
                <ArrowUp className="h-4 w-4" />
                {t('portal.hero.upload', { defaultValue: 'Upload' })}: {formatBytes(userInfo.usage.upload)}
              </div>
              <div className="flex items-center gap-2 text-white/90 sm:justify-end">
                <ArrowDown className="h-4 w-4" />
                {t('portal.hero.download', { defaultValue: 'Download' })}: {formatBytes(userInfo.usage.download)}
              </div>
            </div>
          </div>
        </section>

        {/* Subscription hub */}
        <Card className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {t('portal.subscription.title', { defaultValue: 'Subscription' })}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t('portal.subscription.description', {
                  defaultValue: 'Copy the URL, scan the QR code, or use one-click import.'
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableFormats.map((format) => (
                <button
                  key={format.key}
                  onClick={() => setActiveFormat(format.key)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    activeFormat === format.key
                      ? 'bg-brand-500 text-white shadow-soft'
                      : 'border border-line/70 bg-card/70 text-muted hover:text-foreground'
                  }`}
                >
                  {format.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-line/70 bg-panel/55 p-5">
              <div className="rounded-2xl border border-line/70 bg-white p-4">
                <QRCodeDisplay
                  text={selectedUrl || userInfo.subscription.url}
                  size={210}
                  logoUrl={branding?.logoUrl || null}
                  logoSizePercent={qrLogoSizePercent}
                />
              </div>
              <div className="mt-4 text-center text-sm text-muted">
                {getFormatBadgeLabel(activeFormat)}
              </div>
              <Button
                variant="ghost"
                className="mt-3"
                onClick={() => setExpandedQr((prev) => !prev)}
              >
                <QrCode className="mr-2 h-4 w-4" />
                {expandedQr
                  ? t('portal.subscription.hideLargeQr', { defaultValue: 'Hide Large QR' })
                  : t('portal.subscription.showLargeQr', { defaultValue: 'Show Large QR' })}
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-muted">
                  {t('portal.subscription.urlLabel', { defaultValue: 'Subscription URL' })}
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={selectedUrl}
                    onClick={(e) => { (e.target as HTMLInputElement).select(); void copyToClipboard(selectedUrl, `sub-${activeFormat}`); }}
                    className="flex-1 cursor-pointer select-all rounded-xl border border-line/80 bg-card/80 px-3 py-2 font-mono text-xs text-foreground sm:text-sm"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void copyToClipboard(selectedUrl, `sub-${activeFormat}`)}
                  >
                    {copiedKey === `sub-${activeFormat}` ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => window.open(userInfo.subscription.clashUrl, '_blank', 'noopener,noreferrer')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t('portal.subscription.downloadClashYaml', { defaultValue: 'Download Clash YAML' })}
                </Button>

                {shareUrl ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => void copyToClipboard(shareUrl, 'share')}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t('portal.subscription.copySharePage', { defaultValue: 'Copy Share Page' })}
                  </Button>
                ) : null}
              </div>

              <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 text-sm text-muted">
                <p className="font-semibold text-foreground">
                  {t('portal.subscription.quickTipTitle', { defaultValue: 'Quick tip' })}
                </p>
                <p className="mt-1">
                  {t('portal.subscription.quickTipBody', {
                    defaultValue:
                      'If a client can’t import via deep link, copy the subscription URL and use “Import from URL” inside the app.'
                  })}
                </p>
              </div>
            </div>
          </div>

          {expandedQr ? (
            <div className="flex justify-center rounded-2xl border border-line/70 bg-panel/55 p-6">
              <div className="rounded-3xl border border-line/70 bg-white p-5">
                <QRCodeDisplay
                  text={selectedUrl || userInfo.subscription.url}
                  size={320}
                  logoUrl={branding?.logoUrl || null}
                  logoSizePercent={qrLogoSizePercent}
                />
              </div>
            </div>
          ) : null}
        </Card>

        {/* Add to app */}
        <Card className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {t('portal.addToApp.title', { defaultValue: 'Add To App' })}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t('portal.addToApp.description', { defaultValue: 'Choose your device and import with one tap.' })}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(['android', 'ios', 'windows'] as Platform[]).map((entry) => (
                <button
                  key={entry}
                  onClick={() => setPlatform(entry)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    platform === entry
                      ? 'bg-brand-500 text-white shadow-soft'
                      : 'border border-line/70 bg-card/70 text-muted hover:text-foreground'
                  }`}
                >
                  {getPlatformLabel(entry)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {appsForPlatform.map((app) => {
              const usedFormat = app.usesFormat || 'v2ray';
              const importUrl = app.importUrl;
              const storeLink = app.storeLink;
              const manualUrl = app.manualUrl || urls[usedFormat] || selectedUrl;

              return (
                <div key={app.id} className="rounded-2xl border border-line/70 bg-panel/55 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line/70 bg-card text-2xl">
                        {app.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-foreground">{app.name}</p>
                        <p className="mt-1 text-sm text-muted">
                          {t(`portal.apps.${app.id}.description`, { defaultValue: app.description })}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-xs font-semibold text-muted">
                      {usedFormat.toUpperCase()}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2">
                    {importUrl ? (
                      <Button
                        className="w-full"
                        onClick={() => {
                          // Prefer direct navigation so mobile OS can hand over to app.
                          window.location.href = importUrl;
                        }}
                      >
                        <Smartphone className="mr-2 h-4 w-4" />
                        {t('portal.addToApp.oneClickImport', { defaultValue: 'One-Click Import' })}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => void copyToClipboard(manualUrl, `manual-${app.id}`)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {t('portal.addToApp.copyUrl', { defaultValue: 'Copy URL' })}
                      </Button>
                    )}

                    <div className="flex gap-2">
                      {storeLink ? (
                        <a
                          href={storeLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1"
                        >
                          <Button variant="secondary" className="w-full">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            {t('portal.addToApp.getApp', { defaultValue: 'Get App' })}
                          </Button>
                        </a>
                      ) : (
                        <Button variant="secondary" className="w-full flex-1" disabled>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          {t('portal.addToApp.getApp', { defaultValue: 'Get App' })}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        className="px-4"
                        onClick={() => void copyToClipboard(urls[usedFormat] || selectedUrl, `app-${app.id}`)}
                        aria-label={t('portal.addToApp.copyUrl', { defaultValue: 'Copy URL' })}
                      >
                        {copiedKey === `app-${app.id}` ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Individual node links */}
        <Card className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {t('portal.nodes.title', { defaultValue: 'Individual Nodes' })}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t('portal.nodes.description', {
                  defaultValue: 'Advanced: copy a single node link or scan its QR code.'
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={downloadNodeLinks} disabled={nodeLinks.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                {t('portal.nodes.downloadAll', { defaultValue: 'Download All' })}
              </Button>
            </div>
          </div>

          {nodeLinks.length === 0 ? (
            <div className="rounded-2xl border border-line/70 bg-panel/55 p-5 text-sm text-muted">
              {t('portal.nodes.none', { defaultValue: 'No node links available for this subscription.' })}
            </div>
          ) : (
            <div className="space-y-3">
              {nodeLinks.map((link) => {
                const isExpanded = expandedNodes.has(link.inboundId);
                const copyKey = `node-${link.inboundId}`;
                return (
                  <div key={link.inboundId} className="rounded-2xl border border-line/70 bg-panel/55 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-400">
                        {link.protocol}
                      </span>
                      <span className="flex-1 truncate text-sm font-semibold text-foreground">{link.remark}</span>
                      <span className="text-xs text-muted">
                        {link.network} / {link.security}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void copyToClipboard(link.url, copyKey)}
                      >
                        {copiedKey === copyKey ? <CheckCircle2 className="mr-1.5 h-4 w-4 text-emerald-500" /> : <Copy className="mr-1.5 h-4 w-4" />}
                        {copiedKey === copyKey
                          ? t('common.copied', { defaultValue: 'Copied' })
                          : t('portal.nodes.copy', { defaultValue: 'Copy' })}
                      </Button>

                      <Button size="sm" variant="ghost" onClick={() => toggleNodeQr(link.inboundId)}>
                        <QrCode className="mr-1.5 h-4 w-4" />
                        {isExpanded
                          ? t('portal.nodes.hideQr', { defaultValue: 'Hide QR' })
                          : t('portal.nodes.showQr', { defaultValue: 'QR' })}
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                      >
                        <ExternalLink className="mr-1.5 h-4 w-4" />
                        {t('common.open', { defaultValue: 'Open' })}
                      </Button>
                    </div>

                    {isExpanded ? (
                      <div className="mt-4 flex justify-center">
                        <div className="rounded-2xl border border-line/70 bg-white p-4">
                          <QRCodeDisplay
                            text={link.url}
                            size={220}
                            logoUrl={branding?.logoUrl || null}
                            logoSizePercent={qrLogoSizePercent}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <details className="rounded-2xl border border-line/70 bg-panel/55 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              {t('portal.nodes.instructions.title', { defaultValue: 'Import instructions' })}
            </summary>
            <div className="mt-3 space-y-2 text-sm text-muted">
              <p className="text-foreground/90 font-semibold">
                {t('portal.nodes.instructions.generalTitle', { defaultValue: 'General' })}
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  {t('portal.nodes.instructions.generalStep1', {
                    defaultValue: 'Copy your subscription URL from the Subscription section above.'
                  })}
                </li>
                <li>
                  {t('portal.nodes.instructions.generalStep2', {
                    defaultValue: 'Open your client app and choose “Import from URL / Subscription”.'
                  })}
                </li>
                <li>
                  {t('portal.nodes.instructions.generalStep3', {
                    defaultValue: 'Paste the URL and refresh/update the profile.'
                  })}
                </li>
              </ol>
              <p className="mt-3 text-foreground/90 font-semibold">
                {t('portal.nodes.instructions.failTitle', { defaultValue: 'If import fails' })}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  {t('portal.nodes.instructions.failTip1', {
                    defaultValue: 'Try a different format tab (Clash vs V2Ray vs Sing-box).'
                  })}
                </li>
                <li>
                  {t('portal.nodes.instructions.failTip2', {
                    defaultValue: 'Switch network/Wi-Fi and try again.'
                  })}
                </li>
                <li>
                  {t('portal.nodes.instructions.failTip3', {
                    defaultValue: 'Use Individual Nodes to add a single server manually.'
                  })}
                </li>
              </ul>
            </div>
          </details>
        </Card>

        {/* Devices */}
        <Card className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">{t('portal.devices', { defaultValue: 'Devices' })}</h3>
              <p className="mt-1 text-sm text-muted">
                {(devicesSummary?.online ?? 0)} {t('portal.online', { defaultValue: 'online' })} / {(devicesSummary?.total ?? 0)} {t('portal.seenInWindow', { defaultValue: 'seen in last' })} {devicesSummary?.windowMinutes ?? devicesWindowMinutes}m
              </p>
              <p className="mt-1 text-xs text-muted">
                {t('portal.limits', { defaultValue: 'Limits' })}: IP {devicesSummary?.user?.ipLimit ?? '-'} • {t('portal.devicesLower', { defaultValue: 'devices' })} {devicesSummary?.user?.deviceLimit ?? '-'}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => void refetchDevices()}
              loading={isFetchingDevices}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>

          {devices.length === 0 ? (
            <div className="rounded-2xl border border-line/70 bg-panel/55 p-5 text-sm text-muted">
              {t('portal.noDevices', { defaultValue: 'No devices tracked yet.' })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr className="border-b border-line/70">
                    <th className="py-2 pr-3">{t('portal.status', { defaultValue: 'Status' })}</th>
                    <th className="py-2 pr-3">{t('portal.fingerprint', { defaultValue: 'Fingerprint' })}</th>
                    <th className="py-2 pr-3">{t('portal.ip', { defaultValue: 'IP' })}</th>
                    <th className="py-2 pr-3">{t('portal.inbound', { defaultValue: 'Inbound' })}</th>
                    <th className="py-2 pr-3">{t('portal.lastSeen', { defaultValue: 'Last seen' })}</th>
                    <th className="py-2 text-right">{t('portal.action', { defaultValue: 'Action' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.slice(0, 12).map((device) => (
                    <tr key={device.fingerprint} className="border-b border-line/50">
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
                            device.online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-300'
                          }`}
                        >
                          <span className="relative inline-flex h-2.5 w-2.5">
                            {device.online ? (
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                            ) : null}
                            <span
                              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                                device.online ? 'bg-emerald-400' : 'bg-zinc-400'
                              }`}
                            />
                          </span>
                          {device.online ? t('portal.online', { defaultValue: 'Online' }) : t('portal.offline', { defaultValue: 'Offline' })}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted">{device.shortFingerprint}</td>
                      <td className="py-2 pr-3 text-muted">{device.clientIp || '-'}</td>
                      <td className="py-2 pr-3 text-xs text-muted">
                        {device.inbound ? `${device.inbound.protocol} • ${device.inbound.port}` : '-'}
                      </td>
                      <td className="py-2 pr-3 text-muted">{new Date(device.lastSeenAt).toLocaleString()}</td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={revokeDeviceMutation.isPending && revokingFingerprint === device.fingerprint}
                          onClick={() => {
                            const ok = window.confirm(
                              t('portal.confirmRevokeDevice', { defaultValue: 'Revoke this device? It will need to reconnect.' })
                            );
                            if (ok) {
                              setRevokingFingerprint(device.fingerprint);
                              revokeDeviceMutation.mutate(device.fingerprint, {
                                onSettled: () => setRevokingFingerprint(null)
                              });
                            }
                          }}
                        >
                          {t('portal.revoke', { defaultValue: 'Revoke' })}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {devices.length > 12 ? (
                <p className="mt-3 text-xs text-muted">
                  {t('portal.showingFirst', { defaultValue: 'Showing first' })} 12 {t('portal.devicesLower', { defaultValue: 'devices' })}.
                </p>
              ) : null}
            </div>
          )}
        </Card>

        <div className="py-4 text-center text-xs text-muted">
          {branding?.customFooter
            ? branding.customFooter
            : t('portal.footer.poweredBy', {
                defaultValue: 'Powered by {{appName}}',
                appName: branding?.appName || 'One-UI'
              })}
        </div>
      </div>
    </div>
  );
};
