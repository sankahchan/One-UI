const axios = require('axios');

const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const metrics = require('../observability/metrics');

function parseBigInt(value) {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return 0n;
    }

    return BigInt(Math.floor(value));
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return 0n;
    }

    try {
      return BigInt(normalized);
    } catch (_error) {
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return 0n;
      }

      return BigInt(Math.floor(parsed));
    }
  }

  return 0n;
}

function readStatValue(payload) {
  const statNode = payload?.stat;

  if (Array.isArray(statNode)) {
    return parseBigInt(statNode[0]?.value);
  }

  return parseBigInt(statNode?.value);
}

class XrayStatsCollector {
  constructor() {
    this.apiUrl = env.XRAY_API_URL;
    this.lastStats = new Map();
    this.intervalHandle = null;
    this.http = axios.create({
      baseURL: this.apiUrl,
      timeout: 5000
    });
  }

  async collectStats() {
    try {
      const users = await prisma.user.findMany({
        where: {
          status: 'ACTIVE'
        },
        select: {
          id: true,
          uuid: true,
          email: true
        }
      });

      let onlineUsers = 0;

      for (const user of users) {
        try {
          const userStatKey = user.email || user.uuid;
          const stats = await this.getUserStats(userStatKey);
          if (!stats) {
            continue;
          }

          if (stats.uplink > 0n || stats.downlink > 0n) {
            onlineUsers += 1;
          }

          const lastStat = this.lastStats.get(userStatKey) || {
            uplink: 0n,
            downlink: 0n
          };

          const uploadDelta = stats.uplink > lastStat.uplink ? stats.uplink - lastStat.uplink : 0n;
          const downloadDelta =
            stats.downlink > lastStat.downlink ? stats.downlink - lastStat.downlink : 0n;

          if (uploadDelta > 0n || downloadDelta > 0n) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                uploadUsed: {
                  increment: uploadDelta
                },
                downloadUsed: {
                  increment: downloadDelta
                }
              }
            });

            await prisma.trafficLog.create({
              data: {
                userId: user.id,
                upload: uploadDelta,
                download: downloadDelta
              }
            });
          }

          this.lastStats.set(userStatKey, {
            uplink: stats.uplink,
            downlink: stats.downlink
          });
        } catch (error) {
          logger.error('Failed to collect Xray stats for user', {
            email: user.email,
            message: error.message
          });
        }
      }

      metrics.setOnlineUsers(onlineUsers);
    } catch (error) {
      logger.error('Xray stats collection failed', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  async getUserStats(userStatKey) {
    try {
      const [uplinkResponse, downlinkResponse] = await Promise.all([
        this.http.post('/stats/query', {
          pattern: `user>>>${userStatKey}>>>traffic>>>uplink`,
          reset: false
        }),
        this.http.post('/stats/query', {
          pattern: `user>>>${userStatKey}>>>traffic>>>downlink`,
          reset: false
        })
      ]);

      const uplink = readStatValue(uplinkResponse.data);
      const downlink = readStatValue(downlinkResponse.data);

      return { uplink, downlink };
    } catch (_error) {
      // Xray stats endpoint may be unavailable or a user may not have stats yet.
      return null;
    }
  }

  async resetUserStats(userStatKey) {
    try {
      await Promise.all([
        this.http.post('/stats/query', {
          pattern: `user>>>${userStatKey}>>>traffic>>>uplink`,
          reset: true
        }),
        this.http.post('/stats/query', {
          pattern: `user>>>${userStatKey}>>>traffic>>>downlink`,
          reset: true
        })
      ]);

      this.lastStats.delete(userStatKey);
      return true;
    } catch (error) {
      logger.error('Failed to reset Xray user stats', {
        userStatKey,
        message: error.message
      });
      return false;
    }
  }

  startCollection() {
    if (this.intervalHandle) {
      return;
    }

    const intervalMs = Math.max(5, env.TRAFFIC_SYNC_INTERVAL) * 1000;

    this.intervalHandle = setInterval(() => {
      void this.collectStats();
    }, intervalMs);

    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }

    void this.collectStats();
    logger.info(`Traffic collection started (interval: ${intervalMs}ms)`);
  }

  stopCollection() {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    logger.info('Traffic collection stopped');
  }
}

module.exports = new XrayStatsCollector();
