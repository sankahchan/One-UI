const env = require('../config/env');
const logger = require('../config/logger');
const telegramBot = require('../telegram/bot');

async function runBackup() {
    if (!env.BACKUP_ENABLED) {
        return;
    }

    const botManager = telegramBot.getBotManager();
    if (!botManager || !botManager.enabled) {
        logger.warn('Telegram backup skipped: Bot is not enabled.');
        return;
    }

    logger.info('Starting automated database backup job.');

    try {
        const adminIds = botManager.adminIds;
        if (!adminIds || adminIds.length === 0) {
            logger.warn('No Telegram admins configured for backup delivery.');
            return;
        }

        // Dispatch to the primary configured Telegram Admin
        await botManager.sendDatabaseBackup(adminIds[0]);
        logger.info('Automated backup successfully dispatched via Telegram.');
    } catch (error) {
        logger.error('Failed to dispatch automated backup', { message: error.message });
    }
}

module.exports = {
    runBackup
};
