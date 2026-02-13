const crypto = require('node:crypto');
const axios = require('axios');

const env = require('../config/env');
const logger = require('../config/logger');
const prisma = require('../config/database');
const secretCryptoService = require('./secretCrypto.service');
const { getBotManager } = require('../telegram/bot');

const DEFAULT_ROUTE_MATRIX = Object.freeze({
  default: {
    webhook: true,
    telegram: false,
    systemLog: true
  },
  routes: {
    'auth.login.success': { webhook: true, telegram: true, systemLog: true },
    'auth.login.failed': { webhook: true, telegram: true, systemLog: true },
    'security.critical': { webhook: true, telegram: true, systemLog: true },
    'user.*': { webhook: true, telegram: false, systemLog: true },
    'inbound.*': { webhook: true, telegram: false, systemLog: true },
    'xray.*': { webhook: true, telegram: true, systemLog: true },
    'system.*': { webhook: true, telegram: true, systemLog: true }
  }
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseRoute(routeConfig = {}, fallback = {}) {
  return {
    webhook: parseBoolean(routeConfig.webhook, fallback.webhook ?? true),
    telegram: parseBoolean(routeConfig.telegram, fallback.telegram ?? false),
    systemLog: parseBoolean(routeConfig.systemLog, fallback.systemLog ?? true)
  };
}

function parseJsonObject(rawValue, fallback = null) {
  if (!rawValue || typeof rawValue !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return isPlainObject(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function truncate(value, maxLength = 4000) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw.length <= maxLength) {
    return raw;
  }

  return `${raw.slice(0, maxLength)}... [truncated]`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

class WebhookService {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.config = this.resolveInitialConfig();
    this.configMeta = {
      createdAt: null,
      updatedAt: null
    };
    this.initialized = false;
    this.initializingPromise = null;
  }

  resolveInitialConfig() {
    const matrixOverrides = parseJsonObject(env.NOTIFICATION_MATRIX_JSON, {}) || {};
    const defaultRouteOverride = isPlainObject(matrixOverrides.default) ? matrixOverrides.default : {};
    const routeOverrides = isPlainObject(matrixOverrides.routes) ? matrixOverrides.routes : {};

    const defaultRoute = parseRoute(defaultRouteOverride, {
      webhook: env.NOTIFICATION_DEFAULT_WEBHOOK,
      telegram: env.NOTIFICATION_DEFAULT_TELEGRAM,
      systemLog: env.NOTIFICATION_DEFAULT_SYSTEM_LOG
    });

    const routes = {};
    Object.entries(DEFAULT_ROUTE_MATRIX.routes).forEach(([eventName, route]) => {
      routes[eventName] = parseRoute(route, defaultRoute);
    });

    Object.entries(routeOverrides).forEach(([eventName, route]) => {
      if (!isPlainObject(route)) {
        return;
      }

      routes[eventName] = parseRoute(route, defaultRoute);
    });

    const webhookUrl = env.WEBHOOK_URL || '';
    const webhookSecret = env.WEBHOOK_SECRET || env.ALERT_WEBHOOK_SECRET || '';
    const webhookEnabled = parseBoolean(env.WEBHOOK_ENABLED, Boolean(webhookUrl));

    return {
      webhookEnabled,
      webhookUrl,
      webhookSecret,
      timeoutMs: Math.max(1000, Number(env.WEBHOOK_TIMEOUT_MS || 10000)),
      retryAttempts: Math.max(1, Number(env.WEBHOOK_RETRY_ATTEMPTS || 3)),
      retryDelayMs: Math.max(100, Number(env.WEBHOOK_RETRY_DELAY_MS || 1000)),
      routeMatrix: {
        default: defaultRoute,
        routes
      }
    };
  }

  serializeRoutes(routes = {}, defaultRoute = {}) {
    const normalizedRoutes = {};
    Object.entries(routes).forEach(([eventName, route]) => {
      if (!eventName || !isPlainObject(route)) {
        return;
      }

      normalizedRoutes[eventName] = parseRoute(route, defaultRoute);
    });
    return normalizedRoutes;
  }

  mergeRouteMatrix(defaultRoute, incomingRoutes = {}) {
    const mergedRoutes = {};

    Object.entries(DEFAULT_ROUTE_MATRIX.routes).forEach(([eventName, route]) => {
      mergedRoutes[eventName] = parseRoute(
        incomingRoutes[eventName] || route,
        defaultRoute
      );
    });

    Object.entries(incomingRoutes).forEach(([eventName, route]) => {
      if (!eventName || !isPlainObject(route)) {
        return;
      }

      mergedRoutes[eventName] = parseRoute(route, defaultRoute);
    });

    return {
      default: parseRoute(defaultRoute, this.config.routeMatrix.default),
      routes: mergedRoutes
    };
  }

  serializeConfigForRecord(config = this.config) {
    const defaultRoute = parseRoute(config.routeMatrix?.default, {
      webhook: true,
      telegram: false,
      systemLog: true
    });

    return {
      webhookEnabled: Boolean(config.webhookEnabled),
      webhookUrl: String(config.webhookUrl || ''),
      webhookSecret: secretCryptoService.encrypt(String(config.webhookSecret || '')),
      timeoutMs: Math.max(1000, Number(config.timeoutMs || 10000)),
      retryAttempts: Math.max(1, Number(config.retryAttempts || 3)),
      retryDelayMs: Math.max(100, Number(config.retryDelayMs || 1000)),
      routeDefaultWebhook: Boolean(defaultRoute.webhook),
      routeDefaultTelegram: Boolean(defaultRoute.telegram),
      routeDefaultSystemLog: Boolean(defaultRoute.systemLog),
      routes: this.serializeRoutes(config.routeMatrix?.routes || {}, defaultRoute)
    };
  }

  applyRecordToConfig(record) {
    if (!record || typeof record !== 'object') {
      return;
    }

    const defaultRoute = parseRoute(
      {
        webhook: record.routeDefaultWebhook,
        telegram: record.routeDefaultTelegram,
        systemLog: record.routeDefaultSystemLog
      },
      this.config.routeMatrix.default
    );

    const routesFromRecord = isPlainObject(record.routes) ? record.routes : {};
    const routeMatrix = this.mergeRouteMatrix(defaultRoute, routesFromRecord);

    this.config = {
      webhookEnabled: Boolean(record.webhookEnabled),
      webhookUrl: String(record.webhookUrl || ''),
      webhookSecret: secretCryptoService.safeDecrypt(record.webhookSecret || '', ''),
      timeoutMs: Math.max(1000, Number(record.timeoutMs || 10000)),
      retryAttempts: Math.max(1, Number(record.retryAttempts || 3)),
      retryDelayMs: Math.max(100, Number(record.retryDelayMs || 1000)),
      routeMatrix
    };

    this.configMeta = {
      createdAt: record.createdAt || this.configMeta.createdAt || null,
      updatedAt: record.updatedAt || this.configMeta.updatedAt || null
    };
  }

  async initialize() {
    if (this.initialized) {
      return this.getConfiguration();
    }

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = (async () => {
      try {
        const defaults = this.serializeConfigForRecord(this.config);
        const record = await prisma.notificationSetting.upsert({
          where: { id: 1 },
          create: {
            id: 1,
            ...defaults
          },
          update: {}
        });

        this.applyRecordToConfig(record);
        if (
          secretCryptoService.isConfigured()
          && record.webhookSecret
          && !secretCryptoService.isEncrypted(record.webhookSecret)
        ) {
          const encryptedSecret = secretCryptoService.encrypt(record.webhookSecret);
          const encryptedRecord = await prisma.notificationSetting.update({
            where: { id: 1 },
            data: {
              webhookSecret: encryptedSecret
            }
          });
          this.applyRecordToConfig(encryptedRecord);
          logger.info('Notification webhook secret migrated to encrypted storage');
        }
        logger.info('Notification settings loaded from database');
      } catch (error) {
        logger.warn('Failed to load notification settings from database, using in-memory defaults', {
          message: error.message
        });
      } finally {
        this.initialized = true;
        this.initializingPromise = null;
      }

      return this.getConfiguration();
    })();

    return this.initializingPromise;
  }

  getAuditSnapshot() {
    const config = this.getConfiguration();
    return {
      webhookEnabled: config.webhookEnabled,
      webhookUrl: config.webhookUrl,
      timeoutMs: config.timeoutMs,
      retryAttempts: config.retryAttempts,
      retryDelayMs: config.retryDelayMs,
      routeMatrix: deepClone(config.routeMatrix || {})
    };
  }

  async createAuditLog({ actor = null, request = null, action = 'UPDATE', before = null, after = null } = {}) {
    try {
      const beforeSnapshot = isPlainObject(before) ? before : null;
      const afterSnapshot = isPlainObject(after) ? after : null;
      const changedKeys = [];

      const unionKeys = new Set([
        ...Object.keys(beforeSnapshot || {}),
        ...Object.keys(afterSnapshot || {})
      ]);
      unionKeys.forEach((key) => {
        const beforeValue = beforeSnapshot ? beforeSnapshot[key] : undefined;
        const afterValue = afterSnapshot ? afterSnapshot[key] : undefined;
        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
          changedKeys.push(key);
        }
      });

      await prisma.notificationSettingsAuditLog.create({
        data: {
          adminId: Number.isInteger(actor?.id) ? actor.id : null,
          adminUsername: actor?.username ? String(actor.username) : null,
          requestIp: request?.ip ? String(request.ip) : null,
          userAgent: request?.userAgent ? String(request.userAgent).slice(0, 512) : null,
          action: String(action || 'UPDATE'),
          changedKeys,
          before: beforeSnapshot,
          after: afterSnapshot
        }
      });
    } catch (error) {
      logger.warn('Failed to write notification audit log', {
        message: error.message
      });
    }
  }

  async getAuditLogs({ page = 1, limit = 20 } = {}) {
    await this.initialize();

    const safePage = Number.isInteger(page) ? Math.max(1, page) : 1;
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(1, limit), 100) : 20;
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      prisma.notificationSettingsAuditLog.findMany({
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.notificationSettingsAuditLog.count()
    ]);

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  }

  async persistConfiguration(auditContext = {}) {
    const data = this.serializeConfigForRecord(this.config);
    const record = await prisma.notificationSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        ...data
      },
      update: data
    });

    this.configMeta = {
      createdAt: record.createdAt || this.configMeta.createdAt || null,
      updatedAt: record.updatedAt || new Date()
    };

    await this.createAuditLog({
      actor: auditContext.actor || null,
      request: auditContext.request || null,
      action: auditContext.action || 'UPDATE',
      before: auditContext.before || null,
      after: auditContext.after || this.getAuditSnapshot()
    });
  }

  getConfiguration() {
    return {
      webhookEnabled: this.config.webhookEnabled,
      webhookUrl: this.config.webhookUrl,
      webhookSecretConfigured: Boolean(this.config.webhookSecret),
      timeoutMs: this.config.timeoutMs,
      retryAttempts: this.config.retryAttempts,
      retryDelayMs: this.config.retryDelayMs,
      routeMatrix: deepClone(this.config.routeMatrix),
      createdAt: this.configMeta.createdAt,
      updatedAt: this.configMeta.updatedAt
    };
  }

  async updateConfiguration(overrides = {}, context = {}) {
    await this.initialize();

    const incoming = isPlainObject(overrides) ? overrides : {};
    const beforeSnapshot = this.getAuditSnapshot();

    if (incoming.webhookEnabled !== undefined) {
      this.config.webhookEnabled = parseBoolean(incoming.webhookEnabled, this.config.webhookEnabled);
      process.env.WEBHOOK_ENABLED = String(this.config.webhookEnabled);
    }

    if (typeof incoming.webhookUrl === 'string') {
      this.config.webhookUrl = incoming.webhookUrl.trim();
      process.env.WEBHOOK_URL = this.config.webhookUrl;
    }

    if (typeof incoming.webhookSecret === 'string') {
      this.config.webhookSecret = incoming.webhookSecret.trim();
      process.env.WEBHOOK_SECRET = this.config.webhookSecret;
    }

    if (incoming.timeoutMs !== undefined) {
      const timeoutMs = Number.parseInt(String(incoming.timeoutMs), 10);
      if (Number.isInteger(timeoutMs) && timeoutMs >= 1000) {
        this.config.timeoutMs = timeoutMs;
        process.env.WEBHOOK_TIMEOUT_MS = String(timeoutMs);
      }
    }

    if (incoming.retryAttempts !== undefined) {
      const retryAttempts = Number.parseInt(String(incoming.retryAttempts), 10);
      if (Number.isInteger(retryAttempts) && retryAttempts >= 1) {
        this.config.retryAttempts = retryAttempts;
        process.env.WEBHOOK_RETRY_ATTEMPTS = String(retryAttempts);
      }
    }

    if (incoming.retryDelayMs !== undefined) {
      const retryDelayMs = Number.parseInt(String(incoming.retryDelayMs), 10);
      if (Number.isInteger(retryDelayMs) && retryDelayMs >= 100) {
        this.config.retryDelayMs = retryDelayMs;
        process.env.WEBHOOK_RETRY_DELAY_MS = String(retryDelayMs);
      }
    }

    if (isPlainObject(incoming.defaultRoute)) {
      this.config.routeMatrix.default = parseRoute(incoming.defaultRoute, this.config.routeMatrix.default);
    }

    if (isPlainObject(incoming.routes)) {
      Object.entries(incoming.routes).forEach(([eventName, route]) => {
        if (!eventName || !isPlainObject(route)) {
          return;
        }

        this.config.routeMatrix.routes[eventName] = parseRoute(route, this.config.routeMatrix.default);
      });
    }

    await this.persistConfiguration({
      actor: context.actor || null,
      request: context.request || null,
      action: 'UPDATE',
      before: beforeSnapshot,
      after: this.getAuditSnapshot()
    });
    return this.getConfiguration();
  }

  getRouteForEvent(eventName) {
    const defaultRoute = this.config.routeMatrix.default;
    const routes = this.config.routeMatrix.routes;
    const eventKey = String(eventName || '').trim();

    if (!eventKey) {
      return defaultRoute;
    }

    if (routes[eventKey]) {
      return routes[eventKey];
    }

    let wildcardMatch = null;
    let wildcardScore = -1;
    Object.entries(routes).forEach(([pattern, route]) => {
      if (!pattern.endsWith('*')) {
        return;
      }

      const prefix = pattern.slice(0, -1);
      if (!eventKey.startsWith(prefix)) {
        return;
      }

      if (prefix.length > wildcardScore) {
        wildcardMatch = route;
        wildcardScore = prefix.length;
      }
    });

    return wildcardMatch || defaultRoute;
  }

  buildEnvelope(eventName, data = {}, options = {}) {
    const now = new Date();
    const actor = isPlainObject(options.actor) ? options.actor : null;
    const request = isPlainObject(options.request) ? options.request : null;

    return {
      id: crypto.randomUUID(),
      event: String(eventName || 'system.unknown'),
      scope: String(eventName || 'system').split('.')[0] || 'system',
      source: 'one-ui',
      timestamp: now.toISOString(),
      severity: options.severity || 'info',
      actor,
      request,
      data: isPlainObject(data) || Array.isArray(data) ? data : { value: data }
    };
  }

  emitEvent(eventName, data = {}, options = {}) {
    try {
      const envelope = this.buildEnvelope(eventName, data, options);
      const route = this.getRouteForEvent(envelope.event);

      if (route.systemLog) {
        logger.info('Event bus message', {
          eventId: envelope.id,
          event: envelope.event,
          scope: envelope.scope,
          actor: envelope.actor?.username || envelope.actor?.id || null
        });
      }

      if (route.webhook) {
        this.enqueue({
          channel: 'webhook',
          envelope,
          attempts: 0
        });
      }

      if (route.telegram) {
        this.enqueue({
          channel: 'telegram',
          envelope,
          attempts: 0
        });
      }

      return envelope.id;
    } catch (error) {
      logger.error('Failed to emit event', {
        event: eventName,
        message: error.message
      });
      return null;
    }
  }

  enqueue(job) {
    this.queue.push(job);
    void this.processQueue();
  }

  async processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      try {
        if (job.channel === 'webhook') {
          await this.dispatchWebhook(job.envelope);
        } else if (job.channel === 'telegram') {
          await this.dispatchTelegram(job.envelope);
        }
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        if (attempts < this.config.retryAttempts) {
          job.attempts = attempts;
          await this.delay(this.config.retryDelayMs * attempts);
          this.queue.push(job);
        } else {
          logger.error('Notification dispatch failed permanently', {
            channel: job.channel,
            event: job.envelope?.event,
            eventId: job.envelope?.id,
            message: error.message
          });
        }
      }
    }
    this.processing = false;
  }

  createWebhookSignature(envelope, body) {
    const secret = this.config.webhookSecret || env.ALERT_WEBHOOK_SECRET || '';
    if (!secret) {
      return null;
    }

    const signed = `${envelope.timestamp}.${envelope.id}.${envelope.event}.${body}`;
    return crypto.createHmac('sha256', secret).update(signed).digest('hex');
  }

  async dispatchWebhook(envelope) {
    if (!this.config.webhookEnabled || !this.config.webhookUrl) {
      return;
    }

    const body = JSON.stringify(envelope);
    const signature = this.createWebhookSignature(envelope, body);

    if (!signature) {
      logger.warn('Webhook dispatch skipped: missing signing secret', {
        event: envelope.event,
        eventId: envelope.id
      });
      return;
    }

    const response = await axios.post(this.config.webhookUrl, envelope, {
      timeout: this.config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'One-UI-Webhook/2.0',
        'X-OneUI-Version': '1',
        'X-OneUI-Event-ID': envelope.id,
        'X-OneUI-Event': envelope.event,
        'X-OneUI-Event-Timestamp': envelope.timestamp,
        'X-OneUI-Signature': `sha256=${signature}`
      },
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Webhook endpoint returned HTTP ${response.status}`);
    }
  }

  async dispatchTelegram(envelope) {
    const botManager = getBotManager();
    if (!botManager || !botManager.enabled) {
      logger.info('Telegram notification skipped: bot unavailable', {
        event: envelope.event,
        eventId: envelope.id
      });
      return;
    }

    const dataBlock = truncate(envelope.data, 1200);
    const message = [
      `One-UI Event`,
      `Event: ${envelope.event}`,
      `ID: ${envelope.id}`,
      `Time: ${new Date(envelope.timestamp).toLocaleString()}`,
      envelope.actor ? `Actor: ${envelope.actor.username || envelope.actor.id || 'unknown'}` : 'Actor: system',
      envelope.request?.ip ? `IP: ${envelope.request.ip}` : null,
      `Data: ${dataBlock}`
    ]
      .filter(Boolean)
      .join('\n');

    await botManager.sendPlainAlert(message);
  }

  async dispatchTest({ channel = 'all', event = 'system.notification.test', data = {}, actor = null, request = null } = {}) {
    const envelope = this.buildEnvelope(event, data, {
      actor: isPlainObject(actor) ? actor : null,
      request: isPlainObject(request) ? request : null
    });

    if (channel === 'webhook' || channel === 'all') {
      await this.dispatchWebhook(envelope);
    }

    if (channel === 'telegram' || channel === 'all') {
      await this.dispatchTelegram(envelope);
    }

    if (channel === 'systemLog' || channel === 'all') {
      logger.info('Notification test event', {
        eventId: envelope.id,
        event: envelope.event
      });
    }

    return {
      eventId: envelope.id,
      event: envelope.event,
      channel
    };
  }

  async send(action, data) {
    const eventName = String(action || 'system.unknown').replace(/_/g, '.');
    this.emitEvent(eventName, data);
  }

  async userCreated(user) {
    this.emitEvent('user.created', {
      id: user.id,
      email: user.email,
      status: user.status
    });
  }

  async userUpdated(user) {
    this.emitEvent('user.updated', {
      id: user.id,
      email: user.email,
      status: user.status
    });
  }

  async userDeleted(userId, email) {
    this.emitEvent('user.deleted', {
      id: userId,
      email: email || null
    });
  }

  async userLimited(user) {
    this.emitEvent('user.status.limited', {
      id: user.id,
      email: user.email,
      status: 'LIMITED'
    });
  }

  async userExpired(user) {
    this.emitEvent('user.status.expired', {
      id: user.id,
      email: user.email,
      status: 'EXPIRED'
    });
  }

  async userDisabled(user) {
    this.emitEvent('user.status.disabled', {
      id: user.id,
      email: user.email,
      status: 'DISABLED'
    });
  }

  async userEnabled(user) {
    this.emitEvent('user.status.enabled', {
      id: user.id,
      email: user.email,
      status: 'ACTIVE'
    });
  }

  async trafficReset(user) {
    this.emitEvent('user.traffic.reset', {
      id: user.id,
      email: user.email
    });
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new WebhookService();
