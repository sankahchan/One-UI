const env = require('../config/env');
const logger = require('../config/logger');
const prisma = require('../config/database');

function toBigInt(value) {
  if (typeof value === 'bigint') {
    return value;
  }

  try {
    return BigInt(value || 0);
  } catch (_error) {
    return 0n;
  }
}

function clampBigInt(value, min = 0n) {
  return value < min ? min : value;
}

function bigIntToNumber(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return Number.MAX_SAFE_INTEGER;
}

class UsageSnapshotService {
  constructor() {
    this.lastUsage = new Map();
    this.deltaAverage = new Map();
    this.intervalHandle = null;
  }

  calculateDepletionDate(remainingBytes, deltaBytes, intervalSeconds, now) {
    if (remainingBytes <= 0n || deltaBytes <= 0n || intervalSeconds <= 0) {
      return null;
    }

    const ratePerSecond = bigIntToNumber(deltaBytes) / intervalSeconds;
    if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
      return null;
    }

    const secondsLeft = bigIntToNumber(remainingBytes) / ratePerSecond;
    if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) {
      return null;
    }

    return new Date(now.getTime() + secondsLeft * 1000);
  }

  detectAnomaly(userId, deltaBytes) {
    const average = this.deltaAverage.get(userId) || 0n;
    const minSpikeBytes = toBigInt(env.ANALYTICS_MIN_SPIKE_BYTES);
    const spikeFactor = Math.max(1.1, Number(env.ANALYTICS_SPIKE_FACTOR || 2.5));

    const isAnomaly =
      deltaBytes >= minSpikeBytes
      && average > 0n
      && bigIntToNumber(deltaBytes) >= bigIntToNumber(average) * spikeFactor;

    // Exponential moving average (alpha = 0.3) over BigInt using integer arithmetic.
    if (average <= 0n) {
      this.deltaAverage.set(userId, deltaBytes);
    } else {
      const nextAverage = (average * 7n + deltaBytes * 3n) / 10n;
      this.deltaAverage.set(userId, nextAverage);
    }

    const anomalyScore = average > 0n ? bigIntToNumber(deltaBytes) / Math.max(1, bigIntToNumber(average)) : 0;
    return {
      isAnomaly,
      anomalyScore
    };
  }

  async collectSnapshot() {
    if (!env.ANALYTICS_SNAPSHOTS_ENABLED) {
      return {
        created: 0,
        skipped: true
      };
    }

    const now = new Date();
    const intervalSeconds = Math.max(30, Number.parseInt(String(env.ANALYTICS_SNAPSHOT_INTERVAL_SECONDS || 300), 10));
    const windowStart = new Date(now.getTime() - intervalSeconds * 1000);

    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true,
        email: true,
        uploadUsed: true,
        downloadUsed: true,
        dataLimit: true
      }
    });

    if (users.length === 0) {
      return {
        created: 0,
        skipped: false
      };
    }

    const rows = [];
    for (const user of users) {
      const uploadUsed = toBigInt(user.uploadUsed);
      const downloadUsed = toBigInt(user.downloadUsed);
      const totalUsed = uploadUsed + downloadUsed;

      const previousUsage = this.lastUsage.get(user.id) || {
        upload: uploadUsed,
        download: downloadUsed
      };

      const uploadDelta = clampBigInt(uploadUsed - previousUsage.upload, 0n);
      const downloadDelta = clampBigInt(downloadUsed - previousUsage.download, 0n);
      const totalDelta = uploadDelta + downloadDelta;

      this.lastUsage.set(user.id, {
        upload: uploadUsed,
        download: downloadUsed
      });

      const dataLimit = toBigInt(user.dataLimit);
      const remainingBytes = dataLimit > 0n ? clampBigInt(dataLimit - totalUsed, 0n) : 0n;
      const usagePercent = dataLimit > 0n ? Math.min((bigIntToNumber(totalUsed) / Math.max(1, bigIntToNumber(dataLimit))) * 100, 100) : 0;
      const estimatedDepletionAt = this.calculateDepletionDate(remainingBytes, totalDelta, intervalSeconds, now);
      const anomaly = this.detectAnomaly(user.id, totalDelta);

      rows.push({
        userId: user.id,
        email: user.email,
        uploadDelta,
        downloadDelta,
        totalDelta,
        totalUsed,
        dataLimit,
        usagePercent,
        remainingBytes,
        estimatedDepletionAt,
        isAnomaly: anomaly.isAnomaly,
        anomalyScore: anomaly.isAnomaly ? anomaly.anomalyScore : null,
        windowStart,
        windowEnd: now
      });
    }

    await prisma.usageSnapshot.createMany({
      data: rows
    });

    return {
      created: rows.length,
      skipped: false
    };
  }

  async getLatestOverview(limit = 10) {
    const latest = await prisma.usageSnapshot.findFirst({
      orderBy: {
        windowEnd: 'desc'
      },
      select: {
        windowEnd: true
      }
    });

    if (!latest) {
      return {
        generatedAt: null,
        topConsumers: [],
        anomalies: [],
        depletionRisk: []
      };
    }

    const snapshots = await prisma.usageSnapshot.findMany({
      where: {
        windowEnd: latest.windowEnd
      },
      orderBy: [
        { totalDelta: 'desc' },
        { usagePercent: 'desc' }
      ],
      take: Math.max(limit * 3, 20)
    });

    const topConsumers = snapshots
      .slice(0, limit)
      .map((row) => ({
        userId: row.userId,
        email: row.email,
        totalDelta: row.totalDelta,
        totalUsed: row.totalUsed,
        dataLimit: row.dataLimit,
        usagePercent: row.usagePercent
      }));

    const anomalies = snapshots
      .filter((row) => row.isAnomaly)
      .slice(0, limit)
      .map((row) => ({
        userId: row.userId,
        email: row.email,
        totalDelta: row.totalDelta,
        anomalyScore: row.anomalyScore
      }));

    const depletionRisk = snapshots
      .filter((row) => row.estimatedDepletionAt)
      .sort((a, b) => {
        const aTime = new Date(a.estimatedDepletionAt).getTime();
        const bTime = new Date(b.estimatedDepletionAt).getTime();
        return aTime - bTime;
      })
      .slice(0, limit)
      .map((row) => ({
        userId: row.userId,
        email: row.email,
        estimatedDepletionAt: row.estimatedDepletionAt,
        remainingBytes: row.remainingBytes,
        usagePercent: row.usagePercent
      }));

    return {
      generatedAt: latest.windowEnd,
      topConsumers,
      anomalies,
      depletionRisk
    };
  }

  start() {
    if (this.intervalHandle || !env.ANALYTICS_SNAPSHOTS_ENABLED) {
      return;
    }

    const intervalSeconds = Math.max(30, Number.parseInt(String(env.ANALYTICS_SNAPSHOT_INTERVAL_SECONDS || 300), 10));
    const intervalMs = intervalSeconds * 1000;

    this.intervalHandle = setInterval(() => {
      void this.collectSnapshot().catch((error) => {
        logger.error('Usage snapshot collection failed', {
          message: error.message,
          stack: error.stack
        });
      });
    }, intervalMs);

    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }

    void this.collectSnapshot().catch((error) => {
      logger.error('Initial usage snapshot collection failed', {
        message: error.message,
        stack: error.stack
      });
    });

    logger.info('Usage snapshot collector started', {
      intervalSeconds
    });
  }

  stop() {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    logger.info('Usage snapshot collector stopped');
  }
}

module.exports = new UsageSnapshotService();
