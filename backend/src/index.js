const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const logger = require('./config/logger');
const prisma = require('./config/database');

const { apiLimiter } = require('./middleware/rateLimit');
const { applySecurityRules } = require('./middleware/securityRules');
const errorHandler = require('./middleware/errorHandler');
const { NotFoundError } = require('./utils/errors');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const groupRoutes = require('./routes/group.routes');
const inboundRoutes = require('./routes/inbound.routes');
const systemRoutes = require('./routes/system.routes');
const xrayRoutes = require('./routes/xray.routes');
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

const app = express();
const inlineRuntime = new WorkerRuntime('api-inline');

app.use(helmet());
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

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'xray-panel backend is running'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/inbounds', inboundRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/xray', xrayRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/ssl', sslRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reality', realityRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/api-keys', apiKeysRoutes);
app.use('/api/logs', logsRoutes);
app.use('/sub', subscriptionRoutes);
app.use('/user', userInfoRoutes); // Public user info pages
app.use('/dns-query', dohRoutes); // DNS over HTTPS endpoint

app.use((_req, _res, next) => {
  next(new NotFoundError('Route not found'));
});

app.use(errorHandler);

async function startServer() {
  try {
    await startupGates.runStartupMigrationGate();
    await prisma.$connect();
    await webhookService.initialize();
    await startupGates.runStartupHealthGate();

    const server = app.listen(env.PORT, () => {
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
