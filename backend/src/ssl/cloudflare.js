const env = require('../config/env');

class CloudflareClient {
  constructor() {
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
  }

  getHeaders() {
    if (env.CLOUDFLARE_API_TOKEN) {
      return {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      };
    }

    if (env.CLOUDFLARE_ACCOUNT_EMAIL && env.CLOUDFLARE_API_KEY) {
      return {
        'X-Auth-Email': env.CLOUDFLARE_ACCOUNT_EMAIL,
        'X-Auth-Key': env.CLOUDFLARE_API_KEY,
        'Content-Type': 'application/json'
      };
    }

    throw new Error('Cloudflare API credentials are missing');
  }

  async request(method, path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json();

    if (!response.ok || payload.success === false) {
      const message = payload?.errors?.[0]?.message || `Cloudflare API request failed (${response.status})`;
      throw new Error(message);
    }

    return payload.result;
  }

  async getZoneDetails(zoneId = env.CLOUDFLARE_ZONE_ID) {
    if (!zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID is required');
    }

    return this.request('GET', `/zones/${zoneId}`);
  }

  async listDnsRecords({
    zoneId = env.CLOUDFLARE_ZONE_ID,
    type,
    name
  } = {}) {
    if (!zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID is required');
    }

    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (name) params.set('name', name);

    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request('GET', `/zones/${zoneId}/dns_records${suffix}`);
  }

  async upsertTxtRecord({
    zoneId = env.CLOUDFLARE_ZONE_ID,
    name,
    content,
    ttl = 120
  }) {
    if (!zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID is required');
    }

    const existing = await this.listDnsRecords({ zoneId, type: 'TXT', name });

    if (existing.length > 0) {
      const record = existing[0];
      return this.request('PUT', `/zones/${zoneId}/dns_records/${record.id}`, {
        type: 'TXT',
        name,
        content,
        ttl
      });
    }

    return this.request('POST', `/zones/${zoneId}/dns_records`, {
      type: 'TXT',
      name,
      content,
      ttl
    });
  }

  async deleteRecord(recordId, zoneId = env.CLOUDFLARE_ZONE_ID) {
    if (!zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID is required');
    }

    return this.request('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }
}

module.exports = new CloudflareClient();
