const fs = require('node:fs').promises;
const path = require('node:path');

const logger = require('../config/logger');
const { ValidationError } = require('../utils/errors');

const DEFAULT_DOMESTIC_IPS = ['geoip:cn', 'geoip:ir', 'geoip:ru'];
const DEFAULT_DOMESTIC_DOMAINS = ['geosite:cn', 'geosite:ir', 'geosite:ru'];
const ALLOWED_MODES = new Set(['smart', 'filtered', 'strict', 'open']);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeStringList(value, fallback = []) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
      )
    );
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
  }

  return [...fallback];
}

class XrayRoutingService {
  constructor() {
    this.profilePath = process.env.XRAY_ROUTING_PROFILE_PATH
      ? path.resolve(process.env.XRAY_ROUTING_PROFILE_PATH)
      : path.resolve(process.cwd(), 'runtime', 'xray-routing-profile.json');
  }

  getDefaultProfile() {
    const configuredMode = String(process.env.XRAY_ROUTING_MODE || 'smart').trim().toLowerCase();
    const mode = ALLOWED_MODES.has(configuredMode) ? configuredMode : 'smart';

    return {
      mode,
      blockPrivate: parseBoolean(process.env.XRAY_ROUTING_BLOCK_PRIVATE, true),
      blockBitTorrent: parseBoolean(process.env.XRAY_ROUTING_BLOCK_BITTORRENT, true),
      domesticIps: normalizeStringList(process.env.XRAY_ROUTING_DOMESTIC_IPS, DEFAULT_DOMESTIC_IPS),
      domesticDomains: normalizeStringList(process.env.XRAY_ROUTING_DOMESTIC_DOMAINS, DEFAULT_DOMESTIC_DOMAINS)
    };
  }

  normalizeProfile(input = {}, base = this.getDefaultProfile()) {
    const normalized = {
      mode: String(input.mode ?? base.mode).trim().toLowerCase(),
      blockPrivate: parseBoolean(input.blockPrivate, base.blockPrivate),
      blockBitTorrent: parseBoolean(input.blockBitTorrent, base.blockBitTorrent),
      domesticIps: normalizeStringList(input.domesticIps, base.domesticIps),
      domesticDomains: normalizeStringList(input.domesticDomains, base.domesticDomains)
    };

    if (!ALLOWED_MODES.has(normalized.mode)) {
      throw new ValidationError(`mode must be one of: ${Array.from(ALLOWED_MODES).join(', ')}`);
    }

    return normalized;
  }

  async readStoredProfile() {
    try {
      const raw = await fs.readFile(this.profilePath, 'utf8');
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  async getProfile() {
    const defaults = this.getDefaultProfile();
    const stored = await this.readStoredProfile();
    if (!stored || typeof stored !== 'object') {
      return defaults;
    }

    try {
      return this.normalizeProfile(stored, defaults);
    } catch (error) {
      logger.warn('Invalid persisted Xray routing profile. Falling back to defaults.', {
        message: error.message
      });
      return defaults;
    }
  }

  async setProfile(payload = {}) {
    const current = await this.getProfile();
    const next = this.normalizeProfile(payload, current);
    await fs.mkdir(path.dirname(this.profilePath), { recursive: true });
    await fs.writeFile(this.profilePath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  generateRules(profileInput = null) {
    const profile = profileInput ? this.normalizeProfile(profileInput, this.getDefaultProfile()) : this.getDefaultProfile();
    const rules = [];

    if (profile.blockPrivate) {
      rules.push({
        type: 'field',
        ip: ['geoip:private'],
        outboundTag: 'blocked'
      });
    }

    if (profile.blockBitTorrent) {
      rules.push({
        type: 'field',
        protocol: ['bittorrent'],
        outboundTag: 'blocked'
      });
    }

    if (profile.mode === 'smart' || profile.mode === 'filtered') {
      if (profile.domesticIps.length > 0) {
        rules.push({
          type: 'field',
          ip: profile.domesticIps,
          outboundTag: 'direct'
        });
      }
      if (profile.domesticDomains.length > 0) {
        rules.push({
          type: 'field',
          domain: profile.domesticDomains,
          outboundTag: 'direct'
        });
      }
    }

    return rules;
  }
}

module.exports = new XrayRoutingService();
