const os = require('os');
const { exec } = require('child_process');
const util = require('util');

const env = require('../config/env');
const { getBotManager } = require('../telegram/bot');
const logger = require('../config/logger');

const execPromise = util.promisify(exec);

class SystemMonitor {
  constructor() {
    this.cpuThreshold = env.CPU_THRESHOLD;
    this.memoryThreshold = env.MEMORY_THRESHOLD;
    this.diskThreshold = env.DISK_THRESHOLD;
    this.alertCooldown = env.SYSTEM_MONITOR_ALERT_COOLDOWN * 1000;
    this.intervalMs = env.SYSTEM_MONITOR_INTERVAL * 1000;

    this.lastAlerts = new Map();
    this.intervalHandle = null;
  }

  async getSystemStats() {
    return {
      cpu: await this.getCPUUsage(),
      memory: this.getMemoryUsage(),
      disk: await this.getDiskUsage(),
      uptime: this.getUptime(),
      timestamp: new Date()
    };
  }

  getCPUUsage() {
    return new Promise((resolve) => {
      const start = os.cpus();

      setTimeout(() => {
        const end = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        for (let i = 0; i < start.length; i += 1) {
          const startCpu = start[i];
          const endCpu = end[i];

          const idle = endCpu.times.idle - startCpu.times.idle;
          const total = Object.keys(endCpu.times).reduce(
            (acc, key) => acc + (endCpu.times[key] - startCpu.times[key]),
            0
          );

          totalIdle += idle;
          totalTick += total;
        }

        if (totalTick <= 0) {
          resolve(0);
          return;
        }

        const usage = 100 - Math.round((100 * totalIdle) / totalTick);
        resolve(Math.max(0, Math.min(100, usage)));
      }, 150);
    });
  }

  getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return {
      total,
      used,
      free,
      percentage: Math.round((used / total) * 100)
    };
  }

  async getDiskUsage() {
    try {
      const { stdout } = await execPromise('df -k / | tail -1');
      const parts = stdout.trim().split(/\s+/);

      if (parts.length < 6) {
        return null;
      }

      const usedPercentRaw = parts[4] || '0%';
      const percentage = Number.parseInt(usedPercentRaw.replace('%', ''), 10);

      return {
        totalKb: Number.parseInt(parts[1], 10) || 0,
        usedKb: Number.parseInt(parts[2], 10) || 0,
        availableKb: Number.parseInt(parts[3], 10) || 0,
        percentage: Number.isFinite(percentage) ? percentage : 0
      };
    } catch (_error) {
      return null;
    }
  }

  getUptime() {
    const uptime = os.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    return {
      seconds: uptime,
      formatted: `${days}d ${hours}h ${minutes}m`
    };
  }

  async checkThresholds() {
    const stats = await this.getSystemStats();

    if (stats.cpu > this.cpuThreshold) {
      await this.sendThresholdAlert('CPU', stats.cpu, this.cpuThreshold);
    }

    if (stats.memory.percentage > this.memoryThreshold) {
      await this.sendThresholdAlert('Memory', stats.memory.percentage, this.memoryThreshold);
    }

    if (stats.disk && stats.disk.percentage > this.diskThreshold) {
      await this.sendThresholdAlert('Disk', stats.disk.percentage, this.diskThreshold);
    }
  }

  async sendThresholdAlert(resource, current, threshold) {
    const alertKey = `${resource}-${threshold}`;
    const lastAlertAt = this.lastAlerts.get(alertKey);

    if (lastAlertAt && Date.now() - lastAlertAt < this.alertCooldown) {
      return;
    }

    try {
      const botManager = getBotManager();
      if (!botManager?.enabled || typeof botManager.sendAlert !== 'function') {
        logger.info('Telegram bot unavailable; system threshold alert not sent', {
          resource,
          current,
          threshold
        });
        return;
      }

      await botManager.sendAlert(
        `*${resource} Threshold Alert*\n\nCurrent: ${current}%\nThreshold: ${threshold}%\nTime: ${new Date().toLocaleString()}`
      );

      this.lastAlerts.set(alertKey, Date.now());
    } catch (error) {
      logger.error('Failed to send threshold alert', {
        resource,
        current,
        threshold,
        message: error.message
      });
    }
  }

  startMonitoring() {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.checkThresholds();
    }, this.intervalMs);

    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }

    void this.checkThresholds();
    logger.info('System monitoring started', {
      intervalMs: this.intervalMs,
      cpuThreshold: this.cpuThreshold,
      memoryThreshold: this.memoryThreshold,
      diskThreshold: this.diskThreshold
    });
  }

  stopMonitoring() {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    logger.info('System monitoring stopped');
  }
}

module.exports = new SystemMonitor();
