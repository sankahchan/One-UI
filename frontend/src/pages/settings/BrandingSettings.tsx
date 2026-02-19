import React, { useMemo, useState } from 'react';
import { Edit, Palette, Sparkles, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';
import { BUILTIN_CLIENT_APPS } from '../../lib/subscriptionApps';

interface SubscriptionBranding {
  id: number;
  scope: 'GLOBAL' | 'GROUP' | 'USER';
  enabled: boolean;
  priority: number;
  name: string;
  appName?: string | null;
  logoUrl?: string | null;
  supportUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  profileTitle?: string | null;
  profileDescription?: string | null;
  customFooter?: string | null;
  clashProfileName?: string | null;
  metadata?: unknown;
  userId?: number | null;
  groupId?: number | null;
}

type BrandingMetadataDraft = {
  enabledApps?: string[];
  customApps?: unknown[];
  qrLogoSizePercent?: number;
  usageAlertThresholds?: number[];
};

const BRANDING_PRESETS = [
  { id: 'aurora', name: 'Aurora', primary: '#3b82f6', accent: '#6366f1' },
  { id: 'emerald', name: 'Emerald', primary: '#10b981', accent: '#14b8a6' },
  { id: 'sunset', name: 'Sunset', primary: '#f97316', accent: '#ef4444' },
  { id: 'rose', name: 'Rose', primary: '#ec4899', accent: '#a855f7' }
] as const;

function normalizeHexColor(value: string | null | undefined, fallback: string): string {
  const input = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(input)) {
    return input;
  }
  if (/^[0-9a-fA-F]{6}$/.test(input)) {
    return `#${input}`;
  }
  return fallback;
}

function parseNumberList(value: string): number[] {
  return value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? [], null, 2);
  } catch {
    return '[]';
  }
}

const BrandingSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'GLOBAL' | 'GROUP' | 'USER'>('GLOBAL');
  const [appName, setAppName] = useState('One-UI');
  const [logoUrl, setLogoUrl] = useState('');
  const [profileTitle, setProfileTitle] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [customFooter, setCustomFooter] = useState('');
  const [clashProfileName, setClashProfileName] = useState('');
  const [supportUrl, setSupportUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [userId, setUserId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [priority, setPriority] = useState(100);
  const [enabledApps, setEnabledApps] = useState<string[]>([]);
  const [qrLogoSizePercent, setQrLogoSizePercent] = useState<string>('');
  const [usageAlertThresholds, setUsageAlertThresholds] = useState<string>('80,90,95');
  const [customAppsJson, setCustomAppsJson] = useState<string>('[]');

  const brandingQuery = useQuery({
    queryKey: ['subscription-branding'],
    queryFn: async () => {
      const response = await apiClient.get('/settings/subscription-branding');
      return (response.data?.brandings || []) as SubscriptionBranding[];
    }
  });

  const isEditing = Number.isInteger(editingId) && (editingId as number) > 0;

  const groupedApps = useMemo(() => {
    const groups: Record<string, typeof BUILTIN_CLIENT_APPS> = {
      android: [],
      ios: [],
      windows: []
    };

    for (const app of BUILTIN_CLIENT_APPS) {
      for (const platform of app.platforms) {
        groups[platform].push(app);
      }
    }

    return groups;
  }, []);

  const previewPrimary = useMemo(
    () => normalizeHexColor(primaryColor, '#3b82f6'),
    [primaryColor]
  );
  const previewAccent = useMemo(
    () => normalizeHexColor(accentColor, '#6366f1'),
    [accentColor]
  );
  const selectedAppsCount = enabledApps.length > 0 ? enabledApps.length : BUILTIN_CLIENT_APPS.length;

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setScope('GLOBAL');
    setAppName('One-UI');
    setLogoUrl('');
    setProfileTitle('');
    setProfileDescription('');
    setCustomFooter('');
    setClashProfileName('');
    setSupportUrl('');
    setPrimaryColor('');
    setAccentColor('');
    setUserId('');
    setGroupId('');
    setPriority(100);
    setEnabledApps([]);
    setQrLogoSizePercent('');
    setUsageAlertThresholds('80,90,95');
    setCustomAppsJson('[]');
  };

  const loadForEdit = (branding: SubscriptionBranding) => {
    setEditingId(branding.id);
    setName(branding.name || '');
    setScope(branding.scope);
    setAppName(branding.appName || 'One-UI');
    setLogoUrl(branding.logoUrl || '');
    setProfileTitle(branding.profileTitle || '');
    setProfileDescription(branding.profileDescription || '');
    setCustomFooter(branding.customFooter || '');
    setClashProfileName(branding.clashProfileName || '');
    setSupportUrl(branding.supportUrl || '');
    setPrimaryColor(branding.primaryColor || '');
    setAccentColor(branding.accentColor || '');
    setUserId(branding.userId ? String(branding.userId) : '');
    setGroupId(branding.groupId ? String(branding.groupId) : '');
    setPriority(Number.isInteger(branding.priority) ? branding.priority : 100);

    const metadata = branding.metadata && typeof branding.metadata === 'object' ? (branding.metadata as any) : {};
    setEnabledApps(Array.isArray(metadata.enabledApps) ? metadata.enabledApps.map(String) : []);
    setQrLogoSizePercent(metadata.qrLogoSizePercent !== undefined ? String(metadata.qrLogoSizePercent) : '');
    setUsageAlertThresholds(
      Array.isArray(metadata.usageAlertThresholds)
        ? metadata.usageAlertThresholds.map((v: any) => String(v)).join(',')
        : '80,90,95'
    );
    setCustomAppsJson(stringifyJson(metadata.customApps || []));
  };

  const saveBranding = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name,
        scope,
        appName,
        logoUrl,
        profileTitle,
        profileDescription,
        customFooter,
        clashProfileName,
        supportUrl,
        primaryColor,
        accentColor,
        priority
      };

      if (scope === 'USER' && userId.trim()) {
        payload.userId = Number.parseInt(userId, 10);
      }
      if (scope === 'GROUP' && groupId.trim()) {
        payload.groupId = Number.parseInt(groupId, 10);
      }

      const metadataDraft: BrandingMetadataDraft = {};
      if (enabledApps.length > 0) {
        metadataDraft.enabledApps = enabledApps;
      }
      const qrLogoSizeValue = Number(qrLogoSizePercent);
      if (Number.isFinite(qrLogoSizeValue)) {
        metadataDraft.qrLogoSizePercent = Math.min(Math.max(qrLogoSizeValue, 10), 40);
      }

      const thresholds = parseNumberList(usageAlertThresholds).map((value) => Math.min(Math.max(value, 1), 100));
      if (thresholds.length > 0) {
        metadataDraft.usageAlertThresholds = thresholds;
      }

      try {
        const customJson = customAppsJson.trim() ? customAppsJson : '[]';
        const parsed = JSON.parse(customJson);
        if (!Array.isArray(parsed)) {
          throw new Error('Custom apps JSON must be an array.');
        }
        metadataDraft.customApps = parsed;
      } catch (error: any) {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          error?.message || t('brandingSettings.toast.invalidJson', { defaultValue: 'Custom apps JSON is invalid.' })
        );
        throw error;
      }

      // Always persist metadata when editing so admins can clear previous values by saving an empty object.
      if (isEditing || Object.keys(metadataDraft).length > 0) {
        payload.metadata = metadataDraft;
      }

      if (isEditing) {
        await apiClient.put(`/settings/subscription-branding/${editingId}`, payload);
      } else {
        await apiClient.post('/settings/subscription-branding', payload);
      }
    },
    onSuccess: async () => {
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        isEditing
          ? t('brandingSettings.toast.updated', { defaultValue: 'Subscription branding updated successfully.' })
          : t('brandingSettings.toast.created', { defaultValue: 'Subscription branding profile created successfully.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('brandingSettings.toast.saveFailed', { defaultValue: 'Failed to save branding' })
      );
    }
  });

  const toggleBranding = useMutation({
    mutationFn: async (branding: SubscriptionBranding) => {
      await apiClient.put(`/settings/subscription-branding/${branding.id}`, {
        enabled: !branding.enabled
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('brandingSettings.toast.statusUpdated', { defaultValue: 'Branding status updated.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('brandingSettings.toast.statusUpdateFailed', { defaultValue: 'Failed to update branding status' })
      );
    }
  });

  const deleteBranding = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/settings/subscription-branding/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('brandingSettings.toast.deleted', { defaultValue: 'Branding profile deleted.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('brandingSettings.toast.deleteFailed', { defaultValue: 'Failed to delete branding' })
      );
    }
  });

  return (
    <div className="space-y-6">
      <Card className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Subscription Branding</h3>
            <p className="mt-1 text-sm text-muted">
              Customize subscription profile identity by scope (GLOBAL, GROUP, USER).
            </p>
          </div>
          {isEditing ? (
            <Button variant="secondary" onClick={resetForm}>
              <X className="mr-2 h-4 w-4" />
              Cancel edit
            </Button>
          ) : null}
        </div>

        <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div
              className="relative overflow-hidden rounded-2xl border border-line/70 p-5 lg:col-span-2"
              style={{
                backgroundImage: `linear-gradient(135deg, ${previewPrimary}26 0%, ${previewAccent}2f 100%)`
              }}
            >
              <div className="mb-2 inline-flex items-center rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-xs font-medium text-muted">
                Preview
              </div>
              <h4 className="text-xl font-semibold text-foreground">
                {profileTitle?.trim() || `${appName?.trim() || 'One-UI'} Subscription`}
              </h4>
              <p className="mt-2 max-w-2xl text-sm text-muted">
                {profileDescription?.trim() || 'Managed by One-UI'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-foreground">
                  {appName?.trim() || 'One-UI'}
                </span>
                {supportUrl?.trim() ? (
                  <span className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-muted">
                    Support: {supportUrl.trim()}
                  </span>
                ) : null}
                {customFooter?.trim() ? (
                  <span className="rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-muted">
                    {customFooter.trim()}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-line/70 bg-card/65 p-4">
              <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-brand-500" />
                Active Configuration
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-lg border border-line/70 bg-panel/55 px-3 py-2">
                  <span className="text-muted">Scope</span>
                  <span className="font-semibold text-foreground">{scope}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-line/70 bg-panel/55 px-3 py-2">
                  <span className="text-muted">Priority</span>
                  <span className="font-semibold text-foreground">{priority}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-line/70 bg-panel/55 px-3 py-2">
                  <span className="text-muted">Visible apps</span>
                  <span className="font-semibold text-foreground">{selectedAppsCount}</span>
                </div>
                {scope === 'USER' && userId ? (
                  <div className="rounded-lg border border-line/70 bg-panel/55 px-3 py-2 text-muted">
                    User target: <span className="font-semibold text-foreground">#{userId}</span>
                  </div>
                ) : null}
                {scope === 'GROUP' && groupId ? (
                  <div className="rounded-lg border border-line/70 bg-panel/55 px-3 py-2 text-muted">
                    Group target: <span className="font-semibold text-foreground">#{groupId}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-line/70 bg-card/65 p-4">
            <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Palette className="h-4 w-4 text-brand-500" />
              Quick Color Presets
            </div>
            <div className="flex flex-wrap gap-2">
              {BRANDING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setPrimaryColor(preset.primary);
                    setAccentColor(preset.accent);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-line/70 bg-panel/55 px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-brand-500/45 hover:bg-card"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full border border-white/25" style={{ backgroundColor: preset.primary }} />
                    <span className="h-3 w-3 rounded-full border border-white/25" style={{ backgroundColor: preset.accent }} />
                  </span>
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 xl:col-span-8">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Identity & Copy</h4>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Default branding" />
              <div>
                <label className="mb-2 block text-sm font-medium text-muted">Scope</label>
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as 'GLOBAL' | 'GROUP' | 'USER')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                >
                  <option value="GLOBAL">GLOBAL</option>
                  <option value="GROUP">GROUP</option>
                  <option value="USER">USER</option>
                </select>
              </div>
              <Input label="App Name" value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="One-UI" />
              <Input label="Clash Profile Name" value={clashProfileName} onChange={(event) => setClashProfileName(event.target.value)} placeholder="One-UI" />
              <Input label="Profile Title" value={profileTitle} onChange={(event) => setProfileTitle(event.target.value)} placeholder="One-UI Subscription" />
              <Input label="Profile Description" value={profileDescription} onChange={(event) => setProfileDescription(event.target.value)} placeholder="Managed by One-UI" />
              <Input label="Custom Footer" value={customFooter} onChange={(event) => setCustomFooter(event.target.value)} placeholder="Powered by One-UI" />
              <Input label="Priority" type="number" value={String(priority)} onChange={(event) => setPriority(Number.parseInt(event.target.value || '100', 10))} />
              {scope === 'USER' ? (
                <Input label="User ID" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="1" />
              ) : null}
              {scope === 'GROUP' ? (
                <Input label="Group ID" value={groupId} onChange={(event) => setGroupId(event.target.value)} placeholder="1" />
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 xl:col-span-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Visual Theme</h4>
            <div className="space-y-3">
              <Input label="Logo URL" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://..." />
              <Input label="Support URL" value={supportUrl} onChange={(event) => setSupportUrl(event.target.value)} placeholder="https://your.domain/support" />

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Primary Color</label>
                <div className="flex items-center gap-2">
                  <span
                    className="h-10 w-10 shrink-0 rounded-lg border border-line/70"
                    style={{ backgroundColor: previewPrimary }}
                  />
                  <input
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    placeholder="#3b82f6"
                    className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                  />
                  <input
                    type="color"
                    value={previewPrimary}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    className="h-10 w-10 cursor-pointer rounded-lg border border-line/70 bg-card p-1"
                    aria-label="Pick primary color"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Accent Color</label>
                <div className="flex items-center gap-2">
                  <span
                    className="h-10 w-10 shrink-0 rounded-lg border border-line/70"
                    style={{ backgroundColor: previewAccent }}
                  />
                  <input
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    placeholder="#6366f1"
                    className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                  />
                  <input
                    type="color"
                    value={previewAccent}
                    onChange={(event) => setAccentColor(event.target.value)}
                    className="h-10 w-10 cursor-pointer rounded-lg border border-line/70 bg-card p-1"
                    aria-label="Pick accent color"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 xl:col-span-2">
            <h4 className="text-sm font-semibold text-foreground">Enabled Apps</h4>
            <p className="mt-1 text-xs text-muted">Choose which one-click import tiles appear on the subscription page.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(['android', 'ios', 'windows'] as const).map((platformKey) => (
                <div key={platformKey} className="rounded-2xl border border-line/70 bg-card/65 p-4">
                  <p className="text-sm font-semibold text-foreground capitalize">{platformKey}</p>
                  <div className="mt-3 space-y-2">
                    {groupedApps[platformKey].map((app) => {
                      const checked = enabledApps.includes(app.id);
                      return (
                        <label key={app.id} className="flex cursor-pointer items-start gap-2 text-sm text-muted">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-line/70 bg-card text-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                            checked={checked}
                            onChange={() => {
                              setEnabledApps((prev) => {
                                if (prev.includes(app.id)) {
                                  return prev.filter((id) => id !== app.id);
                                }
                                return [...prev, app.id];
                              });
                            }}
                          />
                          <span className="min-w-0">
                            <span className="font-semibold text-foreground">{app.icon} {app.name}</span>
                            <span className="mt-0.5 block text-xs text-muted">{app.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Tip: If you leave this empty, all built-in apps will show by default.
            </p>
          </div>

          <div className="rounded-2xl border border-line/70 bg-panel/55 p-4">
            <h4 className="text-sm font-semibold text-foreground">QR & Usage Alerts</h4>
            <p className="mt-1 text-xs text-muted">Tune QR logo size and when users see data usage warnings.</p>
            <div className="mt-4 space-y-3">
              <Input
                label="QR Logo Size (%)"
                value={qrLogoSizePercent}
                onChange={(event) => setQrLogoSizePercent(event.target.value)}
                placeholder="22"
              />
              <Input
                label="Usage Alert Thresholds (%)"
                value={usageAlertThresholds}
                onChange={(event) => setUsageAlertThresholds(event.target.value)}
                placeholder="80,90,95"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-line/70 bg-panel/55 p-4">
          <h4 className="text-sm font-semibold text-foreground">Custom Apps (JSON)</h4>
          <p className="mt-1 text-xs text-muted">
            Advanced: define extra client tiles. Provide an array of objects with
            fields: <code className="font-mono">id,name,icon,platforms,usesFormat,urlScheme,storeUrl</code>.
          </p>
          <textarea
            value={customAppsJson}
            onChange={(event) => setCustomAppsJson(event.target.value)}
            rows={8}
            className="mt-3 w-full rounded-2xl border border-line/80 bg-card/75 px-4 py-3 font-mono text-xs text-foreground outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-line/70 pt-4 sm:flex-row sm:items-center">
          <Button onClick={() => saveBranding.mutate()} loading={saveBranding.isPending} disabled={!name.trim()}>
            {isEditing ? 'Save Changes' : 'Create Branding'}
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setPrimaryColor('#3b82f6');
              setAccentColor('#6366f1');
            }}
          >
            Reset Colors
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-foreground">Branding Profiles</h3>
        <div className="overflow-x-auto rounded-2xl border border-line/70">
          <table className="min-w-full divide-y divide-line/70">
            <thead className="bg-panel/60">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Scope</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">App Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Priority</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Enabled</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 bg-card/60">
              {(brandingQuery.data || []).map((branding) => (
                <tr key={branding.id}>
                  <td className="px-3 py-2 text-sm text-foreground">{branding.name}</td>
                  <td className="px-3 py-2 text-sm text-muted">
                    {branding.scope}
                    {branding.scope === 'USER' && branding.userId ? ` #${branding.userId}` : ''}
                    {branding.scope === 'GROUP' && branding.groupId ? ` #${branding.groupId}` : ''}
                  </td>
                  <td className="px-3 py-2 text-sm text-muted">{branding.appName || 'One-UI'}</td>
                  <td className="px-3 py-2 text-sm text-muted">{branding.priority}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleBranding.mutate(branding)}
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium transition ${
                        branding.enabled
                          ? 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                          : 'border border-line/70 bg-card/60 text-muted'
                      }`}
                    >
                      {branding.enabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => loadForEdit(branding)}
                        className="rounded-lg p-2 text-muted hover:bg-card/70 hover:text-foreground"
                        aria-label={`Edit ${branding.name}`}
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteBranding.mutate(branding.id)}
                        className="rounded-lg p-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                        aria-label={`Delete ${branding.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!brandingQuery.isLoading && (brandingQuery.data || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-muted">
                    No branding profile configured
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default BrandingSettings;
