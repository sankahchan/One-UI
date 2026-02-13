const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const xrayStatsCollector = require('./stats-collector');

class OnlineTracker {
  constructor() {
    this.cacheByUuid = new Map();
    this.lastRefreshAt = 0;
    this.refreshPromise = null;
  }

  get ttlMs() {
    return Math.max(5, Number(env.USER_ONLINE_TTL_SECONDS || 90)) * 1000;
  }

  get refreshIntervalMs() {
    return Math.max(1, Number(env.USER_ONLINE_REFRESH_INTERVAL_SECONDS || 5)) * 1000;
  }

  isEntryOnline(entry, now = Date.now()) {
    if (!entry || !entry.lastActivity || !entry.online) {
      return false;
    }

    const lastActivityMs = new Date(entry.lastActivity).getTime();
    if (Number.isNaN(lastActivityMs)) {
      return false;
    }

    return now - lastActivityMs <= this.ttlMs;
  }

  async ensureFresh(force = false) {
    const now = Date.now();
    const stale = now - this.lastRefreshAt >= this.refreshIntervalMs;
    if (!force && !stale && this.cacheByUuid.size > 0) {
      return;
    }

    await this.refresh(force);
  }

  async refresh(force = false) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshInternal(force).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async refreshInternal(_force = false) {
    const now = Date.now();
    const lookbackMs = Math.max(this.ttlMs * 4, 15 * 60 * 1000);
    const lookbackDate = new Date(now - lookbackMs);

    const [users, recentConnections] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          uuid: true,
          status: true,
          inbounds: {
            where: {
              enabled: true,
              inbound: {
                enabled: true
              }
            },
            select: {
              inboundId: true
            }
          }
        }
      }),
      prisma.connectionLog.findMany({
        where: {
          timestamp: {
            gte: lookbackDate
          }
        },
        include: {
          inbound: {
            select: {
              id: true,
              tag: true,
              protocol: true,
              port: true
            }
          }
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: 20_000
      })
    ]);

    const latestConnectionByUserId = new Map();
    const activeInboundSetByUserId = new Map();
    const latestActiveConnectByUserId = new Map();
    const dedupeByConnection = new Set();

    for (const connection of recentConnections) {
      if (!latestConnectionByUserId.has(connection.userId)) {
        latestConnectionByUserId.set(connection.userId, connection);
      }

      const ageMs = now - connection.timestamp.getTime();
      if (ageMs > this.ttlMs) {
        continue;
      }

      const connectionKey = `${connection.userId}:${connection.inboundId}:${connection.clientIp}`;
      if (dedupeByConnection.has(connectionKey)) {
        continue;
      }
      dedupeByConnection.add(connectionKey);

      if (String(connection.action).toLowerCase() !== 'connect') {
        continue;
      }

      if (!activeInboundSetByUserId.has(connection.userId)) {
        activeInboundSetByUserId.set(connection.userId, new Set());
      }
      activeInboundSetByUserId.get(connection.userId).add(connection.inboundId);

      if (!latestActiveConnectByUserId.has(connection.userId)) {
        latestActiveConnectByUserId.set(connection.userId, connection);
      }
    }

    const onlineUsers = users.filter((user) => {
      const activeSet = activeInboundSetByUserId.get(user.id);
      return Boolean(activeSet && activeSet.size > 0);
    });

    const statResults = await Promise.all(
      onlineUsers.map(async (user) => {
        try {
          const statKey = user.email || user.uuid;
          const stats = await xrayStatsCollector.getUserStats(statKey);
          return {
            userId: user.id,
            upload: Number(stats?.uplink || 0n),
            download: Number(stats?.downlink || 0n)
          };
        } catch (error) {
          logger.debug('Failed to get live user stats in online tracker', {
            userId: user.id,
            message: error.message
          });

          return {
            userId: user.id,
            upload: 0,
            download: 0
          };
        }
      })
    );

    const statByUserId = new Map(statResults.map((entry) => [entry.userId, entry]));
    const nextCache = new Map();

    for (const user of users) {
      const latestConnection = latestConnectionByUserId.get(user.id) || null;
      const activeConnection = latestActiveConnectByUserId.get(user.id) || null;
      const activeInboundSet = activeInboundSetByUserId.get(user.id) || new Set();
      const activeKeyCount = user.inbounds.length;
      const onlineKeyCount = activeInboundSet.size;
      const online = onlineKeyCount > 0;

      const displayConnection = activeConnection || latestConnection;
      const lastActivity = displayConnection?.timestamp
        ? displayConnection.timestamp.toISOString()
        : null;
      const liveStat = statByUserId.get(user.id) || { upload: 0, download: 0 };

      nextCache.set(user.uuid, {
        id: user.id,
        userId: user.id,
        email: user.email,
        uuid: user.uuid,
        status: user.status,
        online,
        state: online ? 'online' : String(latestConnection?.action || '').toLowerCase() === 'connect' ? 'idle' : 'offline',
        lastActivity,
        lastAction: latestConnection?.action || null,
        currentIp: displayConnection?.clientIp || null,
        currentInbound: displayConnection?.inbound
          ? {
              id: displayConnection.inbound.id,
              tag: displayConnection.inbound.tag,
              protocol: displayConnection.inbound.protocol,
              port: displayConnection.inbound.port
            }
          : null,
        protocol: displayConnection?.inbound?.protocol || null,
        upload: liveStat.upload,
        download: liveStat.download,
        activeKeyCount,
        onlineKeyCount
      });
    }

    this.cacheByUuid = nextCache;
    this.lastRefreshAt = Date.now();
  }

  getSnapshot() {
    const now = Date.now();

    return Array.from(this.cacheByUuid.values()).map((entry) => ({
      ...entry,
      online: this.isEntryOnline(entry, now),
      state: this.isEntryOnline(entry, now)
        ? 'online'
        : entry.lastAction === 'connect'
        ? 'idle'
        : 'offline'
    }));
  }

  async getHeartbeatMapByUserId(userIds = []) {
    await this.ensureFresh();

    const filterSet = new Set((Array.isArray(userIds) ? userIds : []).map((value) => Number.parseInt(value, 10)));
    const snapshots = this.getSnapshot();
    const map = new Map();

    for (const snapshot of snapshots) {
      if (filterSet.size > 0 && !filterSet.has(snapshot.userId)) {
        continue;
      }

      map.set(snapshot.userId, snapshot);
    }

    return map;
  }

  async getHeartbeatByUuid(uuid) {
    if (!uuid) {
      return null;
    }

    await this.ensureFresh();
    const entry = this.cacheByUuid.get(String(uuid));
    if (!entry) {
      return null;
    }

    return {
      ...entry,
      online: this.isEntryOnline(entry),
      state: this.isEntryOnline(entry) ? 'online' : entry.lastAction === 'connect' ? 'idle' : 'offline'
    };
  }

  async getOnlineUsers() {
    await this.ensureFresh();
    const snapshot = this.getSnapshot();
    return snapshot.filter((entry) => entry.online);
  }
}

module.exports = new OnlineTracker();
