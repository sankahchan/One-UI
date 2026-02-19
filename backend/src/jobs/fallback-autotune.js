const cron = require('node-cron');

const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const userService = require('../services/user.service');

class FallbackAutotuneJob {
  constructor() {
    this.lastRunAt = null;
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastErrorMessage = null;
    this.lastSummary = null;
    this.consecutiveFailures = 0;
  }

  getConfig() {
    return {
      enabled: env.SMART_FALLBACK_ENABLED,
      schedule: env.SMART_FALLBACK_CRON,
      windowMinutes: Math.max(5, Number(env.SMART_FALLBACK_WINDOW_MINUTES || 60)),
      minKeys: Math.max(1, Number(env.SMART_FALLBACK_MIN_KEYS || 2))
    };
  }

  getStatus() {
    const config = this.getConfig();

    return {
      ...config,
      lastRunAt: this.lastRunAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      consecutiveFailures: this.consecutiveFailures,
      lastSummary: this.lastSummary
    };
  }

  async run() {
    const config = this.getConfig();
    this.lastRunAt = new Date().toISOString();

    try {
      const users = await prisma.user.findMany({
        where: {
          status: 'ACTIVE'
        },
        select: {
          id: true,
          email: true,
          inbounds: {
            where: {
              enabled: true,
              inbound: {
                enabled: true
              }
            },
            select: {
              inboundId: true
            }
          }
        }
      });

      const targetUsers = users
        .filter((user) => Array.isArray(user.inbounds) && user.inbounds.length >= config.minKeys)
        .map((user) => user.id);

      if (targetUsers.length === 0) {
        const emptySummary = {
          targetUsers: 0,
          wouldUpdateUsers: 0,
          updatedUsers: 0,
          unchangedUsers: 0,
          totalKeys: 0,
          scoredKeys: 0,
          changedKeys: 0
        };

        this.lastSuccessAt = new Date().toISOString();
        this.lastErrorAt = null;
        this.lastErrorMessage = null;
        this.consecutiveFailures = 0;
        this.lastSummary = emptySummary;

        logger.info('Smart fallback autotune skipped: no eligible users');
        return {
          windowMinutes: config.windowMinutes,
          dryRun: false,
          summary: emptySummary
        };
      }

      const result = await userService.bulkReorderUserInboundsByQuality(targetUsers, {
        windowMinutes: config.windowMinutes,
        dryRun: false
      });

      this.lastSuccessAt = new Date().toISOString();
      this.lastErrorAt = null;
      this.lastErrorMessage = null;
      this.consecutiveFailures = 0;
      this.lastSummary = result.summary || null;

      logger.info('Smart fallback autotune completed', {
        targetUsers: targetUsers.length,
        summary: result.summary || null,
        windowMinutes: config.windowMinutes
      });

      return result;
    } catch (error) {
      this.lastErrorAt = new Date().toISOString();
      this.lastErrorMessage = error?.message || 'Smart fallback autotune failed';
      this.consecutiveFailures += 1;
      logger.error('Smart fallback autotune failed', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  start(schedule = env.SMART_FALLBACK_CRON) {
    if (!cron.validate(schedule)) {
      logger.warn('Invalid smart fallback cron schedule', { schedule });
      return null;
    }

    logger.info('Starting smart fallback autotune schedule', {
      schedule,
      windowMinutes: env.SMART_FALLBACK_WINDOW_MINUTES,
      minKeys: env.SMART_FALLBACK_MIN_KEYS
    });

    return cron.schedule(schedule, async () => {
      try {
        await this.run();
      } catch (error) {
        logger.error('Scheduled smart fallback autotune failed', {
          message: error.message,
          stack: error.stack
        });
      }
    });
  }
}

const fallbackAutotuneJob = new FallbackAutotuneJob();

module.exports = fallbackAutotuneJob;
module.exports.runFallbackAutotune = () => fallbackAutotuneJob.run();
