const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiResponse = require('../utils/response');
const { sendSuccess } = ApiResponse;
const metricsStore = require('../observability/metrics');
const { UnauthorizedError } = require('../utils/errors');
const { getBotManager } = require('../telegram/bot');
const usageSnapshotService = require('../analytics/usageSnapshot.service');
const workerLockService = require('../services/workerLock.service');

async function health(_req, res, next) {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Service healthy',
      data: {
        status: 'ok',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function stats(_req, res, next) {
  try {
    const admins = await prisma.admin.count();
    const users = await prisma.user.count();
    const inbounds = await prisma.inbound.count();
    const userInbounds = await prisma.userInbound.count();
    const trafficLogs = await prisma.trafficLog.count();
    const systemLogs = await prisma.systemLog.count();
    const workerLock = await workerLockService.get(env.WORKER_LOCK_NAME);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'System statistics',
      data: {
        admins,
        users,
        inbounds,
        userInbounds,
        trafficLogs,
        systemLogs,
        workerLock: workerLock
          ? {
            name: workerLock.name,
            ownerId: workerLock.ownerId,
            heartbeatAt: workerLock.heartbeatAt,
            expiresAt: workerLock.expiresAt
          }
          : null,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function analyticsSnapshots(req, res, next) {
  try {
    const limitRaw = Number.parseInt(String(req.query.limit || 10), 10);
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
    const overview = await usageSnapshotService.getLatestOverview(limit);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Analytics snapshots retrieved',
      data: overview
    });
  } catch (error) {
    return next(error);
  }
}

function metrics(_req, res) {
  res.setHeader('Content-Type', metricsStore.CONTENT_TYPE);
  res.status(200).send(metricsStore.renderPrometheusMetrics());
}

function formatAlertTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toSafeText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function formatAlertmanagerMessage(payload) {
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  const status = toSafeText(payload?.status, 'unknown').toUpperCase();
  const receiver = toSafeText(payload?.receiver, 'default');
  const lines = [
    'One-UI Alertmanager',
    `Status: ${status}`,
    `Receiver: ${receiver}`,
    `Alerts: ${alerts.length}`
  ];

  if (alerts.length > 0) {
    lines.push('');
  }

  const maxAlerts = 10;
  const visibleAlerts = alerts.slice(0, maxAlerts);
  for (const alert of visibleAlerts) {
    const alertStatus = toSafeText(alert?.status, payload?.status || 'unknown').toUpperCase();
    const alertName = toSafeText(alert?.labels?.alertname, 'UnnamedAlert');
    const severity = toSafeText(alert?.labels?.severity, 'unknown');
    const service = toSafeText(alert?.labels?.service, 'n/a');
    const summary = toSafeText(alert?.annotations?.summary, '');
    const description = toSafeText(alert?.annotations?.description, '');
    const startedAt = formatAlertTimestamp(alert?.startsAt);
    const endedAt = formatAlertTimestamp(alert?.endsAt);

    lines.push(`[${alertStatus}] ${alertName} (severity=${severity}, service=${service})`);
    if (summary) {
      lines.push(`  summary: ${summary}`);
    } else if (description) {
      lines.push(`  description: ${description}`);
    }
    if (startedAt) {
      lines.push(`  started: ${startedAt}`);
    }
    if (alertStatus === 'RESOLVED' && endedAt) {
      lines.push(`  ended: ${endedAt}`);
    }
  }

  if (alerts.length > maxAlerts) {
    lines.push(`... and ${alerts.length - maxAlerts} more alerts`);
  }

  return lines.join('\n');
}

async function alertWebhook(req, res, next) {
  try {
    const configuredSecret = String(env.ALERT_WEBHOOK_SECRET || '').trim();
    if (!configuredSecret) {
      return res
        .status(503)
        .json(ApiResponse.error('Alert webhook is not configured', 'ALERT_WEBHOOK_DISABLED'));
    }

    const authHeader = toSafeText(req.headers.authorization, '');
    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing alert webhook authorization');
    }

    const token = authHeader.slice(7).trim();
    if (token !== configuredSecret) {
      throw new UnauthorizedError('Invalid alert webhook authorization');
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    const alertMessage = formatAlertmanagerMessage(payload);
    const botManager = getBotManager();

    let forwardedToTelegram = false;
    if (botManager?.enabled && typeof botManager.sendPlainAlert === 'function') {
      await botManager.sendPlainAlert(alertMessage);
      forwardedToTelegram = true;
    }

    if (!forwardedToTelegram) {
      logger.info('Alertmanager webhook received; Telegram forwarding unavailable', {
        alertCount: alerts.length
      });
    }

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Alert processed',
      data: { queued: true }
    });
  } catch (error) {
    return next(error);
  }
}

async function getPublicIp(_req, res, next) {
  try {
    let ip = process.env.CLOUDFLARE_TARGET_IP || '';
    if (!ip) {
      const resp = await fetch('https://api.ipify.org?format=json');
      const data = await resp.json();
      ip = data.ip;
    }

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Public IP retrieved',
      data: { ip }
    });
  } catch (error) {
    logger.warn('Failed to resolve public IP', { error: error.message });
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Fallback to empty IP',
      data: { ip: '' }
    });
  }
}

module.exports = {
  health,
  stats,
  analyticsSnapshots,
  metrics,
  alertWebhook,
  getPublicIp
};
