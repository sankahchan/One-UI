const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const v2rayFormat = require('./formats/v2ray');
const clashFormat = require('./formats/clash');
const singboxFormat = require('./formats/singbox');
const wireguardFormat = require('./formats/wireguard');
const { buildProtocolUrl } = require('./formats/url-builder');
const clientDetector = require('./utils/client-detector');
const env = require('../config/env');
const ipTrackingService = require('../services/ipTracking.service');
const deviceTrackingService = require('../services/deviceTracking.service');
const connectionLogsService = require('../services/connectionLogs.service');
const subscriptionBrandingService = require('../services/subscriptionBranding.service');
const { normalizeClientIp } = require('../utils/network');
const { buildDeviceFingerprint } = require('../utils/deviceFingerprint');

class SubscriptionGenerator {
  constructor() {
    this.formats = {
      v2ray: v2rayFormat,
      clash: clashFormat,
      clashmeta: clashFormat, // ClashMeta uses same format with meta-specific features
      singbox: singboxFormat,
      wireguard: wireguardFormat
    };
  }

  securityPreferenceRank(inbound) {
    const security = String(inbound?.security || '').toUpperCase();
    if (security === 'REALITY') {
      return 0;
    }
    if (security === 'TLS') {
      return 1;
    }
    return 2;
  }

  normalizePriority(value) {
    const parsed = Number.parseInt(String(value ?? 100), 10);
    if (!Number.isInteger(parsed)) {
      return 100;
    }
    return Math.max(1, Math.min(parsed, 9999));
  }

  normalizeTimestamp(value) {
    if (!value) {
      return Number.MAX_SAFE_INTEGER;
    }
    const parsed = new Date(value).getTime();
    if (Number.isNaN(parsed)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return parsed;
  }

  protocolQualityScore(scoreByProtocol, inbound) {
    if (!(scoreByProtocol instanceof Map)) {
      return 0;
    }

    const protocol = String(inbound?.protocol || '').toUpperCase();
    if (!protocol) {
      return 0;
    }

    return Number(scoreByProtocol.get(protocol) || 0);
  }

  async buildProtocolQualityScoreMap(userId) {
    try {
      const qualityByUser = await connectionLogsService.getQualityByUsers([userId], 60);
      const quality = qualityByUser.get(userId);
      const scoreByProtocol = new Map();

      for (const entry of quality?.byProtocol || []) {
        const protocol = String(entry?.protocol || '').toUpperCase();
        if (!protocol) {
          continue;
        }
        scoreByProtocol.set(protocol, Number(entry?.score || 0));
      }

      return scoreByProtocol;
    } catch (_error) {
      return new Map();
    }
  }

  pickPreferredCandidate(currentCandidate, nextCandidate) {
    if (!currentCandidate) {
      return nextCandidate;
    }

    if (nextCandidate.priority !== currentCandidate.priority) {
      return nextCandidate.priority < currentCandidate.priority ? nextCandidate : currentCandidate;
    }

    const nextSecurityRank = this.securityPreferenceRank(nextCandidate.inbound);
    const currentSecurityRank = this.securityPreferenceRank(currentCandidate.inbound);
    if (nextSecurityRank !== currentSecurityRank) {
      return nextSecurityRank < currentSecurityRank ? nextCandidate : currentCandidate;
    }

    if (nextCandidate.createdAtMs !== currentCandidate.createdAtMs) {
      return nextCandidate.createdAtMs < currentCandidate.createdAtMs ? nextCandidate : currentCandidate;
    }

    return currentCandidate;
  }

  resolveFormat(format, userAgent = '') {
    if (!format || format === 'auto') {
      return clientDetector.detect(userAgent);
    }
    return String(format).toLowerCase();
  }

  toBigInt(value) {
    if (typeof value === 'bigint') {
      return value;
    }
    return BigInt(value || 0);
  }

  resolveIpLimit(user) {
    const limit = Number.parseInt(String(user?.ipLimit ?? 0), 10);
    if (!Number.isInteger(limit) || limit < 0) {
      return 0;
    }
    return limit;
  }

  resolveDeviceLimit(user) {
    const limit = Number.parseInt(String(user?.deviceLimit ?? 0), 10);
    if (!Number.isInteger(limit) || limit < 0) {
      return 0;
    }
    return limit;
  }

  async buildRecentConnectionState(userId) {
    const since = new Date(Date.now() - Math.max(300, Number(env.DEVICE_TRACKING_TTL_SECONDS || 1800)) * 1000);
    const recent = await connectionLogsService.getRecentConnectionState(userId, since);

    return {
      ipSet: new Set((recent.ips || []).map((entry) => normalizeClientIp(entry)).filter(Boolean)),
      fingerprintSet: new Set((recent.fingerprints || []).filter(Boolean))
    };
  }

  async enforceConnectionLimits(user, validInbounds, context = {}) {
    const normalizedIp = normalizeClientIp(context.clientIp);
    const normalizedUserAgent = String(context.userAgent || '').slice(0, 1024);
    const firstInboundId = validInbounds[0]?.inboundId;
    const ipLimit = this.resolveIpLimit(user);
    const deviceLimit = this.resolveDeviceLimit(user);
    const deviceFingerprint = buildDeviceFingerprint({
      explicitFingerprint: context.deviceFingerprint,
      userAgent: normalizedUserAgent,
      acceptLanguage: context.acceptLanguage,
      secChUa: context.secChUa,
      secChUaPlatform: context.secChUaPlatform,
      secChUaMobile: context.secChUaMobile,
      clientIp: normalizedIp,
      protocolHint: context.protocolHint
    });

    const recentState = ipLimit > 0 || deviceLimit > 0 ? await this.buildRecentConnectionState(user.id) : null;

    let ipAlreadyTracked = false;
    if (ipLimit > 0 && normalizedIp) {
      const knownIps = new Set([
        ...Array.from(recentState?.ipSet || []),
        ...ipTrackingService.getActiveIps(user.id)
      ]);
      ipAlreadyTracked = knownIps.has(normalizedIp);

      if (!ipAlreadyTracked && knownIps.size >= ipLimit) {
        if (firstInboundId) {
          await connectionLogsService.log({
            userId: user.id,
            inboundId: firstInboundId,
            clientIp: normalizedIp || 'unknown',
            deviceFingerprint,
            userAgent: normalizedUserAgent || null,
            action: 'reject_ip_limit'
          });
        }
        throw new Error(`IP limit exceeded (${knownIps.size}/${ipLimit})`);
      }
    }

    let deviceAlreadyTracked = false;
    if (deviceLimit > 0) {
      const knownFingerprints = new Set([
        ...Array.from(recentState?.fingerprintSet || []),
        ...deviceTrackingService.getActiveFingerprints(user.id)
      ]);

      deviceAlreadyTracked = knownFingerprints.has(deviceFingerprint);
      if (!deviceAlreadyTracked && knownFingerprints.size >= deviceLimit) {
        if (firstInboundId) {
          await connectionLogsService.log({
            userId: user.id,
            inboundId: firstInboundId,
            clientIp: normalizedIp || 'unknown',
            deviceFingerprint,
            userAgent: normalizedUserAgent || null,
            action: 'reject_device_limit'
          });
        }
        throw new Error(`Device limit exceeded (${knownFingerprints.size}/${deviceLimit})`);
      }
    }

    if (normalizedIp) {
      if (!ipAlreadyTracked) {
        ipTrackingService.trackConnection(user.id, normalizedIp);
      } else {
        ipTrackingService.refreshConnection(user.id, normalizedIp);
      }
    }

    if (!deviceAlreadyTracked) {
      deviceTrackingService.trackDevice(user.id, deviceFingerprint, {
        clientIp: normalizedIp || null,
        userAgent: normalizedUserAgent || null,
        inboundId: Number.isInteger(firstInboundId) ? firstInboundId : null
      });
    } else {
      deviceTrackingService.refreshDevice(user.id, deviceFingerprint, {
        clientIp: normalizedIp || null,
        userAgent: normalizedUserAgent || null,
        inboundId: Number.isInteger(firstInboundId) ? firstInboundId : null
      });
    }

    if (ipAlreadyTracked && deviceAlreadyTracked) {
      if (normalizedIp) {
        ipTrackingService.refreshConnection(user.id, normalizedIp);
      }
      return;
    }

    if (firstInboundId) {
      await connectionLogsService.log({
        userId: user.id,
        inboundId: firstInboundId,
        clientIp: normalizedIp || 'unknown',
        deviceFingerprint,
        userAgent: normalizedUserAgent || null,
        action: 'connect'
      });
    }
  }

  async generate(token, format = 'v2ray', userAgent = '', context = {}) {
    const user = await prisma.user.findUnique({
      where: { subscriptionToken: token },
      include: {
        inbounds: {
          where: {
            enabled: true,
            inbound: {
              enabled: true
            }
          },
          include: {
            inbound: true
          }
        },
        groups: {
          where: {
            group: {
              isDisabled: false
            }
          },
          include: {
            group: {
              include: {
                inbounds: {
                  where: {
                    enabled: true,
                    inbound: {
                      enabled: true
                    }
                  },
                  include: {
                    inbound: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!user) {
      throw new Error('Subscription not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new Error('Subscription expired or disabled');
    }

    // Deferred expiry ("start on first use"): activate user on first successful subscription fetch.
    if (user.startOnFirstUse && !user.firstUsedAt) {
      const durationMs = Math.max(0, user.expireDate.getTime() - user.createdAt.getTime());
      const activatedAt = new Date();
      const nextExpireDate = new Date(activatedAt.getTime() + durationMs);

      const updated = await prisma.user.updateMany({
        where: {
          id: user.id,
          startOnFirstUse: true,
          firstUsedAt: null
        },
        data: {
          firstUsedAt: activatedAt,
          expireDate: nextExpireDate
        }
      });

      if (updated.count > 0) {
        user.firstUsedAt = activatedAt;
        user.expireDate = nextExpireDate;
      } else {
        const refreshed = await prisma.user.findUnique({
          where: { id: user.id },
          select: { firstUsedAt: true, expireDate: true }
        });
        if (refreshed) {
          user.firstUsedAt = refreshed.firstUsedAt;
          user.expireDate = refreshed.expireDate;
        }
      }
    }

    if (new Date() > user.expireDate) {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'EXPIRED' }
      });
      throw new Error('Subscription expired');
    }

    const totalUsed = this.toBigInt(user.uploadUsed) + this.toBigInt(user.downloadUsed);
    const totalLimit = this.toBigInt(user.dataLimit);
    if (totalLimit > 0n && totalUsed >= totalLimit) {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'LIMITED' }
      });
      throw new Error('Data limit exceeded');
    }

    const candidateByInboundId = new Map();

    for (const userInbound of user.inbounds || []) {
      if (!userInbound.inbound) {
        continue;
      }

      const candidate = {
        id: userInbound.id,
        userId: user.id,
        inboundId: userInbound.inboundId,
        enabled: Boolean(userInbound.enabled),
        priority: this.normalizePriority(userInbound.priority),
        createdAt: userInbound.createdAt || null,
        createdAtMs: this.normalizeTimestamp(userInbound.createdAt),
        source: 'DIRECT',
        inbound: userInbound.inbound
      };
      const existing = candidateByInboundId.get(userInbound.inboundId);
      candidateByInboundId.set(userInbound.inboundId, this.pickPreferredCandidate(existing, candidate));
    }

    for (const relation of user.groups || []) {
      const groupInbounds = relation.group?.inbounds || [];
      for (const groupInbound of groupInbounds) {
        if (!groupInbound.inbound) {
          continue;
        }

        const candidate = {
          id: `group-${relation.groupId}-${groupInbound.inboundId}`,
          userId: user.id,
          inboundId: groupInbound.inboundId,
          enabled: true,
          priority: this.normalizePriority(groupInbound.priority),
          createdAt: groupInbound.createdAt || null,
          createdAtMs: this.normalizeTimestamp(groupInbound.createdAt),
          source: 'GROUP',
          inbound: groupInbound.inbound
        };
        const existing = candidateByInboundId.get(groupInbound.inboundId);
        candidateByInboundId.set(groupInbound.inboundId, this.pickPreferredCandidate(existing, candidate));
      }
    }

    const protocolScoreByProtocol = await this.buildProtocolQualityScoreMap(user.id);

    const validInbounds = Array.from(candidateByInboundId.values()).sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      const aQualityScore = this.protocolQualityScore(protocolScoreByProtocol, a.inbound);
      const bQualityScore = this.protocolQualityScore(protocolScoreByProtocol, b.inbound);
      if (aQualityScore !== bQualityScore) {
        return bQualityScore - aQualityScore;
      }

      const securityDelta = this.securityPreferenceRank(a.inbound) - this.securityPreferenceRank(b.inbound);
      if (securityDelta !== 0) {
        return securityDelta;
      }

      if (a.createdAtMs !== b.createdAtMs) {
        return a.createdAtMs - b.createdAtMs;
      }

      return Number(a.inboundId) - Number(b.inboundId);
    });

    if (validInbounds.length === 0) {
      throw new Error('No active configurations found');
    }

    const selectedFormat = this.resolveFormat(format, userAgent);

    const formatter = this.formats[selectedFormat];
    if (!formatter) {
      throw new Error('Unsupported format');
    }

    await this.enforceConnectionLimits(user, validInbounds, {
      clientIp: context.clientIp,
      userAgent: context.userAgent || userAgent,
      deviceFingerprint: context.deviceFingerprint,
      acceptLanguage: context.acceptLanguage,
      secChUa: context.secChUa,
      secChUaPlatform: context.secChUaPlatform,
      secChUaMobile: context.secChUaMobile,
      protocolHint: selectedFormat
    });

    const branding = await subscriptionBrandingService.resolveEffectiveBrandingForUser(user.id);
    const content = formatter.generate(user, validInbounds, { branding });

    await this.logAccess(token);

    const links = validInbounds
      .map((userInbound) => buildProtocolUrl(userInbound.inbound.protocol, user, userInbound.inbound))
      .filter(Boolean);

    return {
      format: selectedFormat,
      content,
      contentType: clientDetector.getContentType(selectedFormat),
      fileName: `${(branding?.appName || 'one-ui').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${user.email}-${selectedFormat}.${clientDetector.getFileExtension(selectedFormat)}`,
      links,
      branding: branding || null,
      user: {
        email: user.email,
        upload: Number(user.uploadUsed),
        download: Number(user.downloadUsed),
        total: Number(user.dataLimit),
        expire: Math.floor(user.expireDate.getTime() / 1000)
      }
    };
  }

  async logAccess(_token) {
    // Optional: track subscription access in future.
  }
}

module.exports = new SubscriptionGenerator();
