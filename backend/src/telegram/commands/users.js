const userService = require('../../services/user.service');
const { userActionsKeyboard } = require('../keyboards/user-actions');
const { requireTelegramAuth } = require('../middleware/auth');

const PAGE_SIZE = 10;

function userSummaryLine(user) {
  const days = typeof user.daysRemaining === 'number' ? user.daysRemaining : '-';
  return `#${user.id} ${user.email} | ${user.status} | ${days}d`;
}

async function sendUsersPage(bot, chatId, page = 1) {
  const pageNumber = Number.isFinite(page) && page > 0 ? page : 1;
  const result = await userService.getUsers({ page: pageNumber, limit: PAGE_SIZE });

  const header = `*Users (page ${result.pagination.page}/${result.pagination.totalPages || 1})*`;
  const lines = result.users.length > 0 ? result.users.map(userSummaryLine) : ['No users found'];
  const text = [header, '', ...lines, '', 'Use `/user <id>` for details.'].join('\n');

  const navButtons = [];
  if (result.pagination.page > 1) {
    navButtons.push({ text: 'Prev', callback_data: `users:page:${result.pagination.page - 1}` });
  }
  if (result.pagination.page < result.pagination.totalPages) {
    navButtons.push({ text: 'Next', callback_data: `users:page:${result.pagination.page + 1}` });
  }

  const inlineKeyboard = [
    ...result.users.map((user) => [{ text: `${user.id}. ${user.email}`, callback_data: `user:detail:${user.id}` }]),
    navButtons,
    [{ text: 'Main Menu', callback_data: 'menu:home' }]
  ].filter((row) => row.length > 0);

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
}

async function sendUserDetails(bot, chatId, userId) {
  const user = await userService.getUserById(userId);

  const text = [
    `*User #${user.id}*`,
    '',
    `Email: ${user.email}`,
    `Status: ${user.status}`,
    `UUID: ${user.uuid}`,
    `Data Limit: ${(user.dataLimit || 0n).toString()} bytes`,
    `Used: ${(user.totalUsed || 0n).toString()} bytes`,
    `Remaining: ${(user.remaining || 0n).toString()} bytes`,
    `Expires: ${new Date(user.expireDate).toISOString()}`,
    `Days Remaining: ${user.daysRemaining}`
  ].join('\n');

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...userActionsKeyboard(user)
  });
}

async function performUserAction(bot, chatId, action, userId, extra) {
  const id = Number.parseInt(String(userId), 10);
  if (!Number.isInteger(id) || id < 1) {
    await bot.sendMessage(chatId, 'Invalid user id.');
    return;
  }

  switch (action) {
    case 'reset': {
      await userService.resetTraffic(id);
      await bot.sendMessage(chatId, `Traffic reset for user #${id}.`);
      await sendUserDetails(bot, chatId, id);
      return;
    }
    case 'extend': {
      const days = Number.parseInt(String(extra || '30'), 10);
      await userService.extendExpiry(id, Number.isInteger(days) && days > 0 ? days : 30);
      await bot.sendMessage(chatId, `Expiry extended for user #${id}.`);
      await sendUserDetails(bot, chatId, id);
      return;
    }
    case 'disable': {
      await userService.updateUser(id, { status: 'DISABLED' });
      await bot.sendMessage(chatId, `User #${id} disabled.`);
      await sendUserDetails(bot, chatId, id);
      return;
    }
    case 'enable': {
      await userService.updateUser(id, { status: 'ACTIVE' });
      await bot.sendMessage(chatId, `User #${id} enabled.`);
      await sendUserDetails(bot, chatId, id);
      return;
    }
    case 'delete': {
      await userService.deleteUser(id);
      await bot.sendMessage(chatId, `User #${id} deleted.`);
      await sendUsersPage(bot, chatId, 1);
      return;
    }
    default:
      await bot.sendMessage(chatId, 'Unsupported user action.');
  }
}

async function handleUsersCommand(bot, msg, match) {
  if (!(await requireTelegramAuth(bot, msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const page = Number.parseInt(match?.[1] || '1', 10);
  await sendUsersPage(bot, chatId, page);
}

async function handleUserCommand(bot, msg, match) {
  if (!(await requireTelegramAuth(bot, msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const userId = Number.parseInt(match?.[1] || '', 10);

  if (!Number.isInteger(userId) || userId < 1) {
    await bot.sendMessage(chatId, 'Usage: /user <id>');
    return;
  }

  await sendUserDetails(bot, chatId, userId);
}

module.exports = {
  handleUsersCommand,
  handleUserCommand,
  sendUsersPage,
  sendUserDetails,
  performUserAction
};
