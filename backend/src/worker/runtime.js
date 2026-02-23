const env = require('../config/env');
const logger = require('../config/logger');

const expiryChecker = require('../jobs/expiry-checker');
const trafficMonitor = require('../jobs/traffic-monitor');
const trafficResetJob = require('../jobs/trafficReset.job');
const certificateMonitor = require('../jobs/certificate-monitor');
const fallbackAutotuneJob = require('../jobs/fallback-autotune');
const groupPolicyScheduler = require('../jobs/group-policy-scheduler');
const statsCollector = require('../xray/stats-collector');
const systemMonitor = require('../system/monitor');
const backupManager = require('../backup/manager');
const usageSnapshotService = require('../analytics/usageSnapshot.service');

class WorkerRuntime {
  constructor(name = 'background-runtime') {
    this.name = name;
    this.started = false;
    this.scheduledTasks = [];
  }

  async start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.scheduledTasks = [];

    if (env.JOBS_ENABLED) {
      const expiryTask = expiryChecker.start(env.EXPIRY_CHECK_CRON);
      const trafficTask = trafficMonitor.start(env.TRAFFIC_MONITOR_CRON);
      const certTask = certificateMonitor.start(env.SSL_RENEW_CRON);
      this.scheduledTasks.push(expiryTask, trafficTask, certTask);

      // Start the periodic traffic reset scheduler (resets user traffic
      // based on their trafficResetPeriod: DAILY / WEEKLY / MONTHLY).
      trafficResetJob.start();
      this.scheduledTasks.push(trafficResetJob);
      if (env.SMART_FALLBACK_ENABLED) {
        const fallbackTask = fallbackAutotuneJob.start(env.SMART_FALLBACK_CRON);
        this.scheduledTasks.push(fallbackTask);
      } else {
        logger.info('Smart fallback autotune disabled by SMART_FALLBACK_ENABLED=false', { runtime: this.name });
      }
      await groupPolicyScheduler.start();
      logger.info('Scheduled jobs started', { runtime: this.name });
    } else {
      logger.info('Scheduled jobs disabled by JOBS_ENABLED=false', { runtime: this.name });
    }

    if (env.XRAY_TRAFFIC_SYNC_ENABLED) {
      statsCollector.startCollection();
    } else {
      logger.info('Xray traffic sync disabled by XRAY_TRAFFIC_SYNC_ENABLED=false', { runtime: this.name });
    }

    if (env.SYSTEM_MONITOR_ENABLED) {
      systemMonitor.startMonitoring();
    } else {
      logger.info('System monitor disabled by SYSTEM_MONITOR_ENABLED=false', { runtime: this.name });
    }

    if (env.BACKUP_ENABLED) {
      backupManager.startScheduledBackups();
    } else {
      logger.info('Backup scheduler disabled by BACKUP_ENABLED=false', { runtime: this.name });
    }

    usageSnapshotService.start();
    logger.info('Background runtime started', { runtime: this.name });
  }

  async stop() {
    if (!this.started) {
      return;
    }

    for (const task of this.scheduledTasks) {
      if (task && typeof task.stop === 'function') {
        task.stop();
      }
    }

    groupPolicyScheduler.stop();
    statsCollector.stopCollection();
    systemMonitor.stopMonitoring();
    backupManager.stopScheduledBackups();
    usageSnapshotService.stop();
    this.scheduledTasks = [];
    this.started = false;

    logger.info('Background runtime stopped', { runtime: this.name });
  }
}

module.exports = WorkerRuntime;
