const logger = require('../../config/logger');
const { mainMenuInlineKeyboard } = require('../keyboards/main-menu');
const statusCommand = require('../commands/status');
const usersCommand = require('../commands/users');
const systemCommand = require('../commands/system');
const reports = require('../notifications/reports');

async function handleCallback(bot, query) {
  const callbackData = query?.data || '';
  const chatId = query?.message?.chat?.id;

  if (!chatId) {
    return;
  }

  try {
    if (callbackData === 'menu:home') {
      await bot.sendMessage(chatId, 'Main menu', mainMenuInlineKeyboard());
    } else if (callbackData === 'main:status') {
      await statusCommand.handleStatus(bot, query.message);
    } else if (callbackData === 'main:users') {
      await usersCommand.sendUsersPage(bot, chatId, 1);
    } else if (callbackData === 'main:system') {
      await systemCommand.handleSystem(bot, query.message);
    } else if (callbackData === 'main:report') {
      await reports.sendDailyReportToChat(chatId);
    } else if (callbackData.startsWith('users:page:')) {
      const page = Number.parseInt(callbackData.split(':')[2] || '1', 10);
      await usersCommand.sendUsersPage(bot, chatId, page);
    } else if (callbackData.startsWith('user:detail:')) {
      const userId = Number.parseInt(callbackData.split(':')[2] || '', 10);
      await usersCommand.sendUserDetails(bot, chatId, userId);
    } else if (callbackData.startsWith('user:')) {
      const [, action, userId, extra] = callbackData.split(':');
      await usersCommand.performUserAction(bot, chatId, action, userId, extra);
    }
  } catch (error) {
    logger.error('Telegram callback handler failed', {
      callbackData,
      message: error.message,
      stack: error.stack
    });

    await bot.sendMessage(chatId, `Action failed: ${error.message}`);
  } finally {
    if (query.id) {
      await bot.answerCallbackQuery(query.id).catch(() => null);
    }
  }
}

module.exports = {
  handleCallback
};
