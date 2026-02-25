const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');

const env = require('./config/env');
const logger = require('./config/logger');
const prisma = require('./config/database');

const { apiLimiter } = require('./middleware/rateLimit');
const { apiKeyAuth, enforceApiKeyPermissions } = require('./middleware/apiKeyAuth');
const { applySecurityRules } = require('./middleware/securityRules');
const errorHandler = require('./middleware/errorHandler');
const { NotFoundError } = require('./utils/errors');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const groupRoutes = require('./routes/group.routes');
const inboundRoutes = require('./routes/inbound.routes');
const systemRoutes = require('./routes/system.routes');
const xrayRoutes = require('./routes/xray.routes');
const mieruRoutes = require('./routes/mieru.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const sslRoutes = require('./routes/ssl.routes');
const portalRoutes = require('./routes/portal.routes');
const backupRoutes = require('./routes/backup.routes');
const settingsRoutes = require('./routes/settings.routes');
const searchRoutes = require('./routes/search.routes');
const apiKeysRoutes = require('./routes/apiKeys.routes');
const logsRoutes = require('./routes/logs.routes');
const userInfoRoutes = require('./routes/userInfo.routes');
const dohRoutes = require('./routes/doh.routes');
const realityRoutes = require('./routes/reality.routes');
const metrics = require('./observability/metrics');
const { initBot, stopTelegramBot } = require('./telegram/bot');
const WorkerRuntime = require('./worker/runtime');
const startupGates = require('./startup/gates');
const webhookService = require('./services/webhook.service');
const xrayUpdateService = require('./services/xrayUpdate.service');
const mieruRuntimeService = require('./services/mieruRuntime.service');
const xrayConfigGenerator = require('./xray/config-generator');
const xrayManager = require('./xray/manager');
const { scheduleMieruSync } = require('./utils/mieruSyncQueue');

const marzbanService = require('./services/marzban.service');
const marzbanUserRoutes = require('./routes/marzbanUser.routes');
const marzbanSystemRoutes = require('./routes/marzbanSystem.routes');
const marzbanWebhookRoutes = require('./routes/marzbanWebhook.routes');
const socketLayer = require('./utils/socket');
const http = require('http');

const app = express();
const inlineRuntime = new WorkerRuntime('api-inline');
const serveFrontend = process.env.SERVE_FRONTEND === 'true';
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const indexFile = path.join(publicDir, 'index.html');
const frontendAvailable = serveFrontend && fs.existsSync(indexFile);
const panelPath = (process.env.PANEL_PATH || '').replace(/\/+$/, '') || '';

app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
  })
);
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',')
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(metrics.metricsMiddleware);
app.use(apiLimiter);
app.use(applySecurityRules);
app.use(apiKeyAuth);
app.use(enforceApiKeyPermissions);

app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start
    });
  });

  next();
});

if (!frontendAvailable) {
  app.get('/', (_req, res) => {
    res.status(200).json({
      success: true,
      message: 'one-ui backend is running'
    });
  });
}

// Redirect root panel path without trailing slash to path with slash.
// IMPORTANT: only redirect when the URL is exactly the panel path (no trailing slash).
// Express route matching treats /path and /path/ as equivalent, so we must check manually.
if (panelPath) {
  app.get(panelPath, (req, res, next) => {
    if (req.originalUrl.replace(/\?.*$/, '') === panelPath) {
      return res.redirect(301, `${panelPath}/`);
    }
    next();
  });
}

// Mount API routes under both /api and /${PANEL_PATH}/api
const apiPrefix = panelPath ? `${panelPath}/api` : '/api';
app.use(`${apiPrefix}/auth`, authRoutes);

if (env.MARZBAN_BASE_URL) {
  app.use(`${apiPrefix}/users`, marzbanUserRoutes);
  app.use(`${apiPrefix}/system`, marzbanSystemRoutes);
  app.use(`${apiPrefix}/webhook/marzban`, marzbanWebhookRoutes);
} else {
  app.use(`${apiPrefix}/users`, userRoutes);
  app.use(`${apiPrefix}/system`, systemRoutes);
}

app.use(`${apiPrefix}/groups`, groupRoutes);
app.use(`${apiPrefix}/inbounds`, inboundRoutes);
app.use(`${apiPrefix}/xray`, xrayRoutes);
app.use(`${apiPrefix}/mieru`, mieruRoutes);
app.use(`${apiPrefix}/subscription`, subscriptionRoutes);
app.use(`${apiPrefix}/ssl`, sslRoutes);
app.use(`${apiPrefix}/portal`, portalRoutes);
app.use(`${apiPrefix}/backup`, backupRoutes);
app.use(`${apiPrefix}/settings`, settingsRoutes);
app.use(`${apiPrefix}/reality`, realityRoutes);
app.use(`${apiPrefix}/search`, searchRoutes);
app.use(`${apiPrefix}/api-keys`, apiKeysRoutes);
app.use(`${apiPrefix}/logs`, logsRoutes);

// Also keep /api routes working when panel path is set (for backwards compat and health checks)
if (panelPath) {
  app.use('/api/auth', authRoutes);

  if (env.MARZBAN_BASE_URL) {
    app.use('/api/users', marzbanUserRoutes);
    app.use('/api/system', marzbanSystemRoutes);
    app.use('/api/webhook/marzban', marzbanWebhookRoutes);
  } else {
    app.use('/api/users', userRoutes);
    app.use('/api/system', systemRoutes);
  }

  app.use('/api/groups', groupRoutes);
  app.use('/api/inbounds', inboundRoutes);
  app.use('/api/xray', xrayRoutes);
  app.use('/api/mieru', mieruRoutes);
  app.use('/api/subscription', subscriptionRoutes);
  app.use('/api/ssl', sslRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/backup', backupRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/reality', realityRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/api-keys', apiKeysRoutes);
  app.use('/api/logs', logsRoutes);
}

// Public routes: mount at root and under panel path so they work from both locations.
app.use('/uploads', express.static(uploadsDir));
if (panelPath) {
  app.use(`${panelPath}/uploads`, express.static(uploadsDir));
}
app.use('/sub', subscriptionRoutes);
app.use('/user', userInfoRoutes);
app.use('/dns-query', dohRoutes);
if (panelPath) {
  app.use(`${panelPath}/sub`, subscriptionRoutes);
  app.use(`${panelPath}/user`, userInfoRoutes);
  app.use(`${panelPath}/dns-query`, dohRoutes);
}

// Optional: serve the React admin UI from the backend (installer places build into backend/public).
if (serveFrontend) {
  if (frontendAvailable) {
    const frontendBase = panelPath ? `${panelPath}/` : '/';
    logger.info('Serving frontend from backend', { publicDir, panelPath: panelPath || '(none)' });
    app.use(frontendBase, express.static(publicDir));
    app.get(`${frontendBase}*`, (req, res, next) => {
      // Keep API, subscriptions, and public endpoints working.
      // When panel path is set, req.path includes the full path (e.g. /panel/sub/token),
      // so we strip the panel prefix before checking the route.
      const checkPath = panelPath && req.path.startsWith(panelPath)
        ? req.path.slice(panelPath.length)
        : req.path;

      if (
        checkPath === '/api' ||
        checkPath.startsWith('/api/') ||
        checkPath === '/sub' ||
        checkPath.startsWith('/sub/') ||
        checkPath === '/dns-query' ||
        checkPath.startsWith('/dns-query/')
      ) {
        return next();
      }

      res.sendFile(indexFile);
    });
  } else {
    logger.warn('SERVE_FRONTEND is enabled but no frontend build was found', {
      expectedIndexFile: indexFile
    });
  }
}

app.use((_req, _res, next) => {
  next(new NotFoundError('Route not found'));
});

app.use(errorHandler);

async function startServer() {
  try {
    await startupGates.runStartupMigrationGate();
    await prisma.$connect();
    await startupGates.runStartupHealthGate();
    if (String(process.env.XRAY_STARTUP_SELF_HEAL || 'true').toLowerCase() !== 'false') {
      void xrayUpdateService.runStartupSelfHeal();
    }
    await mieruRuntimeService.runStartupGuard();
    await webhookService.initialize();
    await marzbanService.initialize(); // Async fetch and ticker registry
    // Initialize Xray config
    logger.info('Initializing Xray configuration...');
    try {
      await xrayManager.reloadConfig();
      logger.info('Xray configuration initialized');
    } catch (error) {
      logger.error('Failed to initialize Xray configuration:', error);
      // We don't exit here, as the panel might be needed to fix the config
    }

    scheduleMieruSync('startup.bootstrap');

    const server = http.createServer(app);
    socketLayer.init(server);

    server.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT}`);
    });

    if (process.env.TELEGRAM_ENABLED === 'true') {
      initBot();
      logger.info('Telegram bot started');
    }

    if (env.WORKER_MODE === 'inline') {
      await inlineRuntime.start();
    } else {
      logger.info('Background jobs are disabled in API process (use `npm run worker`)', {
        workerMode: env.WORKER_MODE
      });
    }

    logger.info('All services started successfully');

    const shutdown = async (signal) => {
      logger.info(`Received ${signal}; shutting down gracefully`);
      await inlineRuntime.stop();
      await stopTelegramBot();
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start server', { message: error.message, stack: error.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
