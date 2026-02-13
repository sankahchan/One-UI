const os = require('os');

const prisma = require('../../config/database');
const { mainMenuInlineKeyboard } = require('../keyboards/main-menu');
const { requireTelegramAuth } = require('../middleware/auth');

async function handleSystem(bot, msg) {
  if (!(await requireTelegramAuth(bot, msg))) {
    return;
  }

  const chatId = msg.chat.id;

  const [admins, users, inbounds, trafficLogs, systemLogs] = await Promise.all([
    prisma.admin.count(),
    prisma.user.count(),
    prisma.inbound.count(),
    prisma.trafficLog.count(),
    prisma.systemLog.count()
  ]);

  const memoryUsedMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const uptimeMinutes = Math.round(process.uptime() / 60);

  const text = [
    '*System Overview*',
    '',
    `Admins: ${admins}`,
    `Users: ${users}`,
    `Inbounds: ${inbounds}`,
    `Traffic Logs: ${trafficLogs}`,
    `System Logs: ${systemLogs}`,
    '',
    `Host: ${os.hostname()}`,
    `Platform: ${os.platform()} ${os.release()}`,
    `Node Memory: ${memoryUsedMb} MB`,
    `Process Uptime: ${uptimeMinutes} minutes`
  ].join('\n');

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...mainMenuInlineKeyboard()
  });
}

module.exports = {
  handleSystem
};
