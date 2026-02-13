const prisma = require('../config/database');
const logger = require('../config/logger');
const { normalizeClientIp, isIpv4InCidr } = require('../utils/network');

const COUNTRY_HEADER_KEYS = [
  'cf-ipcountry',
  'x-country-code',
  'x-vercel-ip-country',
  'x-geo-country'
];

function normalizeCountryCode(rawValue) {
  const code = String(rawValue || '')
    .trim()
    .toUpperCase();

  if (!code || code.length !== 2) {
    return '';
  }

  return code;
}

function pickClientCountry(req) {
  for (const headerKey of COUNTRY_HEADER_KEYS) {
    const value = req.headers?.[headerKey];
    const normalized = normalizeCountryCode(Array.isArray(value) ? value[0] : value);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

class SecurityRulesService {
  constructor() {
    this.cacheTtlMs = 5_000;
    this.rulesCache = [];
    this.lastLoadedAt = 0;
  }

  async loadRules({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - this.lastLoadedAt < this.cacheTtlMs) {
      return this.rulesCache;
    }

    const rules = await prisma.securityRule.findMany({
      where: {
        enabled: true
      },
      orderBy: [
        { priority: 'asc' },
        { id: 'asc' }
      ]
    });

    this.rulesCache = rules;
    this.lastLoadedAt = now;
    return rules;
  }

  clearCache() {
    this.rulesCache = [];
    this.lastLoadedAt = 0;
  }

  normalizeInput(payload = {}) {
    const targetType = String(payload.targetType || '').toUpperCase();
    let targetValue = String(payload.targetValue || '').trim();
    const action = String(payload.action || '').toUpperCase();

    if (targetType === 'COUNTRY') {
      targetValue = normalizeCountryCode(targetValue);
    }

    return {
      name: String(payload.name || '').trim(),
      enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
      action,
      targetType,
      targetValue,
      priority: Number.parseInt(String(payload.priority ?? 100), 10) || 100,
      note: payload.note ? String(payload.note).trim() : null
    };
  }

  validateNormalizedInput(input) {
    if (!input.name) {
      throw new Error('Rule name is required');
    }
    if (!['ALLOW', 'BLOCK'].includes(input.action)) {
      throw new Error('action must be ALLOW or BLOCK');
    }
    if (!['IP', 'CIDR', 'COUNTRY'].includes(input.targetType)) {
      throw new Error('targetType must be IP, CIDR, or COUNTRY');
    }
    if (!input.targetValue) {
      throw new Error('targetValue is required');
    }
    if (input.targetType === 'COUNTRY' && input.targetValue.length !== 2) {
      throw new Error('country targetValue must be a 2-letter ISO code');
    }
    if (input.targetType === 'CIDR' && !input.targetValue.includes('/')) {
      throw new Error('CIDR targetValue must include mask, e.g. 10.0.0.0/8');
    }
  }

  matchesRule(rule, context) {
    const targetValue = String(rule.targetValue || '').trim();
    if (!targetValue) {
      return false;
    }

    if (rule.targetType === 'IP') {
      return context.ip === targetValue;
    }

    if (rule.targetType === 'CIDR') {
      return isIpv4InCidr(context.ip, targetValue);
    }

    if (rule.targetType === 'COUNTRY') {
      return context.country && normalizeCountryCode(targetValue) === context.country;
    }

    return false;
  }

  async recordMatch(ruleId) {
    try {
      await prisma.securityRule.update({
        where: { id: ruleId },
        data: {
          hitCount: {
            increment: 1
          },
          lastMatchedAt: new Date()
        }
      });
    } catch (error) {
      logger.warn('Failed to update security rule hit count', {
        ruleId,
        message: error.message
      });
    }
  }

  async evaluateRequest(req, { useCache = true } = {}) {
    const ip = normalizeClientIp(req.ip || '');
    const country = pickClientCountry(req);

    if (!ip) {
      return {
        allowed: true,
        reason: 'No client IP resolved',
        matchedRule: null,
        context: { ip: '', country }
      };
    }

    const rules = useCache ? await this.loadRules() : await this.loadRules({ force: true });
    const context = { ip, country };

    for (const rule of rules) {
      if (!this.matchesRule(rule, context)) {
        continue;
      }

      void this.recordMatch(rule.id);
      const allowed = rule.action === 'ALLOW';
      return {
        allowed,
        reason: `${rule.action} rule matched`,
        matchedRule: rule,
        context
      };
    }

    return {
      allowed: true,
      reason: 'No matching rule',
      matchedRule: null,
      context
    };
  }

  async listRules() {
    return prisma.securityRule.findMany({
      orderBy: [
        { priority: 'asc' },
        { id: 'asc' }
      ]
    });
  }

  async createRule(payload = {}) {
    const normalized = this.normalizeInput(payload);
    this.validateNormalizedInput(normalized);

    const created = await prisma.securityRule.create({
      data: normalized
    });

    this.clearCache();
    return created;
  }

  async updateRule(id, payload = {}) {
    const current = await prisma.securityRule.findUnique({
      where: { id: Number(id) }
    });
    if (!current) {
      throw new Error('Security rule not found');
    }

    const merged = this.normalizeInput({
      ...current,
      ...payload
    });
    this.validateNormalizedInput(merged);

    const updated = await prisma.securityRule.update({
      where: { id: Number(id) },
      data: merged
    });

    this.clearCache();
    return updated;
  }

  async deleteRule(id) {
    const removed = await prisma.securityRule.delete({
      where: { id: Number(id) }
    });
    this.clearCache();
    return removed;
  }

  async toggleRule(id, enabled) {
    const updated = await prisma.securityRule.update({
      where: { id: Number(id) },
      data: {
        enabled: Boolean(enabled)
      }
    });
    this.clearCache();
    return updated;
  }
}

module.exports = new SecurityRulesService();
