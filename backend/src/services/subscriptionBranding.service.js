const prisma = require('../config/database');
const env = require('../config/env');

function sanitizeHttpUrl(value, maxLength = 2048) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;

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

function sanitizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
  return null;
}

function sanitizeBrandingMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const safe = {};

  if (Array.isArray(metadata.enabledApps)) {
    safe.enabledApps = metadata.enabledApps
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 64)
      .slice(0, 64);
  }

  const qrLogoSizePercent = Number(metadata.qrLogoSizePercent);
  if (Number.isFinite(qrLogoSizePercent)) {
    safe.qrLogoSizePercent = Math.min(Math.max(qrLogoSizePercent, 10), 40);
  }

  if (Array.isArray(metadata.usageAlertThresholds)) {
    safe.usageAlertThresholds = metadata.usageAlertThresholds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.min(Math.max(value, 1), 100))
      .slice(0, 12);
  }

  const wallpaperUrl = sanitizeHttpUrl(metadata.wallpaperUrl);
  if (wallpaperUrl) {
    safe.wallpaperUrl = wallpaperUrl;
  }

  const wallpaperOverlayOpacity = Number(metadata.wallpaperOverlayOpacity);
  if (Number.isFinite(wallpaperOverlayOpacity)) {
    safe.wallpaperOverlayOpacity = Math.min(Math.max(wallpaperOverlayOpacity, 10), 90);
  }

  const wallpaperBlurPx = Number(metadata.wallpaperBlurPx);
  if (Number.isFinite(wallpaperBlurPx)) {
    safe.wallpaperBlurPx = Math.min(Math.max(wallpaperBlurPx, 0), 24);
  }

  const wallpaperPositionX = Number(metadata.wallpaperPositionX);
  if (Number.isFinite(wallpaperPositionX)) {
    safe.wallpaperPositionX = Math.min(Math.max(wallpaperPositionX, 0), 100);
  }

  const wallpaperPositionY = Number(metadata.wallpaperPositionY);
  if (Number.isFinite(wallpaperPositionY)) {
    safe.wallpaperPositionY = Math.min(Math.max(wallpaperPositionY, 0), 100);
  }

  const wallpaperGradientFrom = sanitizeHexColor(metadata.wallpaperGradientFrom);
  if (wallpaperGradientFrom) {
    safe.wallpaperGradientFrom = wallpaperGradientFrom;
  }

  const wallpaperGradientTo = sanitizeHexColor(metadata.wallpaperGradientTo);
  if (wallpaperGradientTo) {
    safe.wallpaperGradientTo = wallpaperGradientTo;
  }

  const wallpaperGradientOpacity = Number(metadata.wallpaperGradientOpacity);
  if (Number.isFinite(wallpaperGradientOpacity)) {
    safe.wallpaperGradientOpacity = Math.min(Math.max(wallpaperGradientOpacity, 0), 100);
  }

  if (Array.isArray(metadata.customApps)) {
    safe.customApps = metadata.customApps
      .filter((entry) => entry && typeof entry === 'object')
      .slice(0, 32)
      .map((entry) => {
        const platformsRaw = Array.isArray(entry.platforms) ? entry.platforms : [];
        const platforms = platformsRaw
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim().toLowerCase())
          .filter((value) => ['android', 'ios', 'windows'].includes(value))
          .slice(0, 3);

        const storeUrl = entry.storeUrl && typeof entry.storeUrl === 'object'
          ? {
              android: sanitizeHttpUrl(entry.storeUrl.android, 1024) || undefined,
              ios: sanitizeHttpUrl(entry.storeUrl.ios, 1024) || undefined,
              windows: sanitizeHttpUrl(entry.storeUrl.windows, 1024) || undefined
            }
          : undefined;

        const usesFormatRaw = typeof entry.usesFormat === 'string' ? entry.usesFormat.trim().toLowerCase() : '';
        const usesFormat = ['v2ray', 'clash', 'singbox', 'wireguard'].includes(usesFormatRaw)
          ? usesFormatRaw
          : undefined;

        const urlScheme = typeof entry.urlScheme === 'string'
          ? entry.urlScheme
          : (typeof entry.importScheme === 'string' ? entry.importScheme : '');

        return {
          id: typeof entry.id === 'string' ? entry.id.slice(0, 64) : '',
          name: typeof entry.name === 'string' ? entry.name.slice(0, 64) : '',
          icon: typeof entry.icon === 'string' ? entry.icon.slice(0, 8) : '🔗',
          description: typeof entry.description === 'string' ? entry.description.slice(0, 160) : undefined,
          platforms,
          usesFormat,
          urlScheme: urlScheme.slice(0, 512),
          storeUrl
        };
      })
      .filter((entry) => entry.id && entry.name && entry.platforms.length > 0 && entry.urlScheme);
  }

  return Object.keys(safe).length > 0 ? safe : {};
}

function normalizeBrandingInput(payload = {}) {
  return {
    scope: String(payload.scope || 'GLOBAL').toUpperCase(),
    enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
    priority: Number.parseInt(String(payload.priority ?? 100), 10) || 100,
    name: String(payload.name || '').trim(),
    appName: payload.appName ? String(payload.appName).trim() : null,
    logoUrl: payload.logoUrl ? String(payload.logoUrl).trim() : null,
    supportUrl: payload.supportUrl ? String(payload.supportUrl).trim() : null,
    primaryColor: payload.primaryColor ? String(payload.primaryColor).trim() : null,
    accentColor: payload.accentColor ? String(payload.accentColor).trim() : null,
    profileTitle: payload.profileTitle ? String(payload.profileTitle).trim() : null,
    profileDescription: payload.profileDescription ? String(payload.profileDescription).trim() : null,
    customFooter: payload.customFooter ? String(payload.customFooter).trim() : null,
    clashProfileName: payload.clashProfileName ? String(payload.clashProfileName).trim() : null,
    metadata: sanitizeBrandingMetadata(payload.metadata),
    userId: payload.userId ? Number(payload.userId) : null,
    groupId: payload.groupId ? Number(payload.groupId) : null
  };
}

function validateBrandingInput(input) {
  if (!['GLOBAL', 'GROUP', 'USER'].includes(input.scope)) {
    throw new Error('scope must be GLOBAL, GROUP, or USER');
  }
  if (!input.name) {
    throw new Error('name is required');
  }

  if (input.scope === 'GLOBAL') {
    input.userId = null;
    input.groupId = null;
  }

  if (input.scope === 'GROUP') {
    if (!Number.isInteger(input.groupId) || input.groupId < 1) {
      throw new Error('groupId is required for GROUP scope');
    }
    input.userId = null;
  }

  if (input.scope === 'USER') {
    if (!Number.isInteger(input.userId) || input.userId < 1) {
      throw new Error('userId is required for USER scope');
    }
    input.groupId = null;
  }
}

function mergeBranding(base = {}, override = {}) {
  const filteredOverride = Object.fromEntries(
    Object.entries(override).filter(([, value]) => value !== null && value !== undefined)
  );
  const merged = {
    ...base,
    ...filteredOverride
  };

  const baseMetadata = base.metadata && typeof base.metadata === 'object' && !Array.isArray(base.metadata)
    ? base.metadata
    : null;
  const overrideMetadata = override.metadata && typeof override.metadata === 'object' && !Array.isArray(override.metadata)
    ? override.metadata
    : null;

  if (baseMetadata || overrideMetadata) {
    merged.metadata = {
      ...(baseMetadata || {}),
      ...(overrideMetadata || {})
    };
  }

  return merged;
}

class SubscriptionBrandingService {
  async listBrandings() {
    return prisma.subscriptionBranding.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        },
        group: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [
        { scope: 'asc' },
        { priority: 'asc' },
        { id: 'asc' }
      ]
    });
  }

  async createBranding(payload = {}) {
    const input = normalizeBrandingInput(payload);
    validateBrandingInput(input);

    return prisma.subscriptionBranding.create({
      data: input
    });
  }

  async updateBranding(id, payload = {}) {
    const current = await prisma.subscriptionBranding.findUnique({
      where: { id: Number(id) }
    });
    if (!current) {
      throw new Error('Subscription branding not found');
    }

    const input = normalizeBrandingInput({
      ...current,
      ...payload
    });
    validateBrandingInput(input);

    return prisma.subscriptionBranding.update({
      where: { id: Number(id) },
      data: input
    });
  }

  async deleteBranding(id) {
    return prisma.subscriptionBranding.delete({
      where: { id: Number(id) }
    });
  }

  async resolveEffectiveBrandingForUser(userId) {
    if (!env.SUBSCRIPTION_BRANDING_ENABLED) {
      return null;
    }

    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId < 1) {
      return null;
    }

    const memberships = await prisma.userGroup.findMany({
      where: { userId: numericUserId },
      select: { groupId: true }
    });
    const groupIds = memberships.map((entry) => entry.groupId);

    const [globalBrandings, groupBrandings, userBranding] = await Promise.all([
      prisma.subscriptionBranding.findMany({
        where: {
          scope: 'GLOBAL',
          enabled: true
        },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }]
      }),
      groupIds.length > 0
        ? prisma.subscriptionBranding.findMany({
            where: {
              scope: 'GROUP',
              groupId: {
                in: groupIds
              },
              enabled: true
            },
            orderBy: [{ priority: 'asc' }, { id: 'asc' }]
          })
        : [],
      prisma.subscriptionBranding.findFirst({
        where: {
          scope: 'USER',
          userId: numericUserId,
          enabled: true
        },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }]
      })
    ]);

    const globalBranding = globalBrandings[0] || null;
    const groupBranding = groupBrandings[0] || null;

    const merged = mergeBranding(
      mergeBranding(
        {
          appName: 'One-UI',
          profileTitle: 'One-UI Subscription',
          profileDescription: 'Generated by One-UI',
          clashProfileName: 'One-UI'
        },
        globalBranding || {}
      ),
      groupBranding || {}
    );

    const finalBranding = mergeBranding(merged, userBranding || {});
    return finalBranding;
  }
}

module.exports = new SubscriptionBrandingService();
