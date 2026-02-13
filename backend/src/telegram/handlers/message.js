const startCommand = require('../commands/start');
const statusCommand = require('../commands/status');
const usersCommand = require('../commands/users');
const systemCommand = require('../commands/system');
const reports = require('../notifications/reports');

async function handleMessage(bot, msg) {
  if (!msg?.text) {
    return;
  }

  const text = msg.text.trim();

  if (text.startsWith('/')) {
    return;
  }

  if (text === '📊 Status') {
    await statusCommand.handleStatus(bot, msg);
  } else if (text === '👥 Users') {
    await usersCommand.handleUsersCommand(bot, msg, [null, '1']);
  } else if (text === '🖥 System') {
    await systemCommand.handleSystem(bot, msg);
  } else if (text === '📄 Report') {
    await reports.sendDailyReportToChat(msg.chat.id);
  } else if (text.toLowerCase() === 'menu') {
    await startCommand.handleStart(bot, msg);
  }
}

module.exports = {
  handleMessage
};
