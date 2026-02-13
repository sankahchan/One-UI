const ApiResponse = require('../utils/response');
const env = require('../config/env');
const securityRulesService = require('../services/securityRules.service');
const { normalizeClientIp } = require('../utils/network');

const BYPASS_PREFIXES = [
  '/api/system/health',
  '/api/system/metrics',
  '/api/system/alerts/webhook',
  '/api/auth/login',
  '/api/settings/security/rules'
];

function shouldBypass(pathname = '') {
  return BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isLocalAddress(ipAddress) {
  return ['127.0.0.1', '::1', 'localhost'].includes(normalizeClientIp(ipAddress));
}

async function applySecurityRules(req, res, next) {
  try {
    if (!env.SECURITY_RULES_ENABLED) {
      return next();
    }

    if (shouldBypass(req.path || '')) {
      return next();
    }

    if (env.NODE_ENV !== 'production' && isLocalAddress(req.ip)) {
      return next();
    }

    const evaluation = await securityRulesService.evaluateRequest(req);
    req.securityRuleContext = evaluation;

    if (evaluation.allowed) {
      return next();
    }

    return res.status(403).json(
      ApiResponse.error(
        'Request blocked by security policy',
        'SECURITY_RULE_BLOCKED',
        {
          ruleId: evaluation.matchedRule?.id || null,
          ruleName: evaluation.matchedRule?.name || null,
          targetType: evaluation.matchedRule?.targetType || null
        }
      )
    );
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  applySecurityRules
};
