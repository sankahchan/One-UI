const env = require('../../config/env');
const logger = require('../../config/logger');
const prisma = require('../../config/database');

function getBotInstance() {
  const { getBot } = require('../bot');
  return getBot();
}

async function getAdminChatIds() {
  const staticIds = env.TELEGRAM_ADMIN_IDS.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const dbAdmins = await prisma.admin.findMany({
    where: {
      telegramId: {
        not: null
      }
    },
    select: {
      telegramId: true
    }
  });

  const dbIds = dbAdmins.map((admin) => admin.telegramId.toString());
  return Array.from(new Set([...staticIds, ...dbIds]));
}

async function sendAlert(message, level = 'INFO') {
  if (!env.TELEGRAM_ENABLED || !env.TELEGRAM_ALERTS_ENABLED) {
    return {
      sent: 0,
      skipped: true
    };
  }

  const bot = getBotInstance();
  if (!bot) {
    return {
      sent: 0,
      skipped: true
    };
  }

  const chatIds = await getAdminChatIds();
  let sent = 0;

  for (const chatId of chatIds) {
    try {
      await bot.sendMessage(chatId, `*${level}*\n${message}`, {
        parse_mode: 'Markdown'
      });
      sent += 1;
    } catch (error) {
      logger.warn('Failed to deliver Telegram alert', {
        chatId,
        message: error.message
      });
    }
  }

  return { sent, skipped: false };
}

module.exports = {
  getAdminChatIds,
  sendAlert
};
