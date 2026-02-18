const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const LOCALHOST_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1'
]);

// File extensions that indicate static frontend assets (not API calls).
const STATIC_ASSET_RE = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif)(\?|$)/i;

function shouldBypassRateLimit(req) {
  // Only rate-limit API requests. Frontend pages, static assets, and public routes
  // (/sub, /user, /dns-query) should never be rate-limited.
  const url = req.originalUrl || '';
  const isApiRequest = url.includes('/api/');
  if (!isApiRequest) {
    return true;
  }

  const bypassHeader = String(req.headers['x-oneui-e2e-bypass'] || '').trim().toLowerCase();
  if (bypassHeader !== '1' && bypassHeader !== 'true') {
    return false;
  }

  const requestIp = String(req.ip || req.connection?.remoteAddress || '').trim();
  return LOCALHOST_IPS.has(requestIp);
}

const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  skip: shouldBypassRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  skip: shouldBypassRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts, please try again later',
    code: 'AUTH_RATE_LIMIT_EXCEEDED'
  }
});

const refreshLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_REFRESH_RATE_LIMIT_MAX,
  skip: shouldBypassRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many refresh requests, please try again later',
    code: 'AUTH_REFRESH_RATE_LIMIT_EXCEEDED'
  }
});

const profileLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_PROFILE_RATE_LIMIT_MAX,
  skip: shouldBypassRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many profile security updates, please try again later',
    code: 'AUTH_PROFILE_RATE_LIMIT_EXCEEDED'
  }
});

const subscriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skip: shouldBypassRateLimit,
  message: 'Too many subscription requests, please try again later',
  keyGenerator: (req) => {
    return req.params.token || req.ip;
  }
});

const realityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: shouldBypassRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many reality utility requests, please try again later',
    code: 'REALITY_RATE_LIMIT_EXCEEDED'
  }
});

const xrayUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  skip: shouldBypassRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many xray update operations, please try again later',
    code: 'XRAY_UPDATE_RATE_LIMIT_EXCEEDED'
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  refreshLimiter,
  profileLimiter,
  subscriptionLimiter,
  realityLimiter,
  xrayUpdateLimiter
};
