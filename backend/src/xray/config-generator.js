const fs = require('node:fs').promises;
const path = require('node:path');

const vlessProtocol = require('./protocols/vless');
const vmessProtocol = require('./protocols/vmess');
const trojanProtocol = require('./protocols/trojan');
const shadowsocksProtocol = require('./protocols/shadowsocks');
const socksProtocol = require('./protocols/socks');
const httpProtocol = require('./protocols/http');
const dokodemoDoorProtocol = require('./protocols/dokodemo-door');
const realityProtocol = require('./protocols/reality');
const wireguardProtocol = require('./protocols/wireguard');
const mtprotoProtocol = require('./protocols/mtproto');
const warpProtocol = require('./protocols/warp');
const xrayRoutingService = require('../services/xrayRouting.service');

const prisma = require('../config/database');

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value).trim().toLowerCase() === 'true';
}

function parseListValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueList(values) {
  return Array.from(new Set(values));
}

class XrayConfigGenerator {
  constructor() {
    this.configPath = process.env.XRAY_CONFIG_PATH || '/etc/xray/config.json';
    this.templatePath = path.resolve(__dirname, 'templates', 'base-config.json');
    this.confDirPath = process.env.XRAY_CONF_DIR || '/etc/xray/conf.d';
    this.wireguardOutbounds = []; // Store WG outbounds separately
  }

  resolveApiServices(existingServices = []) {
    const defaults = ['StatsService'];
    const configured = parseListValue(process.env.XRAY_API_SERVICES);
    const merged = uniqueList([
      ...defaults,
      ...(Array.isArray(existingServices) ? existingServices : []),
      ...configured
    ]);

    return merged.length > 0 ? merged : defaults;
  }

  buildObservabilityConfig() {
    const enabled = parseBooleanFlag(process.env.XRAY_OBSERVATORY_ENABLED, false);
    if (!enabled) {
      return null;
    }

    const selectors = parseListValue(process.env.XRAY_OBSERVATORY_SELECTORS);
    const subjectSelector = selectors.length > 0 ? selectors : ['proxy'];
    const probeUrl = process.env.XRAY_OBSERVATORY_PROBE_URL || 'https://www.gstatic.com/generate_204';
    const probeInterval = process.env.XRAY_OBSERVATORY_PROBE_INTERVAL || '1m';

    return {
      observatory: {
        subjectSelector,
        probeUrl,
        probeInterval
      }
    };
  }

  buildBalancerConfig() {
    const enabled = parseBooleanFlag(process.env.XRAY_BALANCER_ENABLED, false);
    if (!enabled) {
      return null;
    }

    const selectors = parseListValue(process.env.XRAY_BALANCER_SELECTORS);
    const balancerSelector = selectors.length > 0 ? selectors : ['proxy'];
    const strategy = process.env.XRAY_BALANCER_STRATEGY || 'leastPing';
    const balancerTag = process.env.XRAY_BALANCER_TAG || 'auto-balance';
    const inboundTags = parseListValue(process.env.XRAY_BALANCER_INBOUND_TAGS);

    return {
      balancer: {
        tag: balancerTag,
        selector: balancerSelector,
        strategy: { type: strategy }
      },
      rule: inboundTags.length > 0
        ? {
            type: 'field',
            inboundTag: inboundTags,
            balancerTag
          }
        : null
    };
  }

  async loadBaseConfig() {
    try {
      const content = await fs.readFile(this.templatePath, 'utf8');
      return JSON.parse(content);
    } catch (_error) {
      return {
        log: {
          loglevel: process.env.XRAY_LOG_LEVEL || 'warning',
          access: '/var/log/xray/access.log',
          error: '/var/log/xray/error.log'
        },
        api: {
          tag: 'api',
          services: ['StatsService']
        },
        stats: {},
        policy: {
          levels: {
            0: {
              statsUserUplink: true,
              statsUserDownlink: true
            }
          },
          system: {
            statsInboundUplink: true,
            statsInboundDownlink: true
          }
        },
        inbounds: [],
        outbounds: [
          {
            protocol: 'freedom',
            tag: 'direct',
            settings: {}
          },
          {
            protocol: 'blackhole',
            tag: 'blocked',
            settings: {}
          },
          {
            protocol: 'freedom',
            tag: 'api',
            settings: {}
          }
        ],
        routing: {
          domainStrategy: 'IPIfNonMatch',
          rules: []
        }
      };
    }
  }

  buildConfDirEntries(config) {
    const entries = [
      ['one-ui-00-log.json', { log: config.log || {} }],
      [
        'one-ui-10-api-policy.json',
        {
          api: config.api || {},
          stats: config.stats || {},
          policy: config.policy || {}
        }
      ],
      ['one-ui-20-inbounds.json', { inbounds: config.inbounds || [] }],
      ['one-ui-30-outbounds.json', { outbounds: config.outbounds || [] }],
      ['one-ui-40-routing.json', { routing: config.routing || {} }]
    ];

    if (config.observatory) {
      entries.push(['one-ui-50-observatory.json', { observatory: config.observatory }]);
    }

    return entries;
  }

  async saveConfigDirectory(config, directory = this.confDirPath) {
    await fs.mkdir(directory, { recursive: true });
    const files = [];
    const entries = this.buildConfDirEntries(config);

    for (const [fileName, payload] of entries) {
      const fullPath = path.join(directory, fileName);
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      files.push({
        name: fileName,
        path: fullPath
      });
    }

    return {
      directory,
      files
    };
  }

  async listConfigDirectory(directory = this.confDirPath) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue;
        }
        const fullPath = path.join(directory, entry.name);
        // eslint-disable-next-line no-await-in-loop
        const stat = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        });
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      return {
        directory,
        files
      };
    } catch (_error) {
      return {
        directory,
        files: []
      };
    }
  }

  async generateConfig() {
    const inbounds = await prisma.inbound.findMany({
      where: { enabled: true },
      include: {
        userInbounds: {
          where: {
            enabled: true,
            user: {
              status: 'ACTIVE'
            }
          },
          include: {
            user: true
          }
        },
        groupInbounds: {
          where: {
            enabled: true,
            group: {
              isDisabled: false
            }
          },
          include: {
            group: {
              include: {
                users: {
                  where: {
                    user: {
                      status: 'ACTIVE'
                    }
                  },
                  include: {
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    const inboundConfigs = [];
    this.wireguardOutbounds = [];
    const additionalRules = [];

    for (const inbound of inbounds) {
      const effectiveUserInbounds = [];
      const seenUserIds = new Set();

      for (const relation of inbound.userInbounds || []) {
        const user = relation.user;
        if (!user || seenUserIds.has(user.id)) {
          continue;
        }

        effectiveUserInbounds.push(relation);
        seenUserIds.add(user.id);
      }

      for (const relation of inbound.groupInbounds || []) {
        const groupUsers = relation.group?.users || [];
        for (const userGroup of groupUsers) {
          const user = userGroup.user;
          if (!user || seenUserIds.has(user.id)) {
            continue;
          }

          effectiveUserInbounds.push({
            id: `group-${relation.groupId}-${user.id}`,
            inboundId: inbound.id,
            userId: user.id,
            enabled: true,
            user
          });
          seenUserIds.add(user.id);
        }
      }

      const effectiveInbound = {
        ...inbound,
        userInbounds: effectiveUserInbounds
      };

      let inboundConfig;

      // Handle REALITY security with VLESS
      if (inbound.security === 'REALITY' && inbound.protocol === 'VLESS') {
        inboundConfig = realityProtocol.generateInbound(effectiveInbound);
      } else if (inbound.protocol === 'WIREGUARD') {
        // Wireguard creates both inbound and outbound
        const wgConfig = wireguardProtocol.generateInbound(effectiveInbound);
        if (wgConfig) {
          inboundConfigs.push(wgConfig.inbound);
          this.wireguardOutbounds.push(wgConfig.outbound);
          additionalRules.push(wgConfig.routingRule);
        }
        continue;
      } else {
        switch (effectiveInbound.protocol) {
          case 'VLESS':
            inboundConfig = vlessProtocol.generateInbound(effectiveInbound);
            break;
          case 'VMESS':
            inboundConfig = vmessProtocol.generateInbound(effectiveInbound);
            break;
          case 'TROJAN':
            inboundConfig = trojanProtocol.generateInbound(effectiveInbound);
            break;
          case 'SHADOWSOCKS':
            inboundConfig = shadowsocksProtocol.generateInbound(effectiveInbound);
            break;
          case 'SOCKS':
            inboundConfig = socksProtocol.generateInbound(effectiveInbound);
            break;
          case 'HTTP':
            inboundConfig = httpProtocol.generateInbound(effectiveInbound);
            break;
          case 'DOKODEMO_DOOR':
            inboundConfig = dokodemoDoorProtocol.generateInbound(effectiveInbound);
            break;
          case 'MTPROTO':
            inboundConfig = mtprotoProtocol.generateInbound(effectiveInbound);
            break;
          default:
            continue;
        }
      }

      if (inboundConfig) {
        inboundConfigs.push(inboundConfig);
      }
    }

    const config = await this.loadBaseConfig();
    const routingProfile = await xrayRoutingService.getProfile();
    const managedRoutingRules = xrayRoutingService.generateRules(routingProfile);

    config.log = {
      ...config.log,
      loglevel: process.env.XRAY_LOG_LEVEL || config.log?.loglevel || 'warning'
    };

    config.api = {
      ...(config.api || {}),
      tag: config.api?.tag || 'api',
      services: this.resolveApiServices(config.api?.services)
    };

    config.inbounds = [
      ...inboundConfigs,
      {
        listen: '127.0.0.1',
        port: 10085,
        protocol: 'dokodemo-door',
        settings: {
          address: '127.0.0.1'
        },
        tag: 'api'
      }
    ];

    if (this.wireguardOutbounds.length > 0) {
      config.outbounds = [...(config.outbounds || []), ...this.wireguardOutbounds];
    }

    const existingOutbounds = Array.isArray(config.outbounds) ? config.outbounds : [];
    const hasApiOutbound = existingOutbounds.some((outbound) => outbound?.tag === 'api');
    if (!hasApiOutbound) {
      existingOutbounds.push({
        protocol: 'freedom',
        tag: 'api',
        settings: {}
      });
      config.outbounds = existingOutbounds;
    }

    config.routing = config.routing || {};
    const baseRulesRaw = Array.isArray(config.routing.rules) ? config.routing.rules : [];
    const mergedRules = [...additionalRules, ...managedRoutingRules, ...baseRulesRaw];
    const seenRuleFingerprints = new Set();
    const baseRules = mergedRules.filter((rule) => {
      const fingerprint = JSON.stringify(rule || {});
      if (seenRuleFingerprints.has(fingerprint)) {
        return false;
      }
      seenRuleFingerprints.add(fingerprint);
      return true;
    });
    const hasApiRule = baseRules.some(
      (rule) => rule?.outboundTag === 'api' && Array.isArray(rule?.inboundTag) && rule.inboundTag.includes('api')
    );
    if (!hasApiRule) {
      baseRules.unshift({
        type: 'field',
        inboundTag: ['api'],
        outboundTag: 'api'
      });
    }
    config.routing.rules = baseRules;

    const observabilityConfig = this.buildObservabilityConfig();
    if (observabilityConfig) {
      config.observatory = observabilityConfig.observatory;
    }

    const balancerConfig = this.buildBalancerConfig();
    if (balancerConfig) {
      config.routing = config.routing || {};
      const existingBalancers = Array.isArray(config.routing.balancers) ? config.routing.balancers : [];
      const balancers = existingBalancers.filter((entry) => entry.tag !== balancerConfig.balancer.tag);
      balancers.push(balancerConfig.balancer);
      config.routing.balancers = balancers;

      if (balancerConfig.rule) {
        const rules = Array.isArray(config.routing.rules) ? config.routing.rules : [];
        const dedupedRules = rules.filter((rule) => rule.balancerTag !== balancerConfig.balancer.tag);
        config.routing.rules = [balancerConfig.rule, ...dedupedRules];
      }
    }

    // Add WARP outbound if enabled
    if (process.env.WARP_ENABLED === 'true') {
      const warpConfig = warpProtocol.generateOutbound({
        enabled: true,
        privateKey: process.env.WARP_PRIVATE_KEY,
        address: process.env.WARP_ADDRESS
      });
      if (warpConfig) {
        config.outbounds.push(warpConfig);

        // Add routing rule
        const warpRule = warpProtocol.generateRoutingRule({ enabled: true });
        if (warpRule && config.routing && config.routing.rules) {
          config.routing.rules.unshift(warpRule);
        }
      }
    }

    return config;
  }

  async saveConfig(config) {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    const configJson = JSON.stringify(config, null, 2);
    await fs.writeFile(this.configPath, configJson, 'utf8');
    return this.configPath;
  }

  async reloadConfig() {
    const config = await this.generateConfig();
    await this.saveConfig(config);
    return config;
  }
}

module.exports = new XrayConfigGenerator();
