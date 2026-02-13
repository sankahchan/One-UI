const cron = require('node-cron');

const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const { getBotManager } = require('../telegram/bot');

class TrafficMonitor {
  toNumber(value) {
    if (typeof value === 'bigint') {
      return Number(value);
    }

    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async run() {
    logger.info('Running traffic check...');

    try {
      const threshold = env.TELEGRAM_NOTIFY_DATA_THRESHOLD;
      const users = await prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          dataLimit: {
            gt: 0n
          }
        },
        select: {
          id: true,
          email: true,
          status: true,
          dataLimit: true,
          uploadUsed: true,
          downloadUsed: true,
          expireDate: true
        }
      });

      const botManager = getBotManager();
      let notified = 0;
      let limited = 0;

      for (const user of users) {
        const totalUsed = user.uploadUsed + user.downloadUsed;
        const remaining = user.dataLimit - totalUsed;
        const remainingPercent =
          user.dataLimit > 0n ? (this.toNumber(remaining) / this.toNumber(user.dataLimit)) * 100 : 0;

        if (
          remainingPercent <= threshold &&
          remainingPercent > 0 &&
          botManager?.enabled &&
          typeof botManager.notifyDataLimit === 'function'
        ) {
          await botManager.notifyDataLimit({
            ...user,
            totalUsed,
            remainingPercent
          });
          notified += 1;
        }

        if (totalUsed >= user.dataLimit) {
          await prisma.user.update({
            where: { id: user.id },
            data: { status: 'LIMITED' }
          });

          limited += 1;
          logger.info(`Auto-limited user: ${user.email}`);
        }
      }

      logger.info('Traffic monitor run completed', {
        scanned: users.length,
        notified,
        limited
      });

      return {
        scanned: users.length,
        notified,
        limited
      };
    } catch (error) {
      logger.error('Traffic check failed', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  start(schedule = '0 * * * *') {
    if (!cron.validate(schedule)) {
      logger.warn('Invalid traffic monitor cron schedule', { schedule });
      return null;
    }

    logger.info('Starting traffic monitor schedule', { schedule });
    return cron.schedule(schedule, async () => {
      try {
        await this.run();
      } catch (error) {
        logger.error('Scheduled traffic check failed', {
          message: error.message,
          stack: error.stack
        });
      }
    });
  }
}

const trafficMonitor = new TrafficMonitor();

module.exports = trafficMonitor;
module.exports.runTrafficMonitor = () => trafficMonitor.run();
