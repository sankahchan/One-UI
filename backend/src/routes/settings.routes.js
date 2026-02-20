const express = require('express');
const { body, param, query } = require('express-validator');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const { authenticate, authorize, requireBearerAuth } = require('../middleware/auth');
const ApiResponse = require('../utils/response');
const validate = require('../middleware/validator');
const authService = require('../services/auth.service');
const webhookService = require('../services/webhook.service');
const { parseAllowlist, isIpAllowed, isPrivateIp } = require('../utils/network');
const securityRulesService = require('../services/securityRules.service');
const securityAuditService = require('../services/securityAudit.service');
const subscriptionBrandingService = require('../services/subscriptionBranding.service');
const { updateEnvValues } = require('../utils/envFile');

const router = express.Router();
const cdnFinderService = require('../services/cdnFinder.service');

const WALLPAPER_UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'branding', 'wallpapers');
const MAX_WALLPAPER_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_WALLPAPER_MIME_EXT = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
});

const wallpaperUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_WALLPAPER_UPLOAD_BYTES
  },
  fileFilter: (_req, file, callback) => {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_WALLPAPER_MIME_EXT, file.mimetype)) {
      callback(new Error('Unsupported image type. Allowed: JPG, PNG, WEBP, GIF'));
      return;
    }
    callback(null, true);
  }
});

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

function logSecurityEvent(req, message, level = 'INFO', metadata = {}) {
  void securityAuditService.log({
    message,
    level,
    metadata: {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      actorId: req.admin?.id || null,
      actorUsername: req.admin?.username || null,
      actorRole: req.admin?.role || null,
      ...metadata
    }
  });
}

function emitSecurityNotification(req, eventName, data = {}) {
  webhookService.emitEvent(
    eventName,
    data,
    {
      actor: {
        id: req.admin?.id || null,
        username: req.admin?.username || null,
        role: req.admin?.role || null
      },
      request: {
        ip: req.ip,
        userAgent: req.get('user-agent') || ''
      }
    }
  );
}

router.post('/cdn-scan', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const results = await cdnFinderService.scan();
    return res.json(ApiResponse.success(results));
  } catch (error) {
    if (error.message === 'Scan already in progress') {
      return res.status(409).json(ApiResponse.error(error.message));
    }
    next(error);
  }
});

const cloudflareService = require('../services/cloudflare.service');

router.post('/cloudflare/dns', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { domain, type, content, proxied } = req.body;
    if (!domain || !type || !content) {
      return res.status(400).json(ApiResponse.error('Missing required fields', 'VALIDATION_ERROR'));
    }

    const result = await cloudflareService.ensureRecord(domain, type, content, proxied);
    return res.json(ApiResponse.success(result));
  } catch (error) {
    next(error);
  }
});

router.post(
  '/cloudflare/websockets',
  authenticate,
  authorize('SUPER_ADMIN'),
  [
    body('zoneId').optional().isString().trim().notEmpty().withMessage('zoneId cannot be empty'),
    body('domain').optional().isString().trim().notEmpty().withMessage('domain cannot be empty'),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
    body().custom((_, { req }) => {
      const hasFallbackZone = Boolean(process.env.CLOUDFLARE_ZONE_ID || '');
      if (!req.body?.zoneId && !req.body?.domain && !hasFallbackZone) {
        throw new Error('zoneId or domain is required');
      }
      return true;
    })
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await cloudflareService.setWebSockets({
        zoneId: req.body?.zoneId,
        domain: req.body?.domain,
        enabled: req.body?.enabled !== false
      });

      return res.json(ApiResponse.success(result, 'Cloudflare WebSockets setting updated'));
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/cloudflare/ssl-mode',
  authenticate,
  authorize('SUPER_ADMIN'),
  [
    body('zoneId').optional().isString().trim().notEmpty().withMessage('zoneId cannot be empty'),
    body('domain').optional().isString().trim().notEmpty().withMessage('domain cannot be empty'),
    body('mode')
      .isString()
      .trim()
      .toLowerCase()
      .isIn(['off', 'flexible', 'full', 'strict', 'full_strict'])
      .withMessage('mode must be one of off, flexible, full, strict, full_strict'),
    body().custom((_, { req }) => {
      const hasFallbackZone = Boolean(process.env.CLOUDFLARE_ZONE_ID || '');
      if (!req.body?.zoneId && !req.body?.domain && !hasFallbackZone) {
        throw new Error('zoneId or domain is required');
      }
      return true;
    })
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await cloudflareService.setSslMode({
        zoneId: req.body?.zoneId,
        domain: req.body?.domain,
        mode: req.body?.mode
      });

      return res.json(ApiResponse.success(result, 'Cloudflare SSL mode updated'));
    } catch (error) {
      return next(error);
    }
  }
);

router.use(requireBearerAuth, authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.get('/security/ip-allowlist', authorize('SUPER_ADMIN'), async (_req, res, next) => {
  try {
    const entries = authService.getAdminIpAllowlist();
    return res.json(
      ApiResponse.success({
        entries,
        raw: entries.join(','),
        count: entries.length,
        requirePrivateIp: authService.isPrivateIpRestrictionEnabled()
      }, 'Admin IP allowlist retrieved')
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/security/policies', authorize('SUPER_ADMIN'), async (_req, res, next) => {
  try {
    const policies = {
      requireTwoFactorForSuperAdmin: authService.isSuperAdmin2FARequired(),
      strictSessionBinding: authService.isStrictSessionBindingEnabled(),
      requirePrivateIp: authService.isPrivateIpRestrictionEnabled(),
      secretsEncryptionConfigured: Boolean(process.env.SECRETS_ENCRYPTION_KEY || ''),
      secretsEncryptionRequired: parseBoolean(process.env.SECRETS_ENCRYPTION_REQUIRED, false)
    };

    return res.json(ApiResponse.success(policies, 'Security policies retrieved'));
  } catch (error) {
    return next(error);
  }
});

router.put(
  '/security/policies',
  authorize('SUPER_ADMIN'),
  [
    body('requireTwoFactorForSuperAdmin')
      .optional()
      .isBoolean()
      .withMessage('requireTwoFactorForSuperAdmin must be boolean')
      .toBoolean(),
    body('strictSessionBinding')
      .optional()
      .isBoolean()
      .withMessage('strictSessionBinding must be boolean')
      .toBoolean(),
    body('requirePrivateIp')
      .optional()
      .isBoolean()
      .withMessage('requirePrivateIp must be boolean')
      .toBoolean(),
    body('secretsEncryptionRequired')
      .optional()
      .isBoolean()
      .withMessage('secretsEncryptionRequired must be boolean')
      .toBoolean()
  ],
  validate,
  async (req, res, next) => {
    try {
      const updates = {};

      if (typeof req.body?.requireTwoFactorForSuperAdmin === 'boolean') {
        updates.AUTH_REQUIRE_2FA_SUPER_ADMIN = String(req.body.requireTwoFactorForSuperAdmin);
      }
      if (typeof req.body?.strictSessionBinding === 'boolean') {
        updates.AUTH_STRICT_SESSION_BINDING = String(req.body.strictSessionBinding);
      }
      if (typeof req.body?.requirePrivateIp === 'boolean') {
        updates.ADMIN_REQUIRE_PRIVATE_IP = String(req.body.requirePrivateIp);
      }
      if (typeof req.body?.secretsEncryptionRequired === 'boolean') {
        updates.SECRETS_ENCRYPTION_REQUIRED = String(req.body.secretsEncryptionRequired);
      }

      if (Object.keys(updates).length > 0) {
        updateEnvValues(updates);
      }

      const policies = {
        requireTwoFactorForSuperAdmin: authService.isSuperAdmin2FARequired(),
        strictSessionBinding: authService.isStrictSessionBindingEnabled(),
        requirePrivateIp: authService.isPrivateIpRestrictionEnabled(),
        secretsEncryptionConfigured: Boolean(process.env.SECRETS_ENCRYPTION_KEY || ''),
        secretsEncryptionRequired: parseBoolean(process.env.SECRETS_ENCRYPTION_REQUIRED, false),
        persistedToEnv: true
      };

      logSecurityEvent(req, 'SECURITY_POLICIES_UPDATED', 'INFO', {
        requireTwoFactorForSuperAdmin: policies.requireTwoFactorForSuperAdmin,
        strictSessionBinding: policies.strictSessionBinding,
        requirePrivateIp: policies.requirePrivateIp,
        secretsEncryptionRequired: policies.secretsEncryptionRequired
      });
      emitSecurityNotification(req, 'security.policy.updated', {
        policies
      });

      return res.json(ApiResponse.success(policies, 'Security policies updated and persisted.'));
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  '/security/ip-allowlist',
  authorize('SUPER_ADMIN'),
  [
    body('allowlist')
      .custom((value) => typeof value === 'string' || Array.isArray(value))
      .withMessage('allowlist must be a comma-separated string or string array'),
    body('forceCurrentIp')
      .optional()
      .isBoolean()
      .withMessage('forceCurrentIp must be boolean')
      .toBoolean(),
    body('requirePrivateIp')
      .optional()
      .isBoolean()
      .withMessage('requirePrivateIp must be boolean')
      .toBoolean()
  ],
  validate,
  async (req, res, next) => {
    try {
      const forceCurrentIp = req.body?.forceCurrentIp === true;
      const requirePrivateIp = parseBoolean(req.body?.requirePrivateIp, authService.isPrivateIpRestrictionEnabled());
      const parsedEntries = parseAllowlist(req.body?.allowlist);

      if (!forceCurrentIp && parsedEntries.length > 0 && !isIpAllowed(req.ip, parsedEntries)) {
        return res.status(400).json(
          ApiResponse.error(
            'Current admin IP is not in allowlist. Add your IP or set forceCurrentIp=true.',
            'IP_ALLOWLIST_BLOCKS_CURRENT_IP'
          )
        );
      }

      if (!forceCurrentIp && requirePrivateIp && !isPrivateIp(req.ip)) {
        return res.status(400).json(
          ApiResponse.error(
            'Current admin IP is not private. Disable requirePrivateIp or set forceCurrentIp=true.',
            'PRIVATE_IP_POLICY_BLOCKS_CURRENT_IP'
          )
        );
      }

      const entries = authService.updateAdminIpAllowlist(parsedEntries);
      updateEnvValues({
        ADMIN_IP_ALLOWLIST: entries.join(','),
        ADMIN_REQUIRE_PRIVATE_IP: String(requirePrivateIp)
      });

      logSecurityEvent(req, 'SECURITY_IP_ALLOWLIST_UPDATED', 'INFO', {
        entryCount: entries.length,
        requirePrivateIp
      });
      emitSecurityNotification(req, 'security.allowlist.updated', {
        entryCount: entries.length,
        requirePrivateIp
      });

      return res.json(
        ApiResponse.success(
          {
            entries,
            raw: entries.join(','),
            count: entries.length,
            requirePrivateIp,
            updatedInMemory: true,
            persistedToEnv: true
          },
          'Admin access policy updated and persisted.'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.get('/security/rules', authorize('SUPER_ADMIN'), async (_req, res, next) => {
  try {
    const rules = await securityRulesService.listRules();
    return res.json(
      ApiResponse.success(
        {
          rules
        },
        'Security rules retrieved'
      )
    );
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/security/rules',
  authorize('SUPER_ADMIN'),
  [
    body('name').isString().trim().notEmpty().withMessage('name is required'),
    body('action').isIn(['ALLOW', 'BLOCK']).withMessage('action must be ALLOW or BLOCK'),
    body('targetType').isIn(['IP', 'CIDR', 'COUNTRY']).withMessage('targetType must be IP, CIDR, or COUNTRY'),
    body('targetValue').isString().trim().notEmpty().withMessage('targetValue is required'),
    body('priority').optional().isInt({ min: 1, max: 10000 }).withMessage('priority must be between 1 and 10000').toInt(),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
    body('note').optional().isString().withMessage('note must be a string')
  ],
  validate,
  async (req, res, next) => {
    try {
      const rule = await securityRulesService.createRule(req.body || {});
      logSecurityEvent(req, 'SECURITY_RULE_CREATED', 'INFO', {
        ruleId: rule.id,
        name: rule.name,
        action: rule.action,
        targetType: rule.targetType,
        targetValue: rule.targetValue,
        priority: rule.priority,
        enabled: rule.enabled
      });
      emitSecurityNotification(req, 'security.rule.created', {
        ruleId: rule.id,
        name: rule.name,
        action: rule.action,
        targetType: rule.targetType,
        targetValue: rule.targetValue,
        priority: rule.priority,
        enabled: rule.enabled
      });
      return res.status(201).json(ApiResponse.success(rule, 'Security rule created'));
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  '/security/rules/:ruleId',
  authorize('SUPER_ADMIN'),
  [
    param('ruleId').isInt({ min: 1 }).withMessage('ruleId must be a positive integer').toInt(),
    body('name').optional().isString().trim().notEmpty().withMessage('name cannot be empty'),
    body('action').optional().isIn(['ALLOW', 'BLOCK']).withMessage('action must be ALLOW or BLOCK'),
    body('targetType').optional().isIn(['IP', 'CIDR', 'COUNTRY']).withMessage('targetType must be IP, CIDR, or COUNTRY'),
    body('targetValue').optional().isString().trim().notEmpty().withMessage('targetValue cannot be empty'),
    body('priority').optional().isInt({ min: 1, max: 10000 }).withMessage('priority must be between 1 and 10000').toInt(),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
    body('note').optional().isString().withMessage('note must be a string')
  ],
  validate,
  async (req, res, next) => {
    try {
      const rule = await securityRulesService.updateRule(req.params.ruleId, req.body || {});
      logSecurityEvent(req, 'SECURITY_RULE_UPDATED', 'INFO', {
        ruleId: rule.id,
        name: rule.name,
        action: rule.action,
        targetType: rule.targetType,
        targetValue: rule.targetValue,
        priority: rule.priority,
        enabled: rule.enabled
      });
      emitSecurityNotification(req, 'security.rule.updated', {
        ruleId: rule.id,
        name: rule.name,
        action: rule.action,
        targetType: rule.targetType,
        targetValue: rule.targetValue,
        priority: rule.priority,
        enabled: rule.enabled
      });
      return res.json(ApiResponse.success(rule, 'Security rule updated'));
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  '/security/rules/:ruleId/enabled',
  authorize('SUPER_ADMIN'),
  [
    param('ruleId').isInt({ min: 1 }).withMessage('ruleId must be a positive integer').toInt(),
    body('enabled').isBoolean().withMessage('enabled must be boolean').toBoolean()
  ],
  validate,
  async (req, res, next) => {
    try {
      const rule = await securityRulesService.toggleRule(req.params.ruleId, req.body.enabled);
      logSecurityEvent(req, 'SECURITY_RULE_TOGGLED', 'INFO', {
        ruleId: rule.id,
        name: rule.name,
        enabled: rule.enabled
      });
      emitSecurityNotification(req, 'security.rule.toggled', {
        ruleId: rule.id,
        name: rule.name,
        enabled: rule.enabled
      });
      return res.json(ApiResponse.success(rule, 'Security rule status updated'));
    } catch (error) {
      return next(error);
    }
  }
);

router.delete(
  '/security/rules/:ruleId',
  authorize('SUPER_ADMIN'),
  [
    param('ruleId').isInt({ min: 1 }).withMessage('ruleId must be a positive integer').toInt()
  ],
  validate,
  async (req, res, next) => {
    try {
      const removed = await securityRulesService.deleteRule(req.params.ruleId);
      logSecurityEvent(req, 'SECURITY_RULE_DELETED', 'WARNING', {
        ruleId: removed.id,
        name: removed.name
      });
      emitSecurityNotification(req, 'security.rule.deleted', {
        ruleId: removed.id,
        name: removed.name
      });
      return res.json(ApiResponse.success(removed, 'Security rule deleted'));
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/security/rules/evaluate',
  authorize('SUPER_ADMIN'),
  [
    body('ip').optional().isString().trim().notEmpty().withMessage('ip must be a non-empty string'),
    body('country').optional().isString().trim().isLength({ min: 2, max: 2 }).withMessage('country must be 2 letters')
  ],
  validate,
  async (req, res, next) => {
    try {
      const pseudoRequest = {
        ip: req.body.ip || req.ip,
        headers: {
          'x-country-code': req.body.country || ''
        }
      };
      const evaluation = await securityRulesService.evaluateRequest(pseudoRequest, { useCache: false });
      return res.json(ApiResponse.success(evaluation, 'Security rule evaluation completed'));
    } catch (error) {
      return next(error);
    }
  }
);

router.get('/subscription-branding', authorize('SUPER_ADMIN'), async (_req, res, next) => {
  try {
    const brandings = await subscriptionBrandingService.listBrandings();
    return res.json(
      ApiResponse.success(
        {
          brandings
        },
        'Subscription branding settings retrieved'
      )
    );
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/subscription-branding/upload-wallpaper',
  authorize('SUPER_ADMIN'),
  (req, res, next) => {
    wallpaperUpload.single('wallpaper')(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json(
            ApiResponse.error(
              `Wallpaper image is too large. Max size is ${Math.floor(MAX_WALLPAPER_UPLOAD_BYTES / (1024 * 1024))} MB.`,
              'VALIDATION_ERROR'
            )
          );
        }
      }

      return res.status(400).json(ApiResponse.error(error.message || 'Wallpaper upload failed', 'VALIDATION_ERROR'));
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json(ApiResponse.error('No wallpaper file uploaded', 'VALIDATION_ERROR'));
      }

      await fs.promises.mkdir(WALLPAPER_UPLOAD_DIR, { recursive: true });

      const extension = ALLOWED_WALLPAPER_MIME_EXT[req.file.mimetype] || 'jpg';
      const filename = `wallpaper-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
      const destinationPath = path.join(WALLPAPER_UPLOAD_DIR, filename);
      await fs.promises.writeFile(destinationPath, req.file.buffer);

      const apiSettingsSuffix = '/api/settings';
      const rawPrefix = req.baseUrl.endsWith(apiSettingsSuffix)
        ? req.baseUrl.slice(0, -apiSettingsSuffix.length)
        : '';
      const normalizedPrefix = rawPrefix ? rawPrefix.replace(/\/+$/, '') : '';
      const wallpaperPath = `${normalizedPrefix}/uploads/branding/wallpapers/${filename}`.replace(/\/{2,}/g, '/');
      const wallpaperUrl = `${req.protocol}://${req.get('host')}${wallpaperPath}`;

      return res.json(
        ApiResponse.success(
          {
            wallpaperUrl,
            wallpaperPath,
            fileName: filename,
            size: req.file.size,
            mimeType: req.file.mimetype
          },
          'Wallpaper uploaded successfully'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/subscription-branding',
  authorize('SUPER_ADMIN'),
  [
    body('name').isString().trim().notEmpty().withMessage('name is required'),
    body('scope').optional().isIn(['GLOBAL', 'GROUP', 'USER']).withMessage('scope must be GLOBAL, GROUP, or USER'),
    body('priority').optional().isInt({ min: 1, max: 10000 }).withMessage('priority must be between 1 and 10000').toInt(),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
    body('userId').optional().isInt({ min: 1 }).withMessage('userId must be a positive integer').toInt(),
    body('groupId').optional().isInt({ min: 1 }).withMessage('groupId must be a positive integer').toInt(),
    body('metadata').optional().isObject().withMessage('metadata must be an object')
  ],
  validate,
  async (req, res, next) => {
    try {
      const created = await subscriptionBrandingService.createBranding(req.body || {});
      return res.status(201).json(ApiResponse.success(created, 'Subscription branding created'));
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  '/subscription-branding/:brandingId',
  authorize('SUPER_ADMIN'),
  [
    param('brandingId').isInt({ min: 1 }).withMessage('brandingId must be a positive integer').toInt(),
    body('name').optional().isString().trim().notEmpty().withMessage('name cannot be empty'),
    body('scope').optional().isIn(['GLOBAL', 'GROUP', 'USER']).withMessage('scope must be GLOBAL, GROUP, or USER'),
    body('priority').optional().isInt({ min: 1, max: 10000 }).withMessage('priority must be between 1 and 10000').toInt(),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
    body('userId').optional().isInt({ min: 1 }).withMessage('userId must be a positive integer').toInt(),
    body('groupId').optional().isInt({ min: 1 }).withMessage('groupId must be a positive integer').toInt(),
    body('metadata').optional().isObject().withMessage('metadata must be an object')
  ],
  validate,
  async (req, res, next) => {
    try {
      const updated = await subscriptionBrandingService.updateBranding(req.params.brandingId, req.body || {});
      return res.json(ApiResponse.success(updated, 'Subscription branding updated'));
    } catch (error) {
      return next(error);
    }
  }
);

router.delete(
  '/subscription-branding/:brandingId',
  authorize('SUPER_ADMIN'),
  [
    param('brandingId').isInt({ min: 1 }).withMessage('brandingId must be a positive integer').toInt()
  ],
  validate,
  async (req, res, next) => {
    try {
      const removed = await subscriptionBrandingService.deleteBranding(req.params.brandingId);
      return res.json(ApiResponse.success(removed, 'Subscription branding deleted'));
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  '/subscription-branding/resolve/:userId',
  authorize('SUPER_ADMIN'),
  [param('userId').isInt({ min: 1 }).withMessage('userId must be a positive integer').toInt()],
  validate,
  async (req, res, next) => {
    try {
      const branding = await subscriptionBrandingService.resolveEffectiveBrandingForUser(req.params.userId);
      return res.json(ApiResponse.success(branding, 'Resolved effective branding'));
    } catch (error) {
      return next(error);
    }
  }
);

router.put('/telegram', async (req, res, next) => {
  try {
    const { botToken, adminIds } = req.body || {};

    if (botToken !== undefined && typeof botToken !== 'string') {
      return res.status(400).json(ApiResponse.error('botToken must be a string', 'VALIDATION_ERROR'));
    }

    if (adminIds !== undefined && typeof adminIds !== 'string') {
      return res.status(400).json(ApiResponse.error('adminIds must be a comma-separated string', 'VALIDATION_ERROR'));
    }

    const envUpdates = {};

    if (typeof botToken === 'string') {
      envUpdates.TELEGRAM_BOT_TOKEN = botToken.trim();
    }

    if (typeof adminIds === 'string') {
      const normalized = adminIds
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .join(',');

      envUpdates.TELEGRAM_ADMIN_IDS = normalized;
    }

    if (Object.keys(envUpdates).length > 0) {
      updateEnvValues(envUpdates);
    }

    const adminCount = (process.env.TELEGRAM_ADMIN_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0).length;

    return res.json(
      ApiResponse.success({
        message: 'Telegram settings saved.',
        telegram: {
          botTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
          adminCount
        }
      })
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/notifications', authorize('SUPER_ADMIN'), async (_req, res, next) => {
  try {
    await webhookService.initialize();
    return res.json(
      ApiResponse.success(
        webhookService.getConfiguration(),
        'Notification settings retrieved successfully'
      )
    );
  } catch (error) {
    return next(error);
  }
});

router.put(
  '/notifications',
  authorize('SUPER_ADMIN'),
  [
    body('webhookEnabled').optional().isBoolean().withMessage('webhookEnabled must be boolean').toBoolean(),
    body('webhookUrl').optional().isString().withMessage('webhookUrl must be a string'),
    body('webhookSecret').optional().isString().withMessage('webhookSecret must be a string'),
    body('timeoutMs').optional().isInt({ min: 1000, max: 120000 }).withMessage('timeoutMs must be between 1000 and 120000').toInt(),
    body('retryAttempts').optional().isInt({ min: 1, max: 10 }).withMessage('retryAttempts must be between 1 and 10').toInt(),
    body('retryDelayMs').optional().isInt({ min: 100, max: 60000 }).withMessage('retryDelayMs must be between 100 and 60000').toInt(),
    body('defaultRoute').optional().custom((value) => value && typeof value === 'object' && !Array.isArray(value)).withMessage('defaultRoute must be an object'),
    body('routes').optional().custom((value) => value && typeof value === 'object' && !Array.isArray(value)).withMessage('routes must be an object')
  ],
  validate,
  async (req, res, next) => {
    try {
      const config = await webhookService.updateConfiguration(req.body || {}, {
        actor: {
          id: req.admin?.id,
          username: req.admin?.username,
          role: req.admin?.role
        },
        request: {
          ip: req.ip,
          userAgent: req.get('user-agent') || ''
        }
      });
      return res.json(
        ApiResponse.success(
          config,
          'Notification settings saved successfully.'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  '/notifications/audit',
  authorize('SUPER_ADMIN'),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be >= 1').toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt()
  ],
  validate,
  async (req, res, next) => {
    try {
      const payload = await webhookService.getAuditLogs({
        page: req.query.page || 1,
        limit: req.query.limit || 20
      });

      return res.json(ApiResponse.success(payload, 'Notification audit history retrieved'));
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/notifications/test',
  authorize('SUPER_ADMIN'),
  [
    body('channel')
      .optional()
      .isIn(['webhook', 'telegram', 'systemLog', 'all'])
      .withMessage('channel must be one of webhook, telegram, systemLog, all'),
    body('event').optional().isString().withMessage('event must be a string'),
    body('data')
      .optional()
      .custom((value) => value && typeof value === 'object' && !Array.isArray(value))
      .withMessage('data must be an object')
  ],
  validate,
  async (req, res, next) => {
    try {
      const payload = await webhookService.dispatchTest({
        channel: req.body?.channel || 'all',
        event: req.body?.event || 'system.notification.test',
        data: req.body?.data || {},
        actor: {
          id: req.admin?.id,
          username: req.admin?.username,
          role: req.admin?.role
        },
        request: {
          ip: req.ip,
          userAgent: req.get('user-agent') || ''
        }
      });

      return res.json(ApiResponse.success(payload, 'Notification test dispatched'));
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @route POST /api/settings/geo-update
 * @desc Update geosite and geoip files from official sources
 * @access Private (Admin only)
 */
router.post('/geo-update', async (_req, res, next) => {
  const https = require('https');
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const geoDir = process.env.XRAY_GEO_PATH || '/usr/local/share/xray';
  const files = [
    {
      name: 'geosite.dat',
      url: 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat',
      checksumUrl: 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat.sha256sum'
    },
    {
      name: 'geoip.dat',
      url: 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat',
      checksumUrl: 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat.sha256sum'
    }
  ];

  const followRedirects = (url) => {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          https.get(response.headers.location, (redirectResponse) => {
            resolve(redirectResponse);
          }).on('error', reject);
        } else {
          resolve(response);
        }
      }).on('error', reject);
    });
  };

  const downloadToFile = (url, dest) => {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await followRedirects(url);
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  };

  const downloadText = (url) => {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await followRedirects(url);
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(data.trim()));
        response.on('error', reject);
      } catch (err) {
        reject(err);
      }
    });
  };

  const computeSha256 = (filePath) => {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  };

  try {
    if (!fs.existsSync(geoDir)) {
      fs.mkdirSync(geoDir, { recursive: true });
    }

    const results = [];
    for (const file of files) {
      const finalPath = path.join(geoDir, file.name);
      const tmpPath = finalPath + '.tmp';
      try {
        await downloadToFile(file.url, tmpPath);

        const checksumText = await downloadText(file.checksumUrl);
        const expectedHash = checksumText.split(/\s+/)[0].toLowerCase();
        const actualHash = await computeSha256(tmpPath);

        if (actualHash !== expectedHash) {
          fs.unlinkSync(tmpPath);
          results.push({
            file: file.name,
            status: 'failed',
            error: `Checksum mismatch: expected ${expectedHash}, got ${actualHash}`
          });
          continue;
        }

        fs.renameSync(tmpPath, finalPath);
        results.push({ file: file.name, status: 'success', sha256: actualHash });
      } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch {}
        results.push({ file: file.name, status: 'failed', error: err.message });
      }
    }

    const xrayManager = require('../xray/manager');
    try {
      await xrayManager.restart();
    } catch (_restartErr) {
      // Ignore restart errors
    }

    return res.json(
      ApiResponse.success({
        message: 'Geo files update completed',
        results,
        path: geoDir
      })
    );
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
