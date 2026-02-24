const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const xrayStatsCollector = require('./stats-collector');
const deviceTrackingService = require('../services/deviceTracking.service');

class OnlineTracker {
  constructor() {
    this.cacheByUuid = new Map();
    this.lastRefreshAt = 0;
    this.refreshPromise = null;
  }

  get ttlMs() {
    return Math.max(5, Number(env.USER_ONLINE_TTL_SECONDS || 60)) * 1000;
  }

  get refreshIntervalMs() {
    return Math.max(1, Number(env.USER_ONLINE_REFRESH_INTERVAL_SECONDS || 5)) * 1000;
  }

  get idleTtlMs() {
    return Math.max(
      this.ttlMs,
      Math.max(30, Number(env.USER_ONLINE_IDLE_TTL_SECONDS || 75)) * 1000
    );
  }

  get trafficTtlMs() {
    return Math.max(this.ttlMs, Math.min(this.idleTtlMs, 5 * 60 * 1000));
  }

  get deviceOnlineTtlMs() {
    return Math.max(
      this.ttlMs,
      Math.min(this.idleTtlMs, Math.max(30, Number(env.USER_ONLINE_DEVICE_TTL_SECONDS || 60)) * 1000)
    );
  }

  isEntryOnline(entry, now = Date.now()) {
    if (!entry || !entry.lastActivity || !entry.online) {
      return false;
    }

    const lastActivityMs = new Date(entry.lastActivity).getTime();
    if (Number.isNaN(lastActivityMs)) {
      return false;
    }

    const onlineWindowMs = Number.isFinite(Number(entry.onlineWindowMs))
      ? Number(entry.onlineWindowMs)
      : this.ttlMs;

    return now - lastActivityMs <= Math.max(this.ttlMs, onlineWindowMs);
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

    const [users, recentConnections, recentTraffic] = await Promise.all([
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
              inboundId: true,
              inbound: {
                select: {
                  id: true,
                  tag: true,
                  protocol: true,
                  port: true
                }
              }
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
      }),
      prisma.trafficLog.findMany({
        where: {
          timestamp: {
            gte: lookbackDate
          }
        },
        select: {
          userId: true,
          timestamp: true,
          upload: true,
          download: true
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: 20_000
      })
    ]);

    const latestConnectionByUserId = new Map();
    const latestConnectByUserId = new Map();
    const latestDisconnectByUserId = new Map();
    const activeInboundSetByUserId = new Map();
    const latestActiveConnectByUserId = new Map();
    const latestTrafficByUserId = new Map();
    const dedupeByConnection = new Set();

    for (const connection of recentConnections) {
      if (!latestConnectionByUserId.has(connection.userId)) {
        latestConnectionByUserId.set(connection.userId, connection);
      }

      const normalizedAction = String(connection.action || '').toLowerCase();
      if (normalizedAction === 'connect' && !latestConnectByUserId.has(connection.userId)) {
        latestConnectByUserId.set(connection.userId, connection);
      }
      if (normalizedAction === 'disconnect' && !latestDisconnectByUserId.has(connection.userId)) {
        latestDisconnectByUserId.set(connection.userId, connection);
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

      if (normalizedAction !== 'connect') {
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

    for (const log of recentTraffic) {
      if (latestTrafficByUserId.has(log.userId)) {
        continue;
      }

      const upload = Number(log.upload || 0n);
      const download = Number(log.download || 0n);
      if (upload <= 0 && download <= 0) {
        continue;
      }

      latestTrafficByUserId.set(log.userId, log);
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
      const latestConnect = latestConnectByUserId.get(user.id) || null;
      const latestDisconnect = latestDisconnectByUserId.get(user.id) || null;
      const activeConnection = latestActiveConnectByUserId.get(user.id) || null;
      const activeInboundSet = activeInboundSetByUserId.get(user.id) || new Set();
      const latestTrafficLog = latestTrafficByUserId.get(user.id) || null;
      const trafficActive = latestTrafficLog
        ? now - latestTrafficLog.timestamp.getTime() <= this.trafficTtlMs
        : false;
      const activeKeyCount = user.inbounds.length;
      const inboundById = new Map(
        (user.inbounds || [])
          .filter((relation) => relation?.inbound && Number.isInteger(relation?.inboundId))
          .map((relation) => [relation.inboundId, relation.inbound])
      );
      const activeDevices = deviceTrackingService.getActiveDevices(user.id).filter((device) => {
        const lastSeenAtMs = Number(device?.lastSeenAt || 0);
        if (!Number.isFinite(lastSeenAtMs) || lastSeenAtMs <= 0) {
          return false;
        }
        return now - lastSeenAtMs <= this.deviceOnlineTtlMs;
      });
      const latestDevice = activeDevices.reduce((currentLatest, device) => {
        if (!device?.lastSeenAt) {
          return currentLatest;
        }

        if (!currentLatest?.lastSeenAt) {
          return device;
        }

        return device.lastSeenAt > currentLatest.lastSeenAt ? device : currentLatest;
      }, null);

      const deviceInboundIds = new Set(
        activeDevices
          .map((device) => Number.parseInt(String(device.inboundId), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      );
      const mergedOnlineInboundIds = new Set([
        ...Array.from(activeInboundSet.values()),
        ...Array.from(deviceInboundIds.values())
      ]);

      const latestConnectMs = latestConnect?.timestamp instanceof Date ? latestConnect.timestamp.getTime() : null;
      const latestDisconnectMs =
        latestDisconnect?.timestamp instanceof Date ? latestDisconnect.timestamp.getTime() : null;
      const hasOpenConnect =
        Number.isFinite(latestConnectMs) &&
        now - latestConnectMs <= this.idleTtlMs &&
        (!Number.isFinite(latestDisconnectMs) || latestConnectMs > latestDisconnectMs);

      const online = mergedOnlineInboundIds.size > 0 || trafficActive || hasOpenConnect || activeDevices.length > 0;
      const onlineKeyCount = mergedOnlineInboundIds.size > 0
        ? mergedOnlineInboundIds.size
        : online && activeKeyCount > 0
          ? 1
          : 0;

      const displayConnection = activeConnection || latestConnect || latestConnection;
      const candidateTimestamps = [
        displayConnection?.timestamp instanceof Date ? displayConnection.timestamp.getTime() : null,
        latestTrafficLog?.timestamp instanceof Date ? latestTrafficLog.timestamp.getTime() : null,
        Number.isFinite(Number(latestDevice?.lastSeenAt)) ? Number(latestDevice.lastSeenAt) : null
      ].filter((value) => Number.isFinite(value));
      const newestActivityMs = candidateTimestamps.length > 0 ? Math.max(...candidateTimestamps) : null;
      const lastActivity = Number.isFinite(newestActivityMs) ? new Date(newestActivityMs).toISOString() : null;
      const lastPacketSeenAt = latestTrafficLog?.timestamp instanceof Date
        ? latestTrafficLog.timestamp.toISOString()
        : lastActivity;
      const liveStat = statByUserId.get(user.id) || { upload: 0, download: 0 };
      const deviceInbound = Number.isInteger(latestDevice?.inboundId)
        ? inboundById.get(latestDevice.inboundId) || null
        : null;
      const currentInbound = displayConnection?.inbound
        ? {
            id: displayConnection.inbound.id,
            tag: displayConnection.inbound.tag,
            protocol: displayConnection.inbound.protocol,
            port: displayConnection.inbound.port
          }
        : deviceInbound
          ? {
              id: deviceInbound.id,
              tag: deviceInbound.tag,
              protocol: deviceInbound.protocol,
              port: deviceInbound.port
            }
          : null;
      let onlineWindowMs = this.ttlMs;
      if (activeInboundSet.size > 0) {
        onlineWindowMs = this.ttlMs;
      } else if (trafficActive) {
        onlineWindowMs = this.trafficTtlMs;
      } else if (hasOpenConnect || activeDevices.length > 0) {
        onlineWindowMs = this.idleTtlMs;
      }

      nextCache.set(user.uuid, {
        id: user.id,
        userId: user.id,
        email: user.email,
        uuid: user.uuid,
        status: user.status,
        online,
        state: online ? 'online' : String(latestConnection?.action || '').toLowerCase() === 'connect' ? 'idle' : 'offline',
        lastActivity,
        lastPacketSeenAt,
        lastAction: displayConnection?.action || latestConnection?.action || null,
        currentIp: latestDevice?.clientIp || displayConnection?.clientIp || null,
        currentInbound,
        protocol: currentInbound?.protocol || null,
        upload: liveStat.upload,
        download: liveStat.download,
        activeKeyCount,
        onlineKeyCount,
        onlineWindowMs
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
