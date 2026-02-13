const cron = require('node-cron');

const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const { getBotManager } = require('../telegram/bot');

class ExpiryChecker {
  async run() {
    logger.info('Running expiry check...');

    try {
      const now = new Date();
      const warningDate = new Date();
      warningDate.setDate(warningDate.getDate() + env.TELEGRAM_NOTIFY_EXPIRY_DAYS);

      const expiringUsers = await prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          expireDate: {
            lte: warningDate,
            gt: now
          }
        },
        select: {
          id: true,
          email: true,
          expireDate: true,
          dataLimit: true,
          uploadUsed: true,
          downloadUsed: true
        }
      });

      let notified = 0;
      if (expiringUsers.length > 0) {
        const botManager = getBotManager();
        if (botManager?.enabled && typeof botManager.notifyUserExpiring === 'function') {
          for (const user of expiringUsers) {
            const daysRemaining = Math.ceil(
              (new Date(user.expireDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );

            await botManager.notifyUserExpiring({
              ...user,
              daysRemaining
            });
            notified += 1;
          }

          logger.info(`Notified ${notified} expiring users`);
        } else {
          logger.info('Telegram bot unavailable; skipping expiring-user notifications', {
            pendingNotifications: expiringUsers.length
          });
        }
      }

      const expiredCount = await prisma.user.updateMany({
        where: {
          status: 'ACTIVE',
          expireDate: {
            lt: new Date()
          }
        },
        data: {
          status: 'EXPIRED'
        }
      });

      if (expiredCount.count > 0) {
        logger.info(`Auto-expired ${expiredCount.count} users`);
      }

      return {
        expiringSoon: expiringUsers.length,
        notified,
        expired: expiredCount.count
      };
    } catch (error) {
      logger.error('Expiry check failed', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  start(schedule = '0 9 * * *') {
    if (!cron.validate(schedule)) {
      logger.warn('Invalid expiry checker cron schedule', { schedule });
      return null;
    }

    logger.info('Starting expiry checker schedule', { schedule });
    return cron.schedule(schedule, async () => {
      try {
        await this.run();
      } catch (error) {
        logger.error('Scheduled expiry check failed', {
          message: error.message,
          stack: error.stack
        });
      }
    });
  }
}

const expiryChecker = new ExpiryChecker();

module.exports = expiryChecker;
module.exports.runExpiryChecker = () => expiryChecker.run();
