const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const os = require('os');

const env = require('../config/env');
const logger = require('../config/logger');
const prisma = require('../config/database');
const xrayManager = require('../xray/manager');
const userService = require('../services/user.service');

const execPromise = util.promisify(exec);

class VPNTelegramBot {
  constructor() {
    this.token = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
    this.adminIds = this.parseAdminIds(env.TELEGRAM_ADMIN_IDS || process.env.TELEGRAM_ADMIN_IDS || '');

    if (!env.TELEGRAM_ENABLED) {
      logger.info('Telegram bot is disabled by TELEGRAM_ENABLED=false');
      this.enabled = false;
      return;
    }

    if (!this.token) {
      logger.warn('Telegram bot token not configured');
      this.enabled = false;
      return;
    }

    this.bot = new TelegramBot(this.token, { polling: env.TELEGRAM_POLLING });
    this.enabled = true;

    this.setupCommands();
    this.setupCallbacks();
    this.setupErrorHandling();

    logger.info('Telegram bot initialized successfully');
  }

  parseAdminIds(csv) {
    return String(csv)
      .split(',')
      .map((entry) => Number.parseInt(entry.trim(), 10))
      .filter((id) => Number.isInteger(id) && id > 0);
  }

  isAdmin(userId) {
    return this.adminIds.includes(Number(userId));
  }

  toNumber(value) {
    if (typeof value === 'bigint') {
      return Number(value);
    }

    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  formatBytes(bytes) {
    const input = this.toNumber(bytes);
    if (input === 0) {
      return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(input) / Math.log(k));
    return `${Number.parseFloat((input / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  setupCommands() {
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg?.chat?.id;
      const userId = msg?.from?.id;

      if (!chatId || !this.isAdmin(userId)) {
        if (chatId) {
          await this.bot.sendMessage(chatId, 'Unauthorized. This bot is for administrators only.');
        }
        return;
      }

      await this.showMainMenu(chatId);
    });

    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg?.chat?.id;
      const userId = msg?.from?.id;

      if (!chatId || !this.isAdmin(userId)) {
        return;
      }

      try {
        await this.sendSystemStatus(chatId);
      } catch (error) {
        await this.bot.sendMessage(chatId, `Error: ${error.message}`);
      }
    });

    this.bot.onText(/\/users/, async (msg) => {
      const chatId = msg?.chat?.id;
      const userId = msg?.from?.id;

      if (!chatId || !this.isAdmin(userId)) {
        return;
      }

      try {
        await this.sendUsersList(chatId);
      } catch (error) {
        await this.bot.sendMessage(chatId, `Error: ${error.message}`);
      }
    });

    this.bot.onText(/\/user (.+)/, async (msg, match) => {
      const chatId = msg?.chat?.id;
      const userId = msg?.from?.id;

      if (!chatId || !this.isAdmin(userId)) {
        return;
      }

      const email = (match?.[1] || '').trim();
      if (!email) {
        await this.bot.sendMessage(chatId, 'Usage: /user <email>');
        return;
      }

      try {
        await this.sendUserDetails(chatId, email);
      } catch (error) {
        await this.bot.sendMessage(chatId, `Error: ${error.message}`);
      }
    });

    this.bot.onText(/\/backup/, async (msg) => {
      const chatId = msg?.chat?.id;
      const userId = msg?.from?.id;

      if (!chatId || !this.isAdmin(userId)) {
        return;
      }

      try {
        await this.sendDatabaseBackup(chatId);
      } catch (error) {
        await this.bot.sendMessage(chatId, `Error: ${error.message}`);
      }
    });
  }

  setupCallbacks() {
    this.bot.on('callback_query', async (query) => {
      const chatId = query?.message?.chat?.id;
      const data = query?.data || '';

      if (!chatId) {
        return;
      }

      if (!this.isAdmin(query?.from?.id)) {
        await this.bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
        return;
      }

      try {
        await this.handleCallback(chatId, data, query);
      } catch (error) {
        await this.bot.answerCallbackQuery(query.id, {
          text: `Error: ${error.message}`,
          show_alert: true
        });
      }
    });
  }

  async handleCallback(chatId, data, query) {
    const [action, ...params] = String(data).split(':');

    switch (action) {
      case 'main_menu':
        await this.showMainMenu(chatId);
        await this.bot.answerCallbackQuery(query.id);
        break;
      case 'users':
        await this.sendUsersList(chatId);
        await this.bot.answerCallbackQuery(query.id);
        break;
      case 'user_detail': {
        const userId = Number.parseInt(params[0] || '', 10);
        if (!Number.isInteger(userId)) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Invalid user id' });
          return;
        }
        await this.sendUserDetailsById(chatId, userId);
        await this.bot.answerCallbackQuery(query.id);
        break;
      }
      case 'reset_traffic': {
        const resetUserId = Number.parseInt(params[0] || '', 10);
        if (!Number.isInteger(resetUserId)) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Invalid user id' });
          return;
        }
        await this.resetUserTraffic(chatId, resetUserId);
        await this.bot.answerCallbackQuery(query.id, { text: 'Traffic reset' });
        break;
      }
      case 'extend_expiry': {
        const extendUserId = Number.parseInt(params[0] || '', 10);
        const days = Number.parseInt(params[1] || '0', 10);
        if (!Number.isInteger(extendUserId) || !Number.isInteger(days) || days < 1) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Invalid expiry request' });
          return;
        }
        await this.extendUserExpiry(chatId, extendUserId, days);
        await this.bot.answerCallbackQuery(query.id, { text: `Extended by ${days} days` });
        break;
      }
      case 'disable_user': {
        const disableUserId = Number.parseInt(params[0] || '', 10);
        if (!Number.isInteger(disableUserId)) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Invalid user id' });
          return;
        }
        await this.disableUser(chatId, disableUserId);
        await this.bot.answerCallbackQuery(query.id, { text: 'User disabled' });
        break;
      }
      case 'system_stats':
        await this.sendSystemStatus(chatId);
        await this.bot.answerCallbackQuery(query.id);
        break;
      case 'xray_restart':
        await this.restartXray(chatId);
        await this.bot.answerCallbackQuery(query.id, { text: 'Restarting...' });
        break;
      case 'backup':
        await this.sendDatabaseBackup(chatId);
        await this.bot.answerCallbackQuery(query.id, { text: 'Creating backup...' });
        break;
      default:
        await this.bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
    }
  }

  setupErrorHandling() {
    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error', {
        message: error.message,
        stack: error.stack
      });
    });
  }

  async showMainMenu(chatId) {
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Users', callback_data: 'users' },
          { text: 'Statistics', callback_data: 'system_stats' }
        ],
        [
          { text: 'Restart Xray', callback_data: 'xray_restart' },
          { text: 'Backup', callback_data: 'backup' }
        ]
      ]
    };

    const message = [
      '*One-UI - Main Menu*',
      '',
      'Welcome to the admin panel.',
      'Choose an option below:'
    ].join('\n');

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async sendSystemStatus(chatId) {
    const [totalUsers, activeUsers, expiredUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'EXPIRED' } })
    ]);

    const trafficStats = await prisma.user.aggregate({
      _sum: {
        uploadUsed: true,
        downloadUsed: true
      }
    });

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = ((usedMem / totalMem) * 100).toFixed(2);
    const cpuLoad = os.loadavg()[0].toFixed(2);
    const uptime = os.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const upload = this.toNumber(trafficStats._sum.uploadUsed);
    const download = this.toNumber(trafficStats._sum.downloadUsed);
    const totalTraffic = upload + download;

    const message = [
      '*System Status*',
      `${new Date().toLocaleString()}`,
      '',
      '*System Resources*',
      `CPU Load: ${cpuLoad}`,
      `RAM: ${memUsage}% (${this.formatBytes(usedMem)}/${this.formatBytes(totalMem)})`,
      `Uptime: ${days}d ${hours}h ${minutes}m`,
      '',
      '*Users*',
      `Total: ${totalUsers}`,
      `Active: ${activeUsers}`,
      `Expired: ${expiredUsers}`,
      '',
      '*Traffic*',
      `Upload: ${this.formatBytes(upload)}`,
      `Download: ${this.formatBytes(download)}`,
      `Total: ${this.formatBytes(totalTraffic)}`
    ].join('\n');

    const keyboard = {
      inline_keyboard: [
        [{ text: 'Refresh', callback_data: 'system_stats' }],
        [{ text: 'Back', callback_data: 'main_menu' }]
      ]
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async sendUsersList(chatId, page = 1, limit = 10) {
    const pageNumber = Number.isInteger(page) && page > 0 ? page : 1;
    const pageSize = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const skip = (pageNumber - 1) * pageSize;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        take: pageSize,
        skip,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          status: true,
          uploadUsed: true,
          downloadUsed: true,
          dataLimit: true,
          expireDate: true
        }
      }),
      prisma.user.count()
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let message = `*User List* (Page ${pageNumber}/${totalPages})\n\n`;

    for (const user of users) {
      const totalUsed = this.toNumber(user.uploadUsed) + this.toNumber(user.downloadUsed);
      const dataLimit = Math.max(this.toNumber(user.dataLimit), 1);
      const usagePercent = ((totalUsed / dataLimit) * 100).toFixed(1);
      const daysLeft = Math.ceil((new Date(user.expireDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const statusEmoji = user.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';

      message += `${statusEmoji} ${user.email}\n`;
      message += `Usage: ${usagePercent}% | Days: ${daysLeft}\n\n`;
    }

    const userButtons = users.map((user) => [{ text: user.email.slice(0, 32), callback_data: `user_detail:${user.id}` }]);

    const keyboard = {
      inline_keyboard: [
        ...userButtons,
        [{ text: 'Back', callback_data: 'main_menu' }]
      ]
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async sendUserDetailsById(chatId, userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        inbounds: {
          include: {
            inbound: true
          }
        }
      }
    });

    if (!user) {
      await this.bot.sendMessage(chatId, 'User not found');
      return;
    }

    const upload = this.toNumber(user.uploadUsed);
    const download = this.toNumber(user.downloadUsed);
    const limit = this.toNumber(user.dataLimit);
    const totalUsed = upload + download;
    const remaining = Math.max(limit - totalUsed, 0);
    const usagePercent = limit > 0 ? ((totalUsed / limit) * 100).toFixed(2) : '0.00';
    const daysLeft = Math.ceil((new Date(user.expireDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    const statusLabel = {
      ACTIVE: 'ACTIVE',
      EXPIRED: 'EXPIRED',
      DISABLED: 'DISABLED',
      LIMITED: 'LIMITED'
    }[user.status] || user.status;

    const inbounds = user.inbounds
      .filter((ui) => ui.inbound)
      .map((ui) => `- ${ui.inbound.protocol} (${ui.inbound.port})`)
      .join('\n');

    const message = [
      '*User Details*',
      '',
      `Email: \`${user.email}\``,
      `UUID: \`${user.uuid}\``,
      `Status: ${statusLabel}`,
      '',
      '*Data Usage*',
      `Upload: ${this.formatBytes(upload)}`,
      `Download: ${this.formatBytes(download)}`,
      `Total Used: ${this.formatBytes(totalUsed)}`,
      `Data Limit: ${this.formatBytes(limit)}`,
      `Remaining: ${this.formatBytes(remaining)} (${usagePercent}%)`,
      '',
      '*Expiry*',
      `Expire Date: ${new Date(user.expireDate).toLocaleDateString()}`,
      `Days Remaining: ${daysLeft} days`,
      '',
      '*Inbounds*',
      inbounds || 'None'
    ].join('\n');

    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Reset Traffic', callback_data: `reset_traffic:${user.id}` },
          { text: '+7 Days', callback_data: `extend_expiry:${user.id}:7` }
        ],
        [
          { text: '+30 Days', callback_data: `extend_expiry:${user.id}:30` },
          { text: 'Disable', callback_data: `disable_user:${user.id}` }
        ],
        [{ text: 'Back to Users', callback_data: 'users' }]
      ]
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async sendUserDetails(chatId, email) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (!user) {
      await this.bot.sendMessage(chatId, 'User not found');
      return;
    }

    await this.sendUserDetailsById(chatId, user.id);
  }

  async resetUserTraffic(chatId, userId) {
    await userService.resetTraffic(userId);
    await this.sendUserDetailsById(chatId, userId);
  }

  async extendUserExpiry(chatId, userId, days) {
    await userService.extendExpiry(userId, days);
    await userService.updateUser(userId, { status: 'ACTIVE' });
    await this.sendUserDetailsById(chatId, userId);
  }

  async disableUser(chatId, userId) {
    await userService.updateUser(userId, { status: 'DISABLED' });
    await this.sendUserDetailsById(chatId, userId);
  }

  async restartXray(chatId) {
    await this.bot.sendMessage(chatId, 'Restarting Xray...');

    try {
      await xrayManager.restart();
      await this.bot.sendMessage(chatId, 'Xray restarted successfully');
    } catch (error) {
      await this.bot.sendMessage(chatId, `Restart failed: ${error.message}`);
    }
  }

  async sendDatabaseBackup(chatId) {
    await this.bot.sendMessage(chatId, 'Creating backup...');

    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupFile = `/tmp/backup-${timestamp}.sql`;
      await execPromise(`docker exec xray-panel-db pg_dump -U postgres xray_panel > ${backupFile}`);

      await this.bot.sendDocument(chatId, backupFile, {
        caption: `Database Backup\n${new Date().toLocaleString()}`
      });

      await fs.unlink(backupFile).catch(() => null);
    } catch (error) {
      await this.bot.sendMessage(chatId, `Backup failed: ${error.message}`);
    }
  }

  async sendAlert(message) {
    if (!this.enabled) {
      return;
    }

    for (const adminId of this.adminIds) {
      try {
        await this.bot.sendMessage(adminId, `*Alert*\n\n${message}`, {
          parse_mode: 'Markdown'
        });
      } catch (error) {
        logger.error('Failed to send alert', {
          adminId,
          message: error.message
        });
      }
    }
  }

  async sendPlainAlert(message) {
    if (!this.enabled) {
      return;
    }

    for (const adminId of this.adminIds) {
      try {
        await this.bot.sendMessage(adminId, `Alert\n\n${message}`);
      } catch (error) {
        logger.error('Failed to send plain alert', {
          adminId,
          message: error.message
        });
      }
    }
  }

  async notifyUserExpiring(user) {
    const message = [
      '*User Expiring Soon*',
      '',
      `Email: ${user.email}`,
      `Expires: ${new Date(user.expireDate).toLocaleDateString()}`,
      `Days remaining: ${user.daysRemaining}`
    ].join('\n');

    await this.sendAlert(message);
  }

  async notifyDataLimit(user) {
    const message = [
      '*User Data Limit Alert*',
      '',
      `Email: ${user.email}`,
      `Used: ${this.formatBytes(user.totalUsed)}`,
      `Limit: ${this.formatBytes(user.dataLimit)}`,
      `Remaining: ${(user.remainingPercent || 0).toFixed(1)}%`
    ].join('\n');

    await this.sendAlert(message);
  }

  async notifyLogin(username, ip) {
    const message = [
      '*Panel Login*',
      '',
      `User: ${username}`,
      `IP: ${ip}`,
      `Time: ${new Date().toLocaleString()}`
    ].join('\n');

    await this.sendAlert(message);
  }

  async notifyCPUThreshold(cpuUsage, threshold) {
    const message = [
      '*High CPU Usage*',
      '',
      `Current: ${cpuUsage}%`,
      `Threshold: ${threshold}%`,
      `Time: ${new Date().toLocaleString()}`
    ].join('\n');

    await this.sendAlert(message);
  }
}

let botInstance = null;

const initBot = () => {
  if (!botInstance) {
    botInstance = new VPNTelegramBot();
  }
  return botInstance;
};

const getBotManager = () => {
  return botInstance;
};

const getBot = () => {
  return botInstance?.bot || null;
};

const initializeTelegramBot = async () => {
  const manager = initBot();
  return manager?.bot || null;
};

const stopTelegramBot = async () => {
  if (!botInstance?.bot) {
    return;
  }

  try {
    await botInstance.bot.stopPolling();
  } catch (_error) {
    // ignore polling stop errors during shutdown
  } finally {
    botInstance = null;
  }
};

module.exports = {
  initBot,
  getBot,
  getBotManager,
  initializeTelegramBot,
  stopTelegramBot
};
