const axios = require('axios');
const { execFile } = require('child_process');
const util = require('util');

const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const metrics = require('../observability/metrics');

const execFileAsync = util.promisify(execFile);

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

function readStatResult(payload) {
  const statNode = payload?.stat;

  if (Array.isArray(statNode)) {
    const firstWithValue = statNode.find(
      (entry) => entry?.value !== undefined && entry?.value !== null
    );
    const first = firstWithValue || statNode[0];
    return {
      value: parseBigInt(first?.value),
      found: first?.value !== undefined && first?.value !== null
    };
  }

  return {
    value: parseBigInt(statNode?.value),
    found: statNode?.value !== undefined && statNode?.value !== null
  };
}

function parseCliStatResult(stdout = '') {
  const normalized = String(stdout || '').trim();
  if (!normalized) {
    return {
      value: 0n,
      found: false
    };
  }

  try {
    const payload = JSON.parse(normalized);
    const parsed = readStatResult(payload);
    if (parsed.found) {
      return parsed;
    }
  } catch (_error) {
    // Fall back to text parsing for older xray CLI output variants.
  }

  const matched = normalized.match(/(?:"?value"?\s*:\s*|value:\s*)([0-9]+)/i);
  if (!matched) {
    return {
      value: 0n,
      found: false
    };
  }

  return {
    value: parseBigInt(matched[1]),
    found: true
  };
}

function parseApiServerFromUrl(apiUrl) {
  if (!apiUrl) {
    return '127.0.0.1:10085';
  }

  try {
    const parsed = new URL(String(apiUrl));
    const hostname = parsed.hostname || '127.0.0.1';
    const port = parsed.port || '10085';
    return `${hostname}:${port}`;
  } catch (_error) {
    const normalized = String(apiUrl).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
    return normalized || '127.0.0.1:10085';
  }
}

function getStatKeyCandidates(user) {
  const candidates = [user?.email, user?.uuid]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

class XrayStatsCollector {
  constructor() {
    this.apiUrl = env.XRAY_API_URL;
    this.lastStats = new Map();
    this.intervalHandle = null;
    this.transportPreference = null;
    const deployment = String(process.env.XRAY_DEPLOYMENT || '').toLowerCase();
    const serverFromUrl = parseApiServerFromUrl(this.apiUrl);
    const [, serverPort = '10085'] = serverFromUrl.split(':');
    const configuredApiListen = String(process.env.XRAY_API_LISTEN || '').trim();
    const cliHost =
      deployment === 'docker'
        ? configuredApiListen || '127.0.0.1'
        : serverFromUrl.split(':')[0] || '127.0.0.1';
    const defaultApiServerForCli = `${cliHost}:${serverPort || '10085'}`;
    this.apiServer =
      String(process.env.XRAY_API_SERVER || '').trim() || defaultApiServerForCli;
    this.cliTimeoutMs = Math.max(
      3000,
      Number.parseInt(String(process.env.XRAY_API_CLI_TIMEOUT_MS || 7000), 10) || 7000
    );
    this.xrayContainerName =
      String(process.env.XRAY_UPDATE_CONTAINER_NAME || process.env.CONTAINER_NAME || 'xray-core').trim() ||
      'xray-core';
    this.xrayBinary =
      String(process.env.XRAY_BINARY_PATH || process.env.XRAY_BINARY || 'xray').trim() || 'xray';
    this.http = axios.create({
      baseURL: this.apiUrl,
      timeout: 5000
    });

    const intervalMs = Math.max(5, env.TRAFFIC_SYNC_INTERVAL) * 1000;
    this.syncState = {
      running: false,
      intervalMs,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      lastUsersScanned: 0,
      lastUsersUpdated: 0,
      lastTrafficBytes: '0',
      lastDurationMs: 0
    };
  }

  get userStatsTransportOrder() {
    if (this.transportPreference === 'http') {
      return ['http', 'cli'];
    }
    if (this.transportPreference === 'cli') {
      return ['cli', 'http'];
    }
    return ['http', 'cli'];
  }

  async queryStatOverHttp(pattern, reset = false) {
    const response = await this.http.post('/stats/query', {
      pattern,
      reset
    });

    return readStatResult(response.data);
  }

  buildCliCommand(pattern, reset = false) {
    const args = [
      'api',
      'statsquery',
      `--server=${this.apiServer}`,
      '-pattern',
      pattern
    ];
    if (reset) {
      args.push('--reset');
    }

    if (String(process.env.XRAY_DEPLOYMENT || '').toLowerCase() === 'docker') {
      return {
        command: 'docker',
        args: ['exec', this.xrayContainerName, this.xrayBinary, ...args]
      };
    }

    return {
      command: this.xrayBinary,
      args
    };
  }

  async queryStatOverCli(pattern, reset = false) {
    const { command, args } = this.buildCliCommand(pattern, reset);
    const { stdout } = await execFileAsync(command, args, {
      timeout: this.cliTimeoutMs,
      maxBuffer: 1024 * 1024
    });

    return parseCliStatResult(stdout);
  }

  async queryStat(pattern, reset = false) {
    let lastError = null;

    for (const transport of this.userStatsTransportOrder) {
      try {
        const result =
          transport === 'http'
            ? await this.queryStatOverHttp(pattern, reset)
            : await this.queryStatOverCli(pattern, reset);

        this.transportPreference = transport;
        return result;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Failed to query Xray stats');
  }

  async collectStats() {
    const startedAt = Date.now();
    this.syncState.lastRunAt = new Date(startedAt).toISOString();

    try {
      const users = await prisma.user.findMany({
        where: {
          status: 'ACTIVE'
        },
        select: {
          id: true,
          uuid: true,
          email: true,
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
                  protocol: true
                }
              }
            }
          }
        }
      });

      const userTrafficDeltaById = new Map();
      const userStatsFoundById = new Set();
      const usersById = new Map(users.map((user) => [user.id, user]));
      let onlineUsers = 0;
      let updatedUsers = 0;
      let totalTrafficDelta = 0n;

      for (const user of users) {
        try {
          const stats = await this.getUserStatsForUser(user);
          if (!stats) {
            continue;
          }

          if (stats.found) {
            userStatsFoundById.add(user.id);
          }

          const lastStatKey = `user:${user.id}`;
          const lastStat = this.lastStats.get(lastStatKey) || {
            uplink: 0n,
            downlink: 0n
          };

          const uploadDelta = stats.uplink > lastStat.uplink ? stats.uplink - lastStat.uplink : 0n;
          const downloadDelta =
            stats.downlink > lastStat.downlink ? stats.downlink - lastStat.downlink : 0n;

          if (uploadDelta > 0n || downloadDelta > 0n) {
            const current = userTrafficDeltaById.get(user.id) || {
              upload: 0n,
              download: 0n
            };
            current.upload += uploadDelta;
            current.download += downloadDelta;
            userTrafficDeltaById.set(user.id, current);
          }

          this.lastStats.set(lastStatKey, {
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

      const inboundToUsers = new Map();
      for (const user of users) {
        for (const relation of user.inbounds || []) {
          const inbound = relation.inbound;
          if (!inbound?.tag) {
            continue;
          }
          if (!inboundToUsers.has(inbound.tag)) {
            inboundToUsers.set(inbound.tag, []);
          }
          inboundToUsers.get(inbound.tag).push({
            userId: user.id,
            inboundId: inbound.id,
            protocol: String(inbound.protocol || '').toUpperCase()
          });
        }
      }

      for (const [inboundTag, assignedUsers] of inboundToUsers.entries()) {
        if (!Array.isArray(assignedUsers) || assignedUsers.length !== 1) {
          continue;
        }

        const [entry] = assignedUsers;
        if (userStatsFoundById.has(entry.userId)) {
          continue;
        }

        try {
          const stats = await this.getInboundStats(inboundTag);
          if (!stats) {
            continue;
          }

          const lastStatKey = `inbound:${inboundTag}`;
          const lastStat = this.lastStats.get(lastStatKey) || {
            uplink: 0n,
            downlink: 0n
          };

          const uploadDelta = stats.uplink > lastStat.uplink ? stats.uplink - lastStat.uplink : 0n;
          const downloadDelta =
            stats.downlink > lastStat.downlink ? stats.downlink - lastStat.downlink : 0n;

          if (uploadDelta > 0n || downloadDelta > 0n) {
            const current = userTrafficDeltaById.get(entry.userId) || {
              upload: 0n,
              download: 0n
            };
            current.upload += uploadDelta;
            current.download += downloadDelta;
            userTrafficDeltaById.set(entry.userId, current);
          }

          this.lastStats.set(lastStatKey, {
            uplink: stats.uplink,
            downlink: stats.downlink
          });
        } catch (_error) {
          // Inbound stats fallback is best-effort for protocols like Shadowsocks.
        }
      }

      for (const [userId, delta] of userTrafficDeltaById.entries()) {
        if (delta.upload <= 0n && delta.download <= 0n) {
          continue;
        }

        const user = usersById.get(userId);
        if (!user) {
          continue;
        }

        await prisma.user.update({
          where: { id: userId },
          data: {
            uploadUsed: {
              increment: delta.upload
            },
            downloadUsed: {
              increment: delta.download
            }
          }
        });

        await prisma.trafficLog.create({
          data: {
            userId,
            upload: delta.upload,
            download: delta.download
          }
        });

        onlineUsers += 1;
        updatedUsers += 1;
        totalTrafficDelta += delta.upload + delta.download;
      }

      metrics.setOnlineUsers(onlineUsers);
      this.syncState.lastSuccessAt = new Date().toISOString();
      this.syncState.lastErrorAt = null;
      this.syncState.lastErrorMessage = null;
      this.syncState.consecutiveFailures = 0;
      this.syncState.lastUsersScanned = users.length;
      this.syncState.lastUsersUpdated = updatedUsers;
      this.syncState.lastTrafficBytes = totalTrafficDelta.toString();
      this.syncState.lastDurationMs = Date.now() - startedAt;
    } catch (error) {
      this.syncState.lastErrorAt = new Date().toISOString();
      this.syncState.lastErrorMessage = error.message || 'Xray stats collection failed';
      this.syncState.consecutiveFailures += 1;
      this.syncState.lastDurationMs = Date.now() - startedAt;
      logger.error('Xray stats collection failed', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  async getUserStats(userStatKey) {
    try {
      const statKey = String(userStatKey || '').trim();
      if (!statKey) {
        return null;
      }

      const [uplinkResult, downlinkResult] = await Promise.all([
        this.queryStat(`user>>>${statKey}>>>traffic>>>uplink`, false),
        this.queryStat(`user>>>${statKey}>>>traffic>>>downlink`, false)
      ]);

      return {
        uplink: uplinkResult.value,
        downlink: downlinkResult.value,
        found: Boolean(uplinkResult.found || downlinkResult.found),
        key: statKey
      };
    } catch (_error) {
      // Xray stats endpoint may be unavailable or a user may not have stats yet.
      return null;
    }
  }

  async getUserStatsForUser(user) {
    const candidates = getStatKeyCandidates(user);

    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const stats = await this.getUserStats(candidate);
      if (stats?.found) {
        return stats;
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Return the first candidate result even when no explicit stat key is found,
    // so deltas can still be computed where Xray returns 0-values.
    return this.getUserStats(candidates[0]);
  }

  async getInboundStats(inboundTag) {
    try {
      const tag = String(inboundTag || '').trim();
      if (!tag) {
        return null;
      }

      const [uplinkResult, downlinkResult] = await Promise.all([
        this.queryStat(`inbound>>>${tag}>>>traffic>>>uplink`, false),
        this.queryStat(`inbound>>>${tag}>>>traffic>>>downlink`, false)
      ]);

      return {
        uplink: uplinkResult.value,
        downlink: downlinkResult.value,
        found: Boolean(uplinkResult.found || downlinkResult.found),
        tag
      };
    } catch (_error) {
      return null;
    }
  }

  async checkHealth() {
    const result = await this.queryStat('user>>>one-ui-health-check>>>traffic>>>uplink', false);
    return {
      transport: this.transportPreference || 'unknown',
      found: Boolean(result?.found)
    };
  }

  getSyncStatus() {
    const now = Date.now();
    const running = Boolean(this.intervalHandle);
    const intervalMs = Number(this.syncState.intervalMs || Math.max(5, env.TRAFFIC_SYNC_INTERVAL) * 1000);
    const staleThresholdMs = Math.max(intervalMs * 3, 60_000);
    const lastSuccessEpoch = this.syncState.lastSuccessAt ? new Date(this.syncState.lastSuccessAt).getTime() : null;
    const lagMs = Number.isFinite(lastSuccessEpoch) && lastSuccessEpoch
      ? Math.max(0, now - lastSuccessEpoch)
      : null;

    let status = 'stopped';
    if (running) {
      if (!lastSuccessEpoch) {
        status = 'starting';
      } else if ((this.syncState.consecutiveFailures || 0) > 0) {
        status = 'degraded';
      } else if (lagMs !== null && lagMs <= staleThresholdMs) {
        status = 'healthy';
      } else {
        status = 'stale';
      }
    }

    return {
      status,
      running,
      transport: this.transportPreference || 'unknown',
      intervalMs,
      staleThresholdMs,
      lagMs,
      ...this.syncState
    };
  }

  async resetUserStats(userStatKey) {
    try {
      await Promise.all([
        this.queryStat(`user>>>${userStatKey}>>>traffic>>>uplink`, true),
        this.queryStat(`user>>>${userStatKey}>>>traffic>>>downlink`, true)
      ]);

      // We cannot always map stat keys back to user IDs safely (email/uuid can vary),
      // so clear cached counters to avoid stale deltas after a reset operation.
      this.lastStats.clear();
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
    this.syncState.running = true;
    this.syncState.intervalMs = intervalMs;

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
    this.syncState.running = false;
    logger.info('Traffic collection stopped');
  }
}

module.exports = new XrayStatsCollector();
