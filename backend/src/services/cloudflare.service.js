const axios = require('axios');

const env = require('../config/env');
const logger = require('../config/logger');

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

class CloudflareService {
  constructor() {
    this.client = axios.create({
      baseURL: CLOUDFLARE_API_BASE,
      timeout: 15000
    });
  }

  getAuthHeaders() {
    if (env.CLOUDFLARE_API_TOKEN) {
      return {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`
      };
    }

    if (env.CLOUDFLARE_API_KEY && (env.CLOUDFLARE_EMAIL || env.CLOUDFLARE_ACCOUNT_EMAIL)) {
      return {
        'X-Auth-Key': env.CLOUDFLARE_API_KEY,
        'X-Auth-Email': env.CLOUDFLARE_EMAIL || env.CLOUDFLARE_ACCOUNT_EMAIL
      };
    }

    throw new Error('Cloudflare credentials are not configured');
  }

  async request(method, path, { params, data } = {}) {
    try {
      const response = await this.client.request({
        method,
        url: path,
        params,
        data,
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (!response?.data?.success) {
        const firstError = response?.data?.errors?.[0];
        const message = firstError?.message || 'Cloudflare API request failed';
        throw new Error(message);
      }

      return response.data.result;
    } catch (error) {
      const message = error?.response?.data?.errors?.[0]?.message || error.message || 'Cloudflare request failed';
      logger.error('Cloudflare request failed', {
        method,
        path,
        message
      });
      throw new Error(message);
    }
  }

  normalizeDomain(value = '') {
    return String(value || '').trim().toLowerCase().replace(/\.+$/, '');
  }

  parseCandidates(domain) {
    const normalized = this.normalizeDomain(domain);
    const labels = normalized.split('.').filter(Boolean);
    const candidates = [];

    for (let index = 0; index < labels.length - 1; index += 1) {
      const candidate = labels.slice(index).join('.');
      if (candidate) {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  async findZoneByName(zoneName) {
    const zones = await this.request('GET', '/zones', {
      params: {
        name: zoneName,
        status: 'active',
        per_page: 1
      }
    });

    if (!Array.isArray(zones) || zones.length === 0) {
      return null;
    }

    return zones[0];
  }

  async resolveZone({ domain, zoneId } = {}) {
    if (zoneId) {
      return this.request('GET', `/zones/${zoneId}`);
    }

    if (env.CLOUDFLARE_ZONE_ID) {
      return this.request('GET', `/zones/${env.CLOUDFLARE_ZONE_ID}`);
    }

    const normalizedDomain = this.normalizeDomain(domain);
    if (!normalizedDomain) {
      throw new Error('domain or zoneId is required');
    }

    const candidates = this.parseCandidates(normalizedDomain);
    for (const candidate of candidates) {
      const zone = await this.findZoneByName(candidate);
      if (zone) {
        return zone;
      }
    }

    throw new Error(`No active Cloudflare zone found for ${normalizedDomain}`);
  }

  async ensureRecord(domain, type = 'A', content, proxied = true) {
    const recordName = this.normalizeDomain(domain);
    const normalizedType = String(type || '').trim().toUpperCase();
    const normalizedContent = String(content || '').trim();

    if (!recordName || !normalizedType || !normalizedContent) {
      throw new Error('domain, type, and content are required');
    }

    const zone = await this.resolveZone({ domain: recordName });
    const canProxy = ['A', 'AAAA', 'CNAME'].includes(normalizedType);
    const proxiedValue = canProxy ? Boolean(proxied) : false;

    const records = await this.request('GET', `/zones/${zone.id}/dns_records`, {
      params: {
        name: recordName,
        type: normalizedType,
        per_page: 1
      }
    });

    if (Array.isArray(records) && records.length > 0) {
      const existing = records[0];
      const shouldUpdate = existing.content !== normalizedContent || Boolean(existing.proxied) !== proxiedValue;

      if (!shouldUpdate) {
        return {
          id: existing.id,
          zoneId: zone.id,
          zoneName: zone.name,
          action: 'unchanged',
          name: existing.name,
          type: existing.type,
          content: existing.content,
          proxied: Boolean(existing.proxied)
        };
      }

      const updated = await this.request('PUT', `/zones/${zone.id}/dns_records/${existing.id}`, {
        data: {
          type: normalizedType,
          name: recordName,
          content: normalizedContent,
          ttl: 1,
          proxied: proxiedValue
        }
      });

      return {
        id: updated.id,
        zoneId: zone.id,
        zoneName: zone.name,
        action: 'updated',
        name: updated.name,
        type: updated.type,
        content: updated.content,
        proxied: Boolean(updated.proxied)
      };
    }

    const created = await this.request('POST', `/zones/${zone.id}/dns_records`, {
      data: {
        type: normalizedType,
        name: recordName,
        content: normalizedContent,
        ttl: 1,
        proxied: proxiedValue
      }
    });

    return {
      id: created.id,
      zoneId: zone.id,
      zoneName: zone.name,
      action: 'created',
      name: created.name,
      type: created.type,
      content: created.content,
      proxied: Boolean(created.proxied)
    };
  }

  async setWebSockets({ zoneId, domain, enabled = true } = {}) {
    const zone = await this.resolveZone({ zoneId, domain });
    const value = enabled ? 'on' : 'off';

    const result = await this.request('PATCH', `/zones/${zone.id}/settings/websockets`, {
      data: { value }
    });

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      value: result?.value || value
    };
  }

  async setSslMode({ zoneId, domain, mode = 'full' } = {}) {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    const allowedModes = new Set(['off', 'flexible', 'full', 'strict', 'full_strict']);
    if (!allowedModes.has(normalizedMode)) {
      throw new Error('Invalid SSL mode. Allowed: off, flexible, full, strict, full_strict');
    }

    const value = normalizedMode === 'strict' ? 'full_strict' : normalizedMode;
    const zone = await this.resolveZone({ zoneId, domain });

    const result = await this.request('PATCH', `/zones/${zone.id}/settings/ssl`, {
      data: { value }
    });

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      value: result?.value || value
    };
  }
}

module.exports = new CloudflareService();
