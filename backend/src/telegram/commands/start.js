const { mainMenuReplyKeyboard, mainMenuInlineKeyboard } = require('../keyboards/main-menu');
const { requireTelegramAuth } = require('../middleware/auth');

async function handleStart(bot, msg) {
  if (!(await requireTelegramAuth(bot, msg))) {
    return;
  }

  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    '*XRAY Panel Bot*\n\nUse commands or the menu below to manage users, check system status, and receive reports.',
    {
      parse_mode: 'Markdown',
      ...mainMenuReplyKeyboard()
    }
  );

  await bot.sendMessage(chatId, 'Quick actions:', mainMenuInlineKeyboard());
}

module.exports = {
  handleStart
};
