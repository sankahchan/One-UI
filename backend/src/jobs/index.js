const cron = require('node-cron');

const env = require('../config/env');
const logger = require('../config/logger');
const { runTrafficMonitor } = require('./traffic-monitor');
const { runExpiryChecker } = require('./expiry-checker');
const { runSslRenew } = require('./ssl-renew');
const { runBackup } = require('./backup.job');
const reports = require('../telegram/notifications/reports');

const scheduledTasks = [];

function registerJob(name, schedule, task) {
  if (!cron.validate(schedule)) {
    logger.warn('Invalid cron expression; job skipped', { name, schedule });
    return null;
  }

  const cronTask = cron.schedule(schedule, async () => {
    try {
      await task();
    } catch (error) {
      logger.error('Scheduled job failed', {
        name,
        message: error.message,
        stack: error.stack
      });
    }
  });

  scheduledTasks.push({ name, schedule, task: cronTask });
  logger.info('Scheduled job registered', { name, schedule });
  return cronTask;
}

function startScheduledJobs() {
  if (!env.JOBS_ENABLED) {
    logger.info('Scheduled jobs disabled by JOBS_ENABLED=false');
    return [];
  }

  registerJob('traffic-monitor', env.TRAFFIC_MONITOR_CRON, runTrafficMonitor);
  registerJob('expiry-checker', env.EXPIRY_CHECK_CRON, runExpiryChecker);
  registerJob('ssl-renew', env.SSL_RENEW_CRON, runSslRenew);

  if (env.BACKUP_ENABLED) {
    registerJob('database-backup', env.BACKUP_SCHEDULE, runBackup);
  }

  if (env.TELEGRAM_ENABLED) {
    registerJob('telegram-daily-report', env.TELEGRAM_REPORT_CRON, reports.sendDailyReport);
  }

  return scheduledTasks;
}

function stopScheduledJobs() {
  for (const entry of scheduledTasks) {
    entry.task.stop();
  }
}

module.exports = {
  startScheduledJobs,
  stopScheduledJobs
};
