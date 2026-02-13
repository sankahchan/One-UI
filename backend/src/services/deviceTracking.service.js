const env = require('../config/env');

class DeviceTrackingService {
  constructor() {
    // Map<userId, Map<fingerprint, { lastSeenAt, clientIp, userAgent, inboundId }>>
    this.activeDevices = new Map();
    this.staleThresholdMs = Math.max(300, Number(env.DEVICE_TRACKING_TTL_SECONDS || 1800)) * 1000;
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  getUserDeviceMap(userId) {
    if (!this.activeDevices.has(userId)) {
      this.activeDevices.set(userId, new Map());
    }

    return this.activeDevices.get(userId);
  }

  checkLimit(userId, fingerprint, deviceLimit) {
    if (!fingerprint) {
      return {
        allowed: true,
        currentCount: 0,
        limit: deviceLimit
      };
    }

    if (deviceLimit === 0) {
      return {
        allowed: true,
        currentCount: this.getActiveDeviceCount(userId),
        limit: 0
      };
    }

    const userDevices = this.activeDevices.get(userId) || new Map();

    if (userDevices.has(fingerprint)) {
      return {
        allowed: true,
        currentCount: userDevices.size,
        limit: deviceLimit
      };
    }

    if (userDevices.size >= deviceLimit) {
      return {
        allowed: false,
        currentCount: userDevices.size,
        limit: deviceLimit,
        message: `Device limit exceeded. Max ${deviceLimit} devices allowed.`
      };
    }

    return {
      allowed: true,
      currentCount: userDevices.size,
      limit: deviceLimit
    };
  }

  trackDevice(userId, fingerprint, metadata = {}) {
    if (!fingerprint) {
      return;
    }

    const userDevices = this.getUserDeviceMap(userId);
    userDevices.set(fingerprint, {
      lastSeenAt: Date.now(),
      clientIp: metadata.clientIp || null,
      userAgent: metadata.userAgent || null,
      inboundId: Number.isInteger(metadata.inboundId) ? metadata.inboundId : null
    });
  }

  refreshDevice(userId, fingerprint, metadata = {}) {
    if (!fingerprint) {
      return;
    }

    const userDevices = this.getUserDeviceMap(userId);
    const existing = userDevices.get(fingerprint) || {
      clientIp: null,
      userAgent: null,
      inboundId: null
    };

    userDevices.set(fingerprint, {
      lastSeenAt: Date.now(),
      clientIp: metadata.clientIp || existing.clientIp,
      userAgent: metadata.userAgent || existing.userAgent,
      inboundId: Number.isInteger(metadata.inboundId) ? metadata.inboundId : existing.inboundId
    });
  }

  releaseDevice(userId, fingerprint) {
    const userDevices = this.activeDevices.get(userId);
    if (!userDevices) {
      return null;
    }

    const existing = userDevices.get(fingerprint) || null;
    userDevices.delete(fingerprint);

    if (userDevices.size === 0) {
      this.activeDevices.delete(userId);
    }

    return existing;
  }

  clearUserDevices(userId) {
    this.activeDevices.delete(userId);
  }

  getActiveDeviceCount(userId) {
    const userDevices = this.activeDevices.get(userId);
    return userDevices ? userDevices.size : 0;
  }

  getActiveFingerprints(userId) {
    const userDevices = this.activeDevices.get(userId);
    return userDevices ? Array.from(userDevices.keys()) : [];
  }

  getActiveDevices(userId) {
    const userDevices = this.activeDevices.get(userId);
    if (!userDevices) {
      return [];
    }

    const now = Date.now();
    return Array.from(userDevices.entries()).map(([fingerprint, metadata]) => ({
      fingerprint,
      ...metadata,
      online: now - metadata.lastSeenAt <= this.staleThresholdMs
    }));
  }

  cleanup() {
    const now = Date.now();

    for (const [userId, userDevices] of this.activeDevices.entries()) {
      for (const [fingerprint, metadata] of userDevices.entries()) {
        if (!metadata?.lastSeenAt || now - metadata.lastSeenAt > this.staleThresholdMs) {
          userDevices.delete(fingerprint);
        }
      }

      if (userDevices.size === 0) {
        this.activeDevices.delete(userId);
      }
    }
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = new DeviceTrackingService();
