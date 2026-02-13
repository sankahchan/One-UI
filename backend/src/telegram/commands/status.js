const userService = require('../../services/user.service');
const xrayManager = require('../../xray/manager');
const { mainMenuInlineKeyboard } = require('../keyboards/main-menu');
const { requireTelegramAuth } = require('../middleware/auth');

function formatBigInt(value) {
  return (typeof value === 'bigint' ? value : BigInt(value || 0)).toString();
}

async function handleStatus(bot, msg) {
  if (!(await requireTelegramAuth(bot, msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const [stats, xrayStatus, xrayVersion] = await Promise.all([
    userService.getUserStats(),
    xrayManager.getStatus(),
    xrayManager.getVersion()
  ]);

  const text = [
    '*System Status*',
    '',
    `Users: ${stats.total}`,
    `Active: ${stats.active}`,
    `Expired: ${stats.expired}`,
    `Disabled: ${stats.disabled}`,
    '',
    `Total Upload: ${formatBigInt(stats.totalUpload)} bytes`,
    `Total Download: ${formatBigInt(stats.totalDownload)} bytes`,
    `Total Traffic: ${formatBigInt(stats.totalTraffic)} bytes`,
    '',
    `Xray Running: ${xrayStatus.running ? 'YES' : 'NO'}`,
    `Xray Version: ${xrayVersion || 'unknown'}`
  ].join('\n');

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...mainMenuInlineKeyboard()
  });
}

module.exports = {
  handleStatus
};
