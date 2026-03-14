const fs = require('node:fs').promises;
const path = require('node:path');
const logger = require('../config/logger');

const DNS_CONFIG_PATH = process.env.DNS_CONFIG_PATH || path.resolve(process.cwd(), 'runtime', 'dns-config.json');

const DEFAULT_CONFIG = {
  enabled: false,
  servers: [
    { address: '8.8.8.8', port: 53, domains: [], expectIPs: [] },
    { address: '1.1.1.1', port: 53, domains: [], expectIPs: [] }
  ],
  hosts: {},
  clientIp: '',
  queryStrategy: 'UseIP',
  disableCache: false,
  disableFallback: false,
  tag: 'dns-inbound'
};

class DnsConfigService {
  constructor() {
    this._config = null;
  }

  async getConfig() {
    if (this._config) return { ...this._config };

    try {
      const raw = await fs.readFile(DNS_CONFIG_PATH, 'utf8');
      this._config = JSON.parse(raw);
      return { ...this._config };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async setConfig(data) {
    const current = await this.getConfig();
    const updated = {
      ...current,
      ...data,
      servers: data.servers ?? current.servers,
      hosts: data.hosts ?? current.hosts
    };

    // Validate
    if (!Array.isArray(updated.servers)) {
      throw new Error('servers must be an array');
    }
    if (!['UseIP', 'UseIPv4', 'UseIPv6'].includes(updated.queryStrategy)) {
      updated.queryStrategy = 'UseIP';
    }

    await fs.mkdir(path.dirname(DNS_CONFIG_PATH), { recursive: true });
    await fs.writeFile(DNS_CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
    this._config = updated;
    logger.info('DNS config updated', { enabled: updated.enabled, serverCount: updated.servers.length });
    return { ...updated };
  }

  toXrayDnsBlock(config) {
    if (!config || !config.enabled) return null;

    const block = {};

    if (config.servers?.length) {
      block.servers = config.servers.map((srv) => {
        if (!srv.domains?.length && !srv.expectIPs?.length) {
          return srv.address;
        }
        const entry = { address: srv.address };
        if (srv.port && srv.port !== 53) entry.port = srv.port;
        if (srv.domains?.length) entry.domains = srv.domains;
        if (srv.expectIPs?.length) entry.expectIPs = srv.expectIPs;
        return entry;
      });
    }

    if (config.hosts && Object.keys(config.hosts).length) {
      block.hosts = config.hosts;
    }
    if (config.clientIp) block.clientIp = config.clientIp;
    if (config.queryStrategy && config.queryStrategy !== 'UseIP') {
      block.queryStrategy = config.queryStrategy;
    }
    if (config.disableCache) block.disableCache = true;
    if (config.disableFallback) block.disableFallback = true;
    if (config.tag) block.tag = config.tag;

    return block;
  }
}

module.exports = new DnsConfigService();
