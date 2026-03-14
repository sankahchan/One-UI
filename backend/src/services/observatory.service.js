const logger = require('../config/logger');

class ObservatoryService {
  constructor() {
    this._cache = null;
    this._cacheExpiry = 0;
    this._cacheTtlMs = 10_000;
  }

  async getStatus() {
    const now = Date.now();
    if (this._cache && now < this._cacheExpiry) {
      return this._cache;
    }

    try {
      const apiUrl = process.env.XRAY_API_URL || 'http://127.0.0.1:10085';
      const response = await fetch(`${apiUrl}/v1/observatory/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        logger.debug('Observatory API returned non-OK status', { status: response.status });
        return this._fallback();
      }

      const data = await response.json();
      const results = this._parseResults(data);
      this._cache = results;
      this._cacheExpiry = now + this._cacheTtlMs;
      return results;
    } catch (error) {
      logger.debug('Observatory query failed', { error: error?.message });
      return this._fallback();
    }
  }

  _parseResults(data) {
    // Xray observatory returns { status: { outbound_status: [...] } }
    const statuses = data?.status?.outbound_status || data?.outbound_status || [];
    return {
      enabled: true,
      outbounds: statuses.map((entry) => ({
        tag: entry.outbound_tag || entry.tag || 'unknown',
        alive: entry.alive ?? true,
        delay: entry.delay ?? 0,
        lastSeenTime: entry.last_seen_time || entry.lastSeenTime || null,
        lastTryTime: entry.last_try_time || entry.lastTryTime || null,
        lastErrorReason: entry.last_error_reason || entry.lastErrorReason || null
      }))
    };
  }

  _fallback() {
    const enabled = String(process.env.XRAY_OBSERVATORY_ENABLED || 'false').toLowerCase() === 'true';
    return { enabled, outbounds: [] };
  }
}

module.exports = new ObservatoryService();
