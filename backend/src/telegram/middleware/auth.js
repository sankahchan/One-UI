const env = require('../../config/env');
const logger = require('../../config/logger');
const prisma = require('../../config/database');

function getStaticAdminIds() {
  return new Set(
    env.TELEGRAM_ADMIN_IDS.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

async function isAuthorizedChat(chatId) {
  const chatIdStr = String(chatId);
  const staticAdmins = getStaticAdminIds();

  if (staticAdmins.has(chatIdStr)) {
    return true;
  }

  try {
    const admin = await prisma.admin.findFirst({
      where: {
        telegramId: BigInt(chatIdStr)
      }
    });

    return Boolean(admin);
  } catch (error) {
    logger.warn('Telegram auth lookup failed', {
      chatId: chatIdStr,
      message: error.message
    });
    return false;
  }
}

async function requireTelegramAuth(bot, msg) {
  const chatId = msg?.chat?.id;

  if (!chatId) {
    return false;
  }

  const authorized = await isAuthorizedChat(chatId);
  if (!authorized) {
    await bot.sendMessage(
      chatId,
      'Access denied. This Telegram account is not linked to an admin.',
      {
        parse_mode: 'Markdown'
      }
    );
    return false;
  }

  return true;
}

module.exports = {
  isAuthorizedChat,
  requireTelegramAuth
};
