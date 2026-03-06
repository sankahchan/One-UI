import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Download, Edit, Image, Palette, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';
import { BUILTIN_CLIENT_APPS, type FormatTab, type Platform } from '../../lib/subscriptionApps';

interface SubscriptionBranding {
  id: number;
  scope: 'GLOBAL' | 'GROUP' | 'USER';
  enabled: boolean;
  isPublished?: boolean;
  publishedAt?: string | null;
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
  user?: {
    id: number;
    email?: string | null;
  } | null;
  group?: {
    id: number;
    name?: string | null;
  } | null;
}

type LookupUser = {
  id: number;
  email?: string | null;
};

type LookupGroup = {
  id: number;
  name?: string | null;
};

type BrandingMetadataDraft = {
  enabledApps?: string[];
  customApps?: unknown[];
  qrLogoSizePercent?: number;
  usageAlertThresholds?: number[];
  wallpaperUrl?: string;
  wallpaperOverlayOpacity?: number;
  wallpaperBlurPx?: number;
  wallpaperPositionX?: number;
  wallpaperPositionY?: number;
  wallpaperGradientFrom?: string;
  wallpaperGradientTo?: string;
  wallpaperGradientOpacity?: number;
};

const BRANDING_PRESETS = [
  { id: 'aurora', name: 'Aurora', primary: '#3b82f6', accent: '#6366f1' },
  { id: 'emerald', name: 'Emerald', primary: '#10b981', accent: '#14b8a6' },
  { id: 'sunset', name: 'Sunset', primary: '#f97316', accent: '#ef4444' },
  { id: 'rose', name: 'Rose', primary: '#ec4899', accent: '#a855f7' }
] as const;

const VALID_CUSTOM_APP_PLATFORMS = ['android', 'ios', 'windows'] as const;
const VALID_CUSTOM_APP_FORMATS = ['v2ray', 'clash', 'singbox', 'wireguard', 'mieru'] as const;

type CustomAppDraft = {
  id?: string;
  name?: string;
  icon?: string;
  platforms?: Platform[];
  description?: string;
  usesFormat?: FormatTab;
  urlScheme?: string;
  storeUrl?: Partial<Record<Platform, string>>;
};

type CustomAppsValidation = {
  parsed: CustomAppDraft[];
  errors: string[];
  warnings: string[];
  stats: {
    total: number;
    deepLink: number;
    manualOnly: number;
  };
};

const CUSTOM_APPS_TEMPLATE: CustomAppDraft[] = [
  {
    id: 'desktop_manual_example',
    name: 'Desktop Manual Client',
    icon: '🖥️',
    platforms: ['windows'],
    description: 'Manual import only. Users copy the subscription URL into the app.',
    usesFormat: 'mieru',
    storeUrl: {
      windows: 'https://example.com/download'
    }
  },
  {
    id: 'android_deeplink_example',
    name: 'Android Deep Link Client',
    icon: '📱',
    platforms: ['android'],
    description: 'Supports one-tap subscription import.',
    usesFormat: 'v2ray',
    urlScheme: 'myapp://install-sub?url={url}',
    storeUrl: {
      android: 'https://play.google.com/store/apps/details?id=com.example.myapp'
    }
  }
];

const CUSTOM_APPS_STARTER_PACK: CustomAppDraft[] = [
  {
    id: 'custom_desktop_client',
    name: 'Custom Desktop Client',
    icon: '🖥️',
    platforms: ['windows'],
    description: 'Manual import desktop client.',
    usesFormat: 'mieru',
    storeUrl: {
      windows: 'https://example.com/custom-desktop-client'
    }
  },
  {
    id: 'custom_android_client',
    name: 'Custom Android Client',
    icon: '🤖',
    platforms: ['android'],
    description: 'Android client with one-tap import.',
    usesFormat: 'v2ray',
    urlScheme: 'customclient://install-sub?url={url}',
    storeUrl: {
      android: 'https://play.google.com/store/apps/details?id=com.example.customclient'
    }
  },
  {
    id: 'custom_ios_client',
    name: 'Custom iOS Client',
    icon: '🍎',
    platforms: ['ios'],
    description: 'iOS client using a raw-path import scheme.',
    usesFormat: 'singbox',
    urlScheme: 'customios://import/{rawUrl}',
    storeUrl: {
      ios: 'https://apps.apple.com/app/id1234567890'
    }
  }
];

const MAX_WALLPAPER_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_WALLPAPER_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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

function parseOptionalHexColor(value: string | null | undefined): string | null {
  const input = String(value || '').trim();
  if (!input) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(input)) return input;
  if (/^[0-9a-fA-F]{6}$/.test(input)) return `#${input}`;
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHexColor(hex, '#3b82f6').replace('#', '');
  const intValue = Number.parseInt(normalized, 16);
  const r = (intValue >> 16) & 255;
  const g = (intValue >> 8) & 255;
  const b = intValue & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(Math.max(alpha, 0), 1)})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(hex, '#3b82f6').replace('#', '');
  const intValue = Number.parseInt(normalized, 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255
  };
}

function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const rLinear = srgbChannelToLinear(r);
  const gLinear = srgbChannelToLinear(g);
  const bLinear = srgbChannelToLinear(b);
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

function contrastRatio(colorA: string, colorB: string): number {
  const l1 = relativeLuminance(colorA);
  const l2 = relativeLuminance(colorB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
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

function validateCustomAppsJson(value: string): CustomAppsValidation {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      parsed: [],
      errors: [],
      warnings: [],
      stats: { total: 0, deepLink: 0, manualOnly: 0 }
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(trimmed);
  } catch (error: any) {
    return {
      parsed: [],
      errors: [error?.message || 'Custom apps JSON is invalid.'],
      warnings: [],
      stats: { total: 0, deepLink: 0, manualOnly: 0 }
    };
  }

  if (!Array.isArray(parsedUnknown)) {
    return {
      parsed: [],
      errors: ['Custom apps JSON must be an array of app objects.'],
      warnings: [],
      stats: { total: 0, deepLink: 0, manualOnly: 0 }
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = parsedUnknown as CustomAppDraft[];
  const idMap = new Map<string, number>();
  let deepLink = 0;
  let manualOnly = 0;

  parsed.forEach((entry, index) => {
    const prefix = `App ${index + 1}`;

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${prefix}: must be an object.`);
      return;
    }

    const id = String(entry.id || '').trim();
    const name = String(entry.name || '').trim();
    const icon = String(entry.icon || '').trim();
    const platforms = Array.isArray(entry.platforms)
      ? entry.platforms.map((platform) => String(platform || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const usesFormat = String(entry.usesFormat || '').trim().toLowerCase();
    const urlScheme = String(entry.urlScheme || '').trim();

    if (!id) {
      errors.push(`${prefix}: "id" is required.`);
    } else if (idMap.has(id)) {
      errors.push(`${prefix}: duplicate id "${id}" (already used by app ${idMap.get(id)}).`);
    } else {
      idMap.set(id, index + 1);
    }

    if (!name) {
      errors.push(`${prefix}: "name" is required.`);
    }

    if (!icon) {
      warnings.push(`${prefix}: "icon" is empty. A fallback icon will be used.`);
    }

    if (platforms.length === 0) {
      errors.push(`${prefix}: "platforms" must include at least one of android, ios, windows.`);
    } else {
      const invalidPlatforms = platforms.filter(
        (platform) => !VALID_CUSTOM_APP_PLATFORMS.includes(platform as Platform)
      );
      if (invalidPlatforms.length > 0) {
        errors.push(`${prefix}: invalid platforms ${invalidPlatforms.join(', ')}.`);
      }
    }

    if (usesFormat && !VALID_CUSTOM_APP_FORMATS.includes(usesFormat as FormatTab)) {
      errors.push(`${prefix}: invalid usesFormat "${usesFormat}".`);
    }

    if (urlScheme) {
      deepLink += 1;
      if (!urlScheme.includes('{url}') && !urlScheme.includes('{rawUrl}')) {
        errors.push(`${prefix}: "urlScheme" must include {url} or {rawUrl}.`);
      }
    } else {
      manualOnly += 1;
    }

    let hasStoreLink = false;
    if (entry.storeUrl !== undefined) {
      if (!entry.storeUrl || typeof entry.storeUrl !== 'object' || Array.isArray(entry.storeUrl)) {
        errors.push(`${prefix}: "storeUrl" must be an object keyed by platform.`);
      } else {
        const storeEntries = Object.entries(entry.storeUrl);
        hasStoreLink = storeEntries.some(([, link]) => String(link || '').trim().length > 0);
        const invalidKeys = storeEntries
          .map(([key]) => key)
          .filter((key) => !VALID_CUSTOM_APP_PLATFORMS.includes(key as Platform));

        if (invalidKeys.length > 0) {
          errors.push(`${prefix}: invalid storeUrl keys ${invalidKeys.join(', ')}.`);
        }

        for (const [key, link] of storeEntries) {
          const linkValue = String(link || '').trim();
          if (!linkValue) {
            errors.push(`${prefix}: storeUrl.${key} must be a non-empty string.`);
            continue;
          }
          if (!/^https?:\/\//i.test(linkValue)) {
            warnings.push(`${prefix}: storeUrl.${key} should usually be an https:// link.`);
          }
        }
      }
    }

    if (!urlScheme && !hasStoreLink) {
      warnings.push(`${prefix}: manual-only app has no storeUrl. Users will only see a Copy URL action.`);
    }
  });

  return {
    parsed,
    errors,
    warnings,
    stats: {
      total: parsed.length,
      deepLink,
      manualOnly
    }
  };
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
  const [isPublished, setIsPublished] = useState(false);
  const [userId, setUserId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [importMode, setImportMode] = useState<'MERGE' | 'REPLACE'>('MERGE');
  const [priority, setPriority] = useState(100);
  const [enabledApps, setEnabledApps] = useState<string[]>([]);
  const [qrLogoSizePercent, setQrLogoSizePercent] = useState<string>('');
  const [usageAlertThresholds, setUsageAlertThresholds] = useState<string>('80,90,95');
  const [wallpaperUrl, setWallpaperUrl] = useState<string>('');
  const [wallpaperOverlayOpacity, setWallpaperOverlayOpacity] = useState<string>('62');
  const [wallpaperBlurPx, setWallpaperBlurPx] = useState<string>('0');
  const [wallpaperPositionX, setWallpaperPositionX] = useState<string>('50');
  const [wallpaperPositionY, setWallpaperPositionY] = useState<string>('50');
  const [wallpaperGradientFrom, setWallpaperGradientFrom] = useState<string>('');
  const [wallpaperGradientTo, setWallpaperGradientTo] = useState<string>('');
  const [wallpaperGradientOpacity, setWallpaperGradientOpacity] = useState<string>('62');
  const [wallpaperFile, setWallpaperFile] = useState<File | null>(null);
  const [wallpaperFilePreviewUrl, setWallpaperFilePreviewUrl] = useState<string>('');
  const [wallpaperFileError, setWallpaperFileError] = useState<string>('');
  const [isFocalDragging, setIsFocalDragging] = useState(false);
  const [customAppsJson, setCustomAppsJson] = useState<string>('[]');
  const previewFocalRef = useRef<HTMLDivElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const brandingQuery = useQuery({
    queryKey: ['subscription-branding'],
    queryFn: async () => {
      const response = await apiClient.get('/settings/subscription-branding');
      return (response.data?.brandings || []) as SubscriptionBranding[];
    }
  });

  const userLookupQuery = useQuery({
    queryKey: ['branding-user-lookup', userSearch],
    enabled: scope === 'USER',
    staleTime: 30_000,
    queryFn: async () => {
      const response = await apiClient.get('/users', {
        params: {
          page: 1,
          limit: 20,
          search: userSearch || undefined
        }
      });
      const payload = (response as any)?.data;
      if (Array.isArray(payload)) {
        return payload as LookupUser[];
      }
      if (Array.isArray(payload?.data)) {
        return payload.data as LookupUser[];
      }
      return [];
    }
  });

  const groupLookupQuery = useQuery({
    queryKey: ['branding-group-lookup', groupSearch],
    enabled: scope === 'GROUP',
    staleTime: 30_000,
    queryFn: async () => {
      const response = await apiClient.get('/groups', {
        params: {
          page: 1,
          limit: 20,
          search: groupSearch || undefined
        }
      });
      const payload = (response as any)?.data;
      if (Array.isArray(payload)) {
        return payload as LookupGroup[];
      }
      if (Array.isArray(payload?.data)) {
        return payload.data as LookupGroup[];
      }
      return [];
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
  const allBuiltInAppIds = useMemo(
    () => Array.from(new Set(BUILTIN_CLIENT_APPS.map((app) => app.id))),
    []
  );
  const customAppsValidation = useMemo(
    () => validateCustomAppsJson(customAppsJson),
    [customAppsJson]
  );

  const previewPrimary = useMemo(
    () => normalizeHexColor(primaryColor, '#3b82f6'),
    [primaryColor]
  );
  const previewAccent = useMemo(
    () => normalizeHexColor(accentColor, '#6366f1'),
    [accentColor]
  );
  const previewWallpaperUrl = useMemo(() => {
    const trimmed = wallpaperUrl.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
  }, [wallpaperUrl]);
  const previewWallpaperImageUrl = wallpaperFilePreviewUrl || previewWallpaperUrl;
  const previewWallpaperOverlay = useMemo(() => {
    const value = Number(wallpaperOverlayOpacity);
    if (!Number.isFinite(value)) return 62;
    return Math.min(Math.max(value, 10), 90);
  }, [wallpaperOverlayOpacity]);
  const previewWallpaperPositionX = useMemo(() => {
    const value = Number(wallpaperPositionX);
    if (!Number.isFinite(value)) return 50;
    return Math.min(Math.max(value, 0), 100);
  }, [wallpaperPositionX]);
  const previewWallpaperPositionY = useMemo(() => {
    const value = Number(wallpaperPositionY);
    if (!Number.isFinite(value)) return 50;
    return Math.min(Math.max(value, 0), 100);
  }, [wallpaperPositionY]);
  const previewGradientFrom = useMemo(
    () => normalizeHexColor(wallpaperGradientFrom, previewPrimary),
    [previewPrimary, wallpaperGradientFrom]
  );
  const previewGradientTo = useMemo(
    () => normalizeHexColor(wallpaperGradientTo, previewAccent),
    [previewAccent, wallpaperGradientTo]
  );
  const previewGradientOpacity = useMemo(() => {
    const value = Number(wallpaperGradientOpacity);
    if (!Number.isFinite(value)) return 62;
    return Math.min(Math.max(value, 0), 100);
  }, [wallpaperGradientOpacity]);
  const previewHasWallpaper = Boolean(previewWallpaperImageUrl);
  const selectedAppsCount = enabledApps.length > 0 ? enabledApps.length : BUILTIN_CLIENT_APPS.length;
  const contrastChecks = useMemo(() => {
    const lightSurface = '#ffffff';
    const darkSurface = '#0f172a';
    const lightText = '#ffffff';
    const darkText = '#0f172a';

    const pickReadableText = (background: string) =>
      contrastRatio(lightText, background) >= contrastRatio(darkText, background) ? lightText : darkText;

    const onPrimary = pickReadableText(previewPrimary);
    const onAccent = pickReadableText(previewAccent);
    const onGradientCandidate =
      Math.min(contrastRatio(lightText, previewGradientFrom), contrastRatio(lightText, previewGradientTo)) >=
      Math.min(contrastRatio(darkText, previewGradientFrom), contrastRatio(darkText, previewGradientTo))
        ? lightText
        : darkText;

    const gradientRatio = Math.min(
      contrastRatio(onGradientCandidate, previewGradientFrom),
      contrastRatio(onGradientCandidate, previewGradientTo)
    );

    return [
      {
        id: 'primary-text-light',
        label: 'Primary text on light surface',
        ratio: contrastRatio(previewPrimary, lightSurface),
        foreground: previewPrimary,
        background: lightSurface
      },
      {
        id: 'accent-text-light',
        label: 'Accent text on light surface',
        ratio: contrastRatio(previewAccent, lightSurface),
        foreground: previewAccent,
        background: lightSurface
      },
      {
        id: 'on-primary',
        label: 'Button text on primary color',
        ratio: contrastRatio(onPrimary, previewPrimary),
        foreground: onPrimary,
        background: previewPrimary
      },
      {
        id: 'on-accent',
        label: 'Button text on accent color',
        ratio: contrastRatio(onAccent, previewAccent),
        foreground: onAccent,
        background: previewAccent
      },
      {
        id: 'gradient-title',
        label: 'Title text on gradient header',
        ratio: gradientRatio,
        foreground: onGradientCandidate,
        background: previewGradientFrom
      },
      {
        id: 'primary-text-dark',
        label: 'Primary text on dark surface',
        ratio: contrastRatio(previewPrimary, darkSurface),
        foreground: previewPrimary,
        background: darkSurface
      }
    ];
  }, [previewAccent, previewGradientFrom, previewGradientTo, previewPrimary]);

  useEffect(() => {
    if (!wallpaperFilePreviewUrl.startsWith('blob:')) {
      return undefined;
    }
    return () => {
      URL.revokeObjectURL(wallpaperFilePreviewUrl);
    };
  }, [wallpaperFilePreviewUrl]);

  const updateWallpaperFocalFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = previewFocalRef.current || event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);

    const nextX = Math.round((offsetX / rect.width) * 100);
    const nextY = Math.round((offsetY / rect.height) * 100);

    setWallpaperPositionX(String(nextX));
    setWallpaperPositionY(String(nextY));
  };

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
    setIsPublished(false);
    setUserId('');
    setGroupId('');
    setUserSearch('');
    setGroupSearch('');
    setPriority(100);
    setEnabledApps([]);
    setQrLogoSizePercent('');
    setUsageAlertThresholds('80,90,95');
    setWallpaperUrl('');
    setWallpaperOverlayOpacity('62');
    setWallpaperBlurPx('0');
    setWallpaperPositionX('50');
    setWallpaperPositionY('50');
    setWallpaperGradientFrom('');
    setWallpaperGradientTo('');
    setWallpaperGradientOpacity('62');
    setWallpaperFile(null);
    setWallpaperFilePreviewUrl('');
    setWallpaperFileError('');
    setCustomAppsJson('[]');
  };

  const loadCustomAppsPreset = (preset: CustomAppDraft[]) => {
    setCustomAppsJson(stringifyJson(preset));
  };

  const formatCustomApps = () => {
    const nextValidation = validateCustomAppsJson(customAppsJson);
    if (nextValidation.errors.length > 0) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        nextValidation.errors[0]
      );
      return;
    }
    setCustomAppsJson(stringifyJson(nextValidation.parsed));
  };

  const copyCustomAppsExample = async () => {
    const payload = stringifyJson(CUSTOM_APPS_TEMPLATE);
    try {
      await navigator.clipboard.writeText(payload);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        'Custom app example copied.'
      );
    } catch {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        'Unable to copy the example JSON.'
      );
    }
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
    setIsPublished(Boolean(branding.isPublished));
    setUserId(branding.userId ? String(branding.userId) : '');
    setGroupId(branding.groupId ? String(branding.groupId) : '');
    setUserSearch(branding.user?.email || (branding.userId ? `#${branding.userId}` : ''));
    setGroupSearch(branding.group?.name || (branding.groupId ? `#${branding.groupId}` : ''));
    setPriority(Number.isInteger(branding.priority) ? branding.priority : 100);

    const metadata = branding.metadata && typeof branding.metadata === 'object' ? (branding.metadata as any) : {};
    setEnabledApps(Array.isArray(metadata.enabledApps) ? metadata.enabledApps.map(String) : []);
    setQrLogoSizePercent(metadata.qrLogoSizePercent !== undefined ? String(metadata.qrLogoSizePercent) : '');
    setUsageAlertThresholds(
      Array.isArray(metadata.usageAlertThresholds)
        ? metadata.usageAlertThresholds.map((v: any) => String(v)).join(',')
        : '80,90,95'
    );
    setWallpaperUrl(typeof metadata.wallpaperUrl === 'string' ? metadata.wallpaperUrl : '');
    setWallpaperOverlayOpacity(
      metadata.wallpaperOverlayOpacity !== undefined ? String(metadata.wallpaperOverlayOpacity) : '62'
    );
    setWallpaperBlurPx(metadata.wallpaperBlurPx !== undefined ? String(metadata.wallpaperBlurPx) : '0');
    setWallpaperPositionX(metadata.wallpaperPositionX !== undefined ? String(metadata.wallpaperPositionX) : '50');
    setWallpaperPositionY(metadata.wallpaperPositionY !== undefined ? String(metadata.wallpaperPositionY) : '50');
    setWallpaperGradientFrom(typeof metadata.wallpaperGradientFrom === 'string' ? metadata.wallpaperGradientFrom : '');
    setWallpaperGradientTo(typeof metadata.wallpaperGradientTo === 'string' ? metadata.wallpaperGradientTo : '');
    setWallpaperGradientOpacity(
      metadata.wallpaperGradientOpacity !== undefined ? String(metadata.wallpaperGradientOpacity) : '62'
    );
    setWallpaperFile(null);
    setWallpaperFilePreviewUrl('');
    setWallpaperFileError('');
    setCustomAppsJson(stringifyJson(metadata.customApps || []));
  };

  const uploadWallpaper = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('wallpaper', file);
      const response = await apiClient.post('/settings/subscription-branding/upload-wallpaper', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      return response.data as { wallpaperUrl?: string };
    },
    onSuccess: (payload) => {
      if (!payload?.wallpaperUrl) {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          t('brandingSettings.toast.uploadFailed', { defaultValue: 'Wallpaper upload failed.' })
        );
        return;
      }
      setWallpaperUrl(payload.wallpaperUrl);
      setWallpaperFile(null);
      setWallpaperFilePreviewUrl('');
      setWallpaperFileError('');
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('brandingSettings.toast.uploaded', { defaultValue: 'Wallpaper uploaded successfully.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('brandingSettings.toast.uploadFailed', { defaultValue: 'Wallpaper upload failed.' })
      );
    }
  });

  const handleWallpaperFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';

    if (!file) {
      setWallpaperFile(null);
      setWallpaperFilePreviewUrl('');
      setWallpaperFileError('');
      return;
    }

    if (!ALLOWED_WALLPAPER_MIME.includes(file.type)) {
      setWallpaperFile(null);
      setWallpaperFilePreviewUrl('');
      setWallpaperFileError(
        t('brandingSettings.toast.invalidWallpaperType', {
          defaultValue: 'Invalid file type. Allowed: JPG, PNG, WEBP, GIF.'
        })
      );
      return;
    }

    if (file.size > MAX_WALLPAPER_UPLOAD_BYTES) {
      setWallpaperFile(null);
      setWallpaperFilePreviewUrl('');
      setWallpaperFileError(
        t('brandingSettings.toast.invalidWallpaperSize', {
          defaultValue: 'Wallpaper must be 5 MB or smaller.'
        })
      );
      return;
    }

    setWallpaperFile(file);
    setWallpaperFileError('');
    setWallpaperFilePreviewUrl(URL.createObjectURL(file));
  };

  const handleImportFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) {
      return;
    }

    if (importMode === 'REPLACE') {
      const confirmed = window.confirm(
        t('brandingSettings.confirm.importReplace', {
          defaultValue: 'Replace mode will delete all existing branding profiles before import. Continue?'
        })
      );
      if (!confirmed) {
        return;
      }
    }

    importBrandings.mutate({ file, mode: importMode });
  };

  const saveBranding = useMutation({
    mutationFn: async () => {
      if (wallpaperFile) {
        throw new Error(
          t('brandingSettings.toast.uploadWallpaperFirst', {
            defaultValue: 'Please upload the selected wallpaper image before saving.'
          })
        );
      }

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
        isPublished,
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

      const trimmedWallpaperUrl = wallpaperUrl.trim();
      if (trimmedWallpaperUrl) {
        if (!/^https?:\/\//i.test(trimmedWallpaperUrl)) {
          toast.error(
            t('common.error', { defaultValue: 'Error' }),
            t('brandingSettings.toast.invalidWallpaperUrl', {
              defaultValue: 'Wallpaper URL must start with http:// or https://'
            })
          );
          throw new Error('Invalid wallpaper URL');
        }
        metadataDraft.wallpaperUrl = trimmedWallpaperUrl;
      }

      const overlayOpacity = Number(wallpaperOverlayOpacity);
      if (Number.isFinite(overlayOpacity)) {
        metadataDraft.wallpaperOverlayOpacity = Math.min(Math.max(overlayOpacity, 10), 90);
      }

      const blurPx = Number(wallpaperBlurPx);
      if (Number.isFinite(blurPx)) {
        metadataDraft.wallpaperBlurPx = Math.min(Math.max(blurPx, 0), 24);
      }

      const positionX = Number(wallpaperPositionX);
      if (Number.isFinite(positionX)) {
        metadataDraft.wallpaperPositionX = Math.min(Math.max(positionX, 0), 100);
      }

      const positionY = Number(wallpaperPositionY);
      if (Number.isFinite(positionY)) {
        metadataDraft.wallpaperPositionY = Math.min(Math.max(positionY, 0), 100);
      }

      const gradientFrom = parseOptionalHexColor(wallpaperGradientFrom);
      if (wallpaperGradientFrom.trim() && !gradientFrom) {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          t('brandingSettings.toast.invalidGradientColor', {
            defaultValue: 'Gradient colors must be valid HEX values (example: #22d3ee).'
          })
        );
        throw new Error('Invalid gradient start color');
      }
      if (gradientFrom) {
        metadataDraft.wallpaperGradientFrom = gradientFrom;
      }

      const gradientTo = parseOptionalHexColor(wallpaperGradientTo);
      if (wallpaperGradientTo.trim() && !gradientTo) {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          t('brandingSettings.toast.invalidGradientColor', {
            defaultValue: 'Gradient colors must be valid HEX values (example: #22d3ee).'
          })
        );
        throw new Error('Invalid gradient end color');
      }
      if (gradientTo) {
        metadataDraft.wallpaperGradientTo = gradientTo;
      }

      const gradientOpacity = Number(wallpaperGradientOpacity);
      if (Number.isFinite(gradientOpacity)) {
        metadataDraft.wallpaperGradientOpacity = Math.min(Math.max(gradientOpacity, 0), 100);
      }

      const parsedCustomApps = validateCustomAppsJson(customAppsJson);
      if (parsedCustomApps.errors.length > 0) {
        toast.error(
          t('common.error', { defaultValue: 'Error' }),
          parsedCustomApps.errors[0] || t('brandingSettings.toast.invalidJson', { defaultValue: 'Custom apps JSON is invalid.' })
        );
        throw new Error(parsedCustomApps.errors[0] || 'Invalid custom apps JSON');
      }
      metadataDraft.customApps = parsedCustomApps.parsed;

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

  const publishBranding = useMutation({
    mutationFn: async ({ brandingId, published }: { brandingId: number; published: boolean }) => {
      await apiClient.post(`/settings/subscription-branding/${brandingId}/publish`, {
        published
      });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        variables.published
          ? t('brandingSettings.toast.published', { defaultValue: 'Branding profile published.' })
          : t('brandingSettings.toast.draft', { defaultValue: 'Branding profile moved to draft.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('brandingSettings.toast.publishFailed', { defaultValue: 'Failed to update publish status' })
      );
    }
  });

  const exportBrandings = useMutation({
    mutationFn: async () => {
      const response = await apiClient.get('/settings/subscription-branding/export');
      return response.data?.data || response.data;
    },
    onSuccess: (payload) => {
      const fileName = `subscription-branding-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);

      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('brandingSettings.toast.exported', { defaultValue: 'Branding export downloaded.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('brandingSettings.toast.exportFailed', { defaultValue: 'Failed to export branding profiles.' })
      );
    }
  });

  const importBrandings = useMutation({
    mutationFn: async ({ file, mode }: { file: File; mode: 'MERGE' | 'REPLACE' }) => {
      const raw = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('Import file is not valid JSON.');
      }

      const brandings = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.brandings) ? parsed.brandings : null);
      if (!brandings || brandings.length === 0) {
        throw new Error('Import JSON must contain a non-empty "brandings" array.');
      }

      const response = await apiClient.post('/settings/subscription-branding/import', {
        mode,
        brandings
      });
      return response.data?.data || response.data;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['subscription-branding'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('brandingSettings.toast.imported', {
          defaultValue: 'Import completed. {{created}} created, {{updated}} updated.',
          created: result?.created ?? 0,
          updated: result?.updated ?? 0
        })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('brandingSettings.toast.importFailed', { defaultValue: 'Failed to import branding profiles.' })
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

  const brandingRows = brandingQuery.data || [];
  const saveDisabled =
    !name.trim()
    || uploadWallpaper.isPending
    || Boolean(wallpaperFile)
    || customAppsValidation.errors.length > 0
    || (scope === 'USER' && !userId.trim())
    || (scope === 'GROUP' && !groupId.trim());
  const saveButtonLabel = isEditing
    ? (isPublished ? 'Save & Keep Published' : 'Save Draft')
    : (isPublished ? 'Create & Publish' : 'Create Draft');
  const resetBrandingColors = () => {
    setPrimaryColor('#3b82f6');
    setAccentColor('#6366f1');
    setWallpaperGradientFrom('#3b82f6');
    setWallpaperGradientTo('#6366f1');
    setWallpaperGradientOpacity('62');
  };

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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <select
              value={importMode}
              onChange={(event) => setImportMode(event.target.value as 'MERGE' | 'REPLACE')}
              className="w-full rounded-xl border border-line/70 bg-card/70 px-3 py-2 text-xs font-medium text-foreground outline-none transition focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/35 sm:w-auto"
              aria-label="Import mode"
            >
              <option value="MERGE">Import Mode: Merge</option>
              <option value="REPLACE">Import Mode: Replace</option>
            </select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => importFileInputRef.current?.click()}
              loading={importBrandings.isPending}
              className="w-full sm:w-auto"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import JSON
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => exportBrandings.mutate()}
              loading={exportBrandings.isPending}
              className="w-full sm:w-auto"
            >
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
            {isEditing ? (
              <Button variant="secondary" onClick={resetForm} className="w-full sm:w-auto">
                <X className="mr-2 h-4 w-4" />
                Cancel edit
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={importFileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleImportFileSelect}
        />

        <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div
              className="relative overflow-hidden rounded-2xl border border-line/70 p-5 lg:col-span-2"
              style={{
                backgroundImage: previewHasWallpaper
                  ? `url(${previewWallpaperImageUrl})`
                  : `linear-gradient(135deg, ${hexToRgba(previewGradientFrom, 0.25)} 0%, ${hexToRgba(previewGradientTo, 0.35)} 100%)`,
                backgroundSize: 'cover',
                backgroundPosition: `${previewWallpaperPositionX}% ${previewWallpaperPositionY}%`
              }}
            >
              {previewHasWallpaper ? (
                <div
                  ref={previewFocalRef}
                  className="absolute inset-0 z-20 cursor-crosshair touch-none"
                  aria-label="Wallpaper focal position selector"
                  onPointerDown={(event) => {
                    setIsFocalDragging(true);
                    updateWallpaperFocalFromPointer(event);
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!isFocalDragging) return;
                    updateWallpaperFocalFromPointer(event);
                  }}
                  onPointerUp={(event) => {
                    setIsFocalDragging(false);
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                  onPointerCancel={(event) => {
                    setIsFocalDragging(false);
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                />
              ) : null}
              {previewHasWallpaper ? (
                <div
                  className="pointer-events-none absolute z-20"
                  style={{
                    left: `${previewWallpaperPositionX}%`,
                    top: `${previewWallpaperPositionY}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-black/35 text-[10px] font-semibold text-white shadow-lg">
                    ✚
                  </div>
                </div>
              ) : null}
              {previewHasWallpaper ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${hexToRgba(previewGradientFrom, previewGradientOpacity / 100)} 0%, ${hexToRgba(previewGradientTo, previewGradientOpacity / 100)} 100%)`
                  }}
                />
              ) : null}
              {previewHasWallpaper ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ backgroundColor: `rgba(2, 6, 23, ${previewWallpaperOverlay / 100})` }}
                />
              ) : null}
              <div className="relative z-10 mb-2 inline-flex items-center rounded-full border border-line/70 bg-card/70 px-2.5 py-1 text-xs font-medium text-muted">
                Preview {previewHasWallpaper ? '- Wallpaper' : ''}
              </div>
              <h4 className={`relative z-10 text-xl font-semibold ${previewHasWallpaper ? 'text-white' : 'text-foreground'}`}>
                {profileTitle?.trim() || `${appName?.trim() || 'One-UI'} Subscription`}
              </h4>
              <p className={`relative z-10 mt-2 max-w-2xl text-sm ${previewHasWallpaper ? 'text-slate-100/90' : 'text-muted'}`}>
                {profileDescription?.trim() || 'Managed by One-UI'}
              </p>
              <div className="relative z-10 mt-4 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full border border-line/70 bg-card/70 px-2.5 py-1 ${previewHasWallpaper ? 'text-white' : 'text-foreground'}`}>
                  {appName?.trim() || 'One-UI'}
                </span>
                {supportUrl?.trim() ? (
                  <span className={`rounded-full border border-line/70 bg-card/70 px-2.5 py-1 ${previewHasWallpaper ? 'text-slate-100/80' : 'text-muted'}`}>
                    Support: {supportUrl.trim()}
                  </span>
                ) : null}
                {customFooter?.trim() ? (
                  <span className={`rounded-full border border-line/70 bg-card/70 px-2.5 py-1 ${previewHasWallpaper ? 'text-slate-100/80' : 'text-muted'}`}>
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
                  <span className="text-muted">Publication</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    isPublished
                      ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                      : 'border-amber-500/35 bg-amber-500/15 text-amber-200'
                  }`}>
                    {isPublished ? 'Published' : 'Draft'}
                  </span>
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

        <div className="grid grid-cols-1 items-start gap-4">
          <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 xl:col-span-8">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Identity & Copy</h4>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Default branding" />
              <div>
                <label className="mb-2 block text-sm font-medium text-muted">Scope</label>
                <select
                  value={scope}
                  onChange={(event) => {
                    const nextScope = event.target.value as 'GLOBAL' | 'GROUP' | 'USER';
                    setScope(nextScope);
                    if (nextScope !== 'USER') {
                      setUserId('');
                      setUserSearch('');
                    }
                    if (nextScope !== 'GROUP') {
                      setGroupId('');
                      setGroupSearch('');
                    }
                  }}
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
              <div>
                <label className="mb-2 block text-sm font-medium text-muted">Publication</label>
                <select
                  value={isPublished ? 'PUBLISHED' : 'DRAFT'}
                  onChange={(event) => setIsPublished(event.target.value === 'PUBLISHED')}
                  className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                >
                  <option value="DRAFT">Draft (not live)</option>
                  <option value="PUBLISHED">Published (live)</option>
                </select>
              </div>
              {scope === 'USER' ? (
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-muted">User Target</label>
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search user by email"
                    className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                  />
                  <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-line/70 bg-card/60 p-2">
                    {userLookupQuery.isLoading ? (
                      <p className="px-2 py-1.5 text-xs text-muted">Searching users...</p>
                    ) : (userLookupQuery.data || []).length === 0 ? (
                      <p className="px-2 py-1.5 text-xs text-muted">No users found.</p>
                    ) : (
                      (userLookupQuery.data || []).map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => {
                            setUserId(String(user.id));
                            setUserSearch(user.email || `#${user.id}`);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                            userId === String(user.id)
                              ? 'bg-brand-500/15 text-foreground'
                              : 'text-muted hover:bg-panel/60 hover:text-foreground'
                          }`}
                        >
                          <span className="truncate">{user.email || `User #${user.id}`}</span>
                          <span className="ml-2 shrink-0 text-[11px] text-muted">#{user.id}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Selected user: {userId ? `#${userId}` : 'none'}
                  </p>
                </div>
              ) : null}
              {scope === 'GROUP' ? (
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-muted">Group Target</label>
                  <input
                    value={groupSearch}
                    onChange={(event) => setGroupSearch(event.target.value)}
                    placeholder="Search group by name"
                    className="w-full rounded-xl border border-line/80 bg-card/75 px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted focus-visible:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                  />
                  <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-line/70 bg-card/60 p-2">
                    {groupLookupQuery.isLoading ? (
                      <p className="px-2 py-1.5 text-xs text-muted">Searching groups...</p>
                    ) : (groupLookupQuery.data || []).length === 0 ? (
                      <p className="px-2 py-1.5 text-xs text-muted">No groups found.</p>
                    ) : (
                      (groupLookupQuery.data || []).map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => {
                            setGroupId(String(group.id));
                            setGroupSearch(group.name || `#${group.id}`);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                            groupId === String(group.id)
                              ? 'bg-brand-500/15 text-foreground'
                              : 'text-muted hover:bg-panel/60 hover:text-foreground'
                          }`}
                        >
                          <span className="truncate">{group.name || `Group #${group.id}`}</span>
                          <span className="ml-2 shrink-0 text-[11px] text-muted">#{group.id}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Selected group: {groupId ? `#${groupId}` : 'none'}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 xl:col-span-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Visual Theme</h4>
            <div className="space-y-3">
              <Input label="Logo URL" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://..." />
              <Input label="Support URL" value={supportUrl} onChange={(event) => setSupportUrl(event.target.value)} placeholder="https://your.domain/support" />

              <div className="rounded-xl border border-line/70 bg-card/55 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Image className="h-4 w-4 text-brand-500" />
                  Upload Wallpaper
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleWallpaperFileSelect}
                  className="w-full rounded-lg border border-line/70 bg-panel/60 px-3 py-2 text-xs text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-brand-500/20 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-100 hover:file:bg-brand-500/30"
                />
                <p className="mt-2 text-xs text-muted">
                  JPG, PNG, WEBP, GIF up to 5 MB.
                </p>
                {wallpaperFileError ? (
                  <p className="mt-2 text-xs text-rose-400">{wallpaperFileError}</p>
                ) : null}
                {wallpaperFile ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="rounded-full border border-line/70 bg-panel/55 px-2 py-1">
                      {wallpaperFile.name}
                    </span>
                    <span>{(wallpaperFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (wallpaperFile) {
                        uploadWallpaper.mutate(wallpaperFile);
                      }
                    }}
                    loading={uploadWallpaper.isPending}
                    disabled={!wallpaperFile}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload image
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setWallpaperFile(null);
                      setWallpaperFilePreviewUrl('');
                      setWallpaperFileError('');
                    }}
                    disabled={!wallpaperFile && !wallpaperFilePreviewUrl}
                  >
                    Clear selection
                  </Button>
                </div>
              </div>

              <Input
                label="Wallpaper URL"
                value={wallpaperUrl}
                onChange={(event) => setWallpaperUrl(event.target.value)}
                placeholder="https://images.unsplash.com/..."
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Wallpaper Overlay (%)"
                  type="number"
                  value={wallpaperOverlayOpacity}
                  onChange={(event) => setWallpaperOverlayOpacity(event.target.value)}
                  placeholder="62"
                />
                <Input
                  label="Wallpaper Blur (px)"
                  type="number"
                  value={wallpaperBlurPx}
                  onChange={(event) => setWallpaperBlurPx(event.target.value)}
                  placeholder="0"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Focal Position X (%)"
                  type="number"
                  value={wallpaperPositionX}
                  onChange={(event) => setWallpaperPositionX(event.target.value)}
                  placeholder="50"
                />
                <Input
                  label="Focal Position Y (%)"
                  type="number"
                  value={wallpaperPositionY}
                  onChange={(event) => setWallpaperPositionY(event.target.value)}
                  placeholder="50"
                />
              </div>

              <p className="text-xs text-muted">
                Tip: Drag directly on the preview image to set focal position quickly.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Gradient From"
                  value={wallpaperGradientFrom}
                  onChange={(event) => setWallpaperGradientFrom(event.target.value)}
                  placeholder="#3b82f6"
                />
                <Input
                  label="Gradient To"
                  value={wallpaperGradientTo}
                  onChange={(event) => setWallpaperGradientTo(event.target.value)}
                  placeholder="#6366f1"
                />
              </div>

              <Input
                label="Gradient Opacity (%)"
                type="number"
                value={wallpaperGradientOpacity}
                onChange={(event) => setWallpaperGradientOpacity(event.target.value)}
                placeholder="62"
              />

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Primary Color</label>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <span
                    className="h-10 w-full shrink-0 rounded-lg border border-line/70 sm:w-10"
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
                    className="h-10 w-full cursor-pointer rounded-lg border border-line/70 bg-card p-1 sm:w-10"
                    aria-label="Pick primary color"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="ml-1 block text-sm font-medium text-muted">Accent Color</label>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <span
                    className="h-10 w-full shrink-0 rounded-lg border border-line/70 sm:w-10"
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
                    className="h-10 w-full cursor-pointer rounded-lg border border-line/70 bg-card p-1 sm:w-10"
                    aria-label="Pick accent color"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-line/70 bg-card/55 p-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sparkles className="h-4 w-4 text-brand-500" />
                  Accessibility Contrast Check
                </div>
                <p className="text-xs text-muted">WCAG AA target for normal text: 4.5:1 (large text: 3.0:1).</p>
                <div className="mt-3 space-y-2">
                  {contrastChecks.map((check) => {
                    const aaPass = check.ratio >= 4.5;
                    const largePass = check.ratio >= 3;
                    const statusClass = aaPass
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                      : largePass
                        ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                        : 'border-rose-500/35 bg-rose-500/10 text-rose-300';

                    return (
                      <div key={check.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/70 bg-panel/55 px-3 py-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-4 w-4 shrink-0 rounded border border-line/70"
                            style={{
                              backgroundImage: `linear-gradient(135deg, ${check.foreground} 0%, ${check.background} 100%)`
                            }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-muted">{check.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{check.ratio.toFixed(2)}:1</span>
                          <span className={`rounded-full border px-2 py-0.5 font-semibold ${statusClass}`}>
                            {aaPass ? 'AA pass' : largePass ? 'Large text only' : 'Fail'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4">
          <div className="rounded-2xl border border-line/70 bg-panel/55 p-4 xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">Enabled Apps</h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setEnabledApps(allBuiltInAppIds)}
                  className="w-full sm:w-auto"
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setEnabledApps([])}
                  className="w-full sm:w-auto"
                >
                  Clear
                </Button>
              </div>
            </div>
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
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Custom Apps (JSON)</h4>
              <p className="mt-1 text-xs text-muted">
                Advanced: define extra client tiles. Required fields are
                <code className="mx-1 font-mono">id</code>,
                <code className="mx-1 font-mono">name</code>,
                <code className="mx-1 font-mono">platforms</code>.
                <code className="ml-1 font-mono">urlScheme</code> is optional for manual-only apps.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => loadCustomAppsPreset(CUSTOM_APPS_TEMPLATE)}
              >
                Use Template
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => loadCustomAppsPreset(CUSTOM_APPS_STARTER_PACK)}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Starter Pack
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={formatCustomApps}
              >
                Format JSON
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void copyCustomAppsExample()}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy Example
              </Button>
            </div>
          </div>
          <textarea
            value={customAppsJson}
            onChange={(event) => setCustomAppsJson(event.target.value)}
            rows={8}
            className="mt-3 w-full rounded-2xl border border-line/80 bg-card/75 px-4 py-3 font-mono text-xs text-foreground outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          />
          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,1fr)]">
            <div className="rounded-2xl border border-line/70 bg-card/65 p-4">
              <h5 className="text-sm font-semibold text-foreground">Schema Notes</h5>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                <li><code className="font-mono">platforms</code> accepts <code className="font-mono">android</code>, <code className="font-mono">ios</code>, <code className="font-mono">windows</code>.</li>
                <li><code className="font-mono">usesFormat</code> accepts <code className="font-mono">v2ray</code>, <code className="font-mono">clash</code>, <code className="font-mono">singbox</code>, <code className="font-mono">wireguard</code>, <code className="font-mono">mieru</code>.</li>
                <li>Use <code className="font-mono">{'{url}'}</code> for encoded deep links or <code className="font-mono">{'{rawUrl}'}</code> for raw path-style links.</li>
                <li>Leave <code className="font-mono">urlScheme</code> empty if the app only supports manual import.</li>
                <li><code className="font-mono">storeUrl</code> should be an object like <code className="font-mono">{'{ "android": "https://..." }'}</code>.</li>
              </ul>
            </div>
            <div className={`rounded-2xl border p-4 ${
              customAppsValidation.errors.length > 0
                ? 'border-rose-500/40 bg-rose-500/10'
                : customAppsValidation.warnings.length > 0
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/10'
            }`}>
              <div className="flex items-center gap-2">
                {customAppsValidation.errors.length > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-rose-300" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                )}
                <h5 className="text-sm font-semibold text-foreground">Validation</h5>
              </div>
              <p className="mt-2 text-xs text-muted">
                {customAppsValidation.stats.total} app(s),
                {' '}{customAppsValidation.stats.deepLink} deep-link,
                {' '}{customAppsValidation.stats.manualOnly} manual-only.
              </p>
              {customAppsValidation.errors.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-rose-100">
                  {customAppsValidation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-emerald-100">
                  Custom apps JSON is valid.
                </p>
              )}
              {customAppsValidation.warnings.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-amber-100">
                  {customAppsValidation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>

        <div className="hidden flex-col gap-2 border-t border-line/70 pt-4 sm:flex sm:flex-row sm:items-center">
          <Button
            onClick={() => saveBranding.mutate()}
            loading={saveBranding.isPending}
            disabled={saveDisabled}
          >
            {saveButtonLabel}
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={resetBrandingColors}
          >
            Reset Colors
          </Button>
        </div>
        <div className="sticky bottom-2 z-20 -mx-1 border-t border-line/70 bg-panel/85 px-1 pb-1 pt-3 backdrop-blur sm:hidden">
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => saveBranding.mutate()}
              loading={saveBranding.isPending}
              disabled={saveDisabled}
              size="sm"
              className="w-full"
            >
              {isEditing ? 'Save' : 'Create'}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={resetBrandingColors}
              size="sm"
              className="w-full"
            >
              Reset Colors
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-foreground">Branding Profiles</h3>
        <div className="space-y-3 md:hidden">
          {brandingRows.map((branding) => (
            <div key={branding.id} className="rounded-2xl border border-line/70 bg-card/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{branding.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {branding.scope}
                    {branding.scope === 'USER' && branding.userId
                      ? ` #${branding.userId}${branding.user?.email ? ` (${branding.user.email})` : ''}`
                      : ''}
                    {branding.scope === 'GROUP' && branding.groupId
                      ? ` #${branding.groupId}${branding.group?.name ? ` (${branding.group.name})` : ''}`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => loadForEdit(branding)}
                  className="rounded-lg p-2 text-muted hover:bg-card/70 hover:text-foreground"
                  aria-label={`Edit ${branding.name}`}
                >
                  <Edit className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-line/70 bg-panel/55 px-2 py-1.5 text-muted">
                  App: <span className="font-semibold text-foreground">{branding.appName || 'One-UI'}</span>
                </div>
                <div className="rounded-lg border border-line/70 bg-panel/55 px-2 py-1.5 text-muted">
                  Priority: <span className="font-semibold text-foreground">{branding.priority}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => toggleBranding.mutate(branding)}
                  className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium transition ${
                    branding.enabled
                      ? 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                      : 'border border-line/70 bg-card/60 text-muted'
                  }`}
                >
                  {branding.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button
                  type="button"
                  disabled={publishBranding.isPending}
                  onClick={() =>
                    publishBranding.mutate({
                      brandingId: branding.id,
                      published: !branding.isPublished
                    })
                  }
                  className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium transition ${
                    branding.isPublished
                      ? 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                      : 'border border-amber-500/35 bg-amber-500/15 text-amber-200'
                  } ${publishBranding.isPending ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  {branding.isPublished ? 'Published' : 'Draft'}
                </button>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => deleteBranding.mutate(branding.id)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                  aria-label={`Delete ${branding.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!brandingQuery.isLoading && brandingRows.length === 0 ? (
            <p className="rounded-2xl border border-line/70 bg-card/60 px-3 py-4 text-center text-sm text-muted">
              No branding profile configured
            </p>
          ) : null}
        </div>
        <div className="hidden overflow-x-auto rounded-2xl border border-line/70 md:block">
          <table className="min-w-full divide-y divide-line/70">
            <thead className="bg-panel/60">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Scope</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">App Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Priority</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Enabled</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">Publication</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 bg-card/60">
              {brandingRows.map((branding) => (
                <tr key={branding.id}>
                  <td className="px-3 py-2 text-sm text-foreground">{branding.name}</td>
                  <td className="px-3 py-2 text-sm text-muted">
                    {branding.scope}
                    {branding.scope === 'USER' && branding.userId
                      ? ` #${branding.userId}${branding.user?.email ? ` (${branding.user.email})` : ''}`
                      : ''}
                    {branding.scope === 'GROUP' && branding.groupId
                      ? ` #${branding.groupId}${branding.group?.name ? ` (${branding.group.name})` : ''}`
                      : ''}
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
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={publishBranding.isPending}
                      onClick={() =>
                        publishBranding.mutate({
                          brandingId: branding.id,
                          published: !branding.isPublished
                        })
                      }
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium transition ${
                        branding.isPublished
                          ? 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                          : 'border border-amber-500/35 bg-amber-500/15 text-amber-200'
                      } ${publishBranding.isPending ? 'cursor-not-allowed opacity-70' : ''}`}
                    >
                      {branding.isPublished ? 'PUBLISHED' : 'DRAFT'}
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
              {!brandingQuery.isLoading && brandingRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-sm text-muted">
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
