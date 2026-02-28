export type Platform = 'android' | 'ios' | 'windows';
export type FormatTab = 'v2ray' | 'clash' | 'singbox' | 'wireguard' | 'mieru';

export interface SubscriptionUrls {
  v2ray?: string;
  clash?: string;
  singbox?: string;
  wireguard?: string;
  mieru?: string;
}

export interface ClientAppDefinition {
  id: string;
  name: string;
  icon: string;
  platforms: Platform[];
  description: string;
  usesFormat?: FormatTab;
  /**
   * Deep-link/import scheme containing one of:
   * - `{url}`: URL-encoded subscription URL
   * - `{rawUrl}`: raw/unencoded subscription URL
   * If omitted, the app is considered "manual import" only.
   */
  urlScheme?: string;
  storeUrl?: Partial<Record<Platform, string>>;
}

export interface CustomClientApp {
  id: string;
  name: string;
  icon: string;
  platforms: Platform[];
  description?: string;
  usesFormat?: FormatTab;
  urlScheme: string;
  storeUrl?: Partial<Record<Platform, string>>;
}

export interface SubscriptionBrandingMetadata {
  enabledApps?: string[];
  customApps?: CustomClientApp[];
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
}

export interface ResolvedClientApp extends ClientAppDefinition {
  importUrl: string | null;
  manualUrl: string;
  storeLink: string;
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export const BUILTIN_CLIENT_APPS: ClientAppDefinition[] = [
  {
    id: 'v2rayng',
    name: 'V2RayNG',
    icon: '🚀',
    platforms: ['android'],
    description: 'Fast V2Ray client for Android.',
    usesFormat: 'v2ray',
    urlScheme: 'v2rayng://install-sub?url={url}',
    storeUrl: {
      android: 'https://play.google.com/store/apps/details?id=com.v2ray.ang'
    }
  },
  {
    id: 'hiddify',
    name: 'Hiddify',
    icon: '🛡️',
    platforms: ['android', 'ios', 'windows'],
    description: 'User-friendly client with strong anti-DPI support.',
    usesFormat: 'v2ray',
    // Hiddify import scheme expects the raw URL in path form.
    // Example: hiddify://import/https://example.com/sub/<token>
    urlScheme: 'hiddify://import/{rawUrl}',
    storeUrl: {
      android: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
      ios: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532',
      windows: 'https://github.com/hiddify/hiddify-next/releases/latest'
    }
  },
  {
    id: 'clash',
    name: 'Clash',
    icon: '⚡',
    platforms: ['android', 'windows'],
    description: 'Profiles-based client (Clash/Meta ecosystem).',
    usesFormat: 'clash',
    urlScheme: 'clash://install-config?url={url}',
    storeUrl: {
      android: 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases/latest',
      windows: 'https://github.com/MetaCubeX/mihomo/releases/latest'
    }
  },
  {
    id: 'shadowrocket',
    name: 'Shadowrocket',
    icon: '🛰️',
    platforms: ['ios'],
    description: 'Popular iOS client.',
    usesFormat: 'v2ray',
    urlScheme: 'shadowrocket://add/sub?url={url}',
    storeUrl: {
      ios: 'https://apps.apple.com/app/shadowrocket/id932747118'
    }
  },
  {
    id: 'v2box',
    name: 'V2Box',
    icon: '📦',
    platforms: ['ios'],
    description: 'Modern iOS client with subscription support.',
    usesFormat: 'v2ray',
    urlScheme: 'v2box://install-sub?url={url}',
    storeUrl: {
      ios: 'https://apps.apple.com/app/v2box-v2ray-client/id6446814690'
    }
  },
  {
    id: 'v2rayn',
    name: 'v2rayN',
    icon: '💻',
    platforms: ['windows'],
    description: 'Windows client (import the URL inside the app).',
    usesFormat: 'v2ray',
    storeUrl: {
      windows: 'https://github.com/2dust/v2rayN/releases/latest'
    }
  },
  {
    id: 'clashvergerev',
    name: 'Clash Verge Rev',
    icon: '🖥️',
    platforms: ['windows'],
    description: 'Desktop client with Mieru support.',
    usesFormat: 'mieru',
    urlScheme: 'clash://install-config?url={url}',
    storeUrl: {
      windows: 'https://www.clashverge.dev/'
    }
  },
  {
    id: 'mihomoparty',
    name: 'Mihomo Party',
    icon: '🎉',
    platforms: ['windows'],
    description: 'Desktop client listed by Mieru project.',
    usesFormat: 'mieru',
    storeUrl: {
      windows: 'https://mihomo.party/'
    }
  },
  {
    id: 'nyamebox',
    name: 'NyameBox',
    icon: '🐱',
    platforms: ['windows'],
    description: 'Desktop client (NekoBox fork) listed by Mieru project.',
    usesFormat: 'mieru',
    storeUrl: {
      windows: 'https://qr243vbi.github.io/nekobox/#/'
    }
  },
  {
    id: 'clashmeta_android',
    name: 'ClashMetaForAndroid',
    icon: '🤖',
    platforms: ['android'],
    description: 'Android client listed by Mieru project.',
    usesFormat: 'mieru',
    urlScheme: 'clashmeta://install-config?url={url}',
    storeUrl: {
      android: 'https://github.com/MetaCubeX/ClashMetaForAndroid'
    }
  },
  {
    id: 'clashmi',
    name: 'ClashMi',
    icon: '🌊',
    platforms: ['android', 'ios'],
    description: 'Cross-platform client listed by Mieru project.',
    usesFormat: 'mieru',
    storeUrl: {
      android: 'https://clashmi.app/',
      ios: 'https://clashmi.app/'
    }
  },
  {
    id: 'exclave',
    name: 'Exclave',
    icon: '🧩',
    platforms: ['android'],
    description: 'Android client with Mieru support.',
    usesFormat: 'mieru',
    storeUrl: {
      android: 'https://github.com/dyhkwong/Exclave'
    }
  },
  {
    id: 'husi_mieru_plugin',
    name: 'husi + mieru plugin',
    icon: '🔌',
    platforms: ['android'],
    description: 'Install husi first, then add the mieru plugin.',
    usesFormat: 'mieru',
    storeUrl: {
      android: 'https://github.com/xchacha20-poly1305/husi'
    }
  },
  {
    id: 'karing',
    name: 'Karing',
    icon: '🛰️',
    platforms: ['android', 'ios'],
    description: 'Client app listed by Mieru project.',
    usesFormat: 'mieru',
    urlScheme: 'karing://install-config?url={url}',
    storeUrl: {
      android: 'https://karing.app/',
      ios: 'https://karing.app/'
    }
  },
  {
    id: 'nekobox_mieru_plugin',
    name: 'NekoBoxForAndroid + mieru plugin',
    icon: '📦',
    platforms: ['android'],
    description: 'Install NekoBoxForAndroid and the official mieru plugin.',
    usesFormat: 'mieru',
    storeUrl: {
      android: 'https://github.com/MatsuriDayo/NekoBoxForAndroid'
    }
  }
];

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'windows';
  const userAgent = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(userAgent)) return 'ios';
  if (/android/.test(userAgent)) return 'android';
  return 'windows';
}

export function buildImportUrl(urlScheme: string | undefined, subscriptionUrl: string): string | null {
  if (!urlScheme || !subscriptionUrl) return null;
  const trimmedUrl = String(subscriptionUrl).trim();
  const encodedUrl = encodeURIComponent(trimmedUrl);

  if (urlScheme.includes('{rawUrl}')) {
    return urlScheme.replace('{rawUrl}', trimmedUrl);
  }

  return urlScheme.replace('{url}', encodedUrl);
}

export function buildImportLaunchUrls(options: {
  appId: string;
  importUrl: string | null;
  manualUrl: string;
}): string[] {
  const appId = String(options.appId || '').toLowerCase();
  const importUrl = String(options.importUrl || '').trim();
  const manualUrl = String(options.manualUrl || '').trim();
  const launchUrls: string[] = [];

  if (importUrl) {
    launchUrls.push(importUrl);
  }

  // Hiddify URL scheme changed across versions.
  // Keep backward-compatible fallbacks if primary deep link does not launch.
  if (appId === 'hiddify' && manualUrl) {
    const encoded = encodeURIComponent(manualUrl);
    launchUrls.push(`hiddify://install-config?url=${encoded}`);
    launchUrls.push(`hiddify://install-sub?url=${encoded}`);
  }

  if (appId === 'clashmeta_android' && manualUrl) {
    const encoded = encodeURIComponent(manualUrl);
    launchUrls.push(`clash://install-config?url=${encoded}`);
  }

  return uniqueNonEmpty(launchUrls);
}

export function resolveSubscriptionApps(options: {
  platform: Platform;
  urls: SubscriptionUrls;
  metadata?: SubscriptionBrandingMetadata | null;
  format?: FormatTab;
}): ResolvedClientApp[] {
  const { platform, urls, metadata, format } = options;

  const enabledIds = Array.isArray(metadata?.enabledApps) ? metadata?.enabledApps?.filter((id) => typeof id === 'string') : null;
  const builtin = BUILTIN_CLIENT_APPS.filter((app) => app.platforms.includes(platform));
  const filteredBuiltin = enabledIds ? builtin.filter((app) => enabledIds.includes(app.id)) : builtin;

  const custom = Array.isArray(metadata?.customApps)
    ? metadata!.customApps
        .filter((entry) => entry && typeof entry === 'object')
        .filter((entry) => Array.isArray((entry as any).platforms) && (entry as any).platforms.includes(platform))
        .map((entry) => ({
          id: String((entry as any).id || ''),
          name: String((entry as any).name || ''),
          icon: String((entry as any).icon || '🔗'),
          platforms: (entry as any).platforms as Platform[],
          description: String((entry as any).description || 'Custom client'),
          usesFormat: (entry as any).usesFormat as FormatTab | undefined,
          urlScheme: String((entry as any).urlScheme || (entry as any).importScheme || ''),
          storeUrl: (entry as any).storeUrl as Partial<Record<Platform, string>> | undefined
        }))
        .filter((app) => app.id && app.name && app.urlScheme)
    : [];

  const allApps: ClientAppDefinition[] = [...filteredBuiltin, ...custom];
  const scopedApps = allApps.filter((app) => !format || !app.usesFormat || app.usesFormat === format);

  const formatUrl = (format: FormatTab | undefined): string => {
    const key = format || 'v2ray';
    return String((urls as any)[key] || '');
  };

  return scopedApps.map((app) => {
    const manualUrl = formatUrl(app.usesFormat);
    const importUrl = buildImportUrl(app.urlScheme, manualUrl);
    const storeLink = app.storeUrl?.[platform] ? String(app.storeUrl?.[platform]) : '';
    return {
      ...app,
      importUrl,
      manualUrl,
      storeLink
    };
  });
}
