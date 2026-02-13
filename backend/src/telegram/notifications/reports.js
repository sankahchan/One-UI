const env = require('../../config/env');
const prisma = require('../../config/database');
const userService = require('../../services/user.service');
const logger = require('../../config/logger');
const alerts = require('./alerts');

function getBotInstance() {
  const { getBot } = require('../bot');
  return getBot();
}

function bigintToString(value) {
  return (typeof value === 'bigint' ? value : BigInt(value || 0)).toString();
}

async function buildDailyReport() {
  const [userStats, inbounds, expiringSoon] = await Promise.all([
    userService.getUserStats(),
    prisma.inbound.count(),
    prisma.user.count({
      where: {
        status: 'ACTIVE',
        expireDate: {
          lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        }
      }
    })
  ]);

  return [
    '*Daily XRAY Panel Report*',
    '',
    `Users: ${userStats.total}`,
    `Active: ${userStats.active}`,
    `Expired: ${userStats.expired}`,
    `Disabled: ${userStats.disabled}`,
    `Inbounds: ${inbounds}`,
    '',
    `Total Upload: ${bigintToString(userStats.totalUpload)} bytes`,
    `Total Download: ${bigintToString(userStats.totalDownload)} bytes`,
    `Total Traffic: ${bigintToString(userStats.totalTraffic)} bytes`,
    '',
    `Expiring (next 3 days): ${expiringSoon}`
  ].join('\n');
}

async function sendDailyReport() {
  if (!env.TELEGRAM_ENABLED) {
    return;
  }

  const report = await buildDailyReport();
  await alerts.sendAlert(report, 'REPORT');
}

async function sendDailyReportToChat(chatId) {
  const bot = getBotInstance();
  if (!bot) {
    return;
  }

  try {
    const report = await buildDailyReport();
    await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to send daily report to chat', {
      chatId,
      message: error.message
    });

    await bot.sendMessage(chatId, `Failed to build report: ${error.message}`);
  }
}

module.exports = {
  buildDailyReport,
  sendDailyReport,
  sendDailyReportToChat
};
