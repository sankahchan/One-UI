const os = require('node:os');

const env = require('../config/env');
const prisma = require('../config/database');
const logger = require('../config/logger');
const WorkerRuntime = require('./runtime');
const workerLockService = require('../services/workerLock.service');
const startupGates = require('../startup/gates');

const runtime = new WorkerRuntime('worker-process');

async function startWorker() {
  const ownerId = `${os.hostname()}:${process.pid}:${workerLockService.getDefaultOwnerId()}`;
  const lockName = env.WORKER_LOCK_NAME;
  const ttlSeconds = Math.max(20, Number(env.WORKER_LOCK_TTL_SECONDS || 45));
  const heartbeatMs = Math.max(5, Number(env.WORKER_HEARTBEAT_INTERVAL_SECONDS || 15)) * 1000;
  const retryMs = Math.max(1000, Number(env.WORKER_RETRY_MS || 10000));

  let hasLock = false;
  let retryTimer = null;
  let heartbeatTimer = null;
  let stopping = false;

  const stopTimers = () => {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const releaseLock = async () => {
    if (!hasLock) {
      return;
    }

    try {
      await workerLockService.release(lockName, ownerId);
      hasLock = false;
    } catch (error) {
      logger.warn('Failed to release worker lock', {
        lockName,
        ownerId,
        message: error.message
      });
    }
  };

  const shutdown = async (signal) => {
    if (stopping) {
      return;
    }

    stopping = true;
    logger.info(`Worker received ${signal}; shutting down`);
    stopTimers();
    await runtime.stop();
    await releaseLock();
    await prisma.$disconnect();
    process.exit(0);
  };

  const ensureLock = async () => {
    if (stopping) {
      return;
    }

    try {
      const result = await workerLockService.acquire(lockName, ownerId, ttlSeconds, {
        pid: process.pid,
        hostname: os.hostname(),
        mode: env.WORKER_MODE
      });

      if (!result.acquired) {
        if (hasLock) {
          logger.warn('Worker lock lost, stopping runtime', {
            lockName
          });
          hasLock = false;
          await runtime.stop();
        }
        return;
      }

      if (!hasLock) {
        hasLock = true;
        logger.info('Worker lock acquired', {
          lockName,
          ownerId
        });
        await runtime.start();
      }
    } catch (error) {
      logger.error('Worker lock ensure failed', {
        lockName,
        message: error.message,
        stack: error.stack
      });
    }
  };

  try {
    await startupGates.runStartupMigrationGate();
    await prisma.$connect();
    await startupGates.runStartupHealthGate();
    logger.info('Worker process started', {
      mode: env.WORKER_MODE,
      lockName,
      ownerId
    });

    await ensureLock();

    retryTimer = setInterval(() => {
      void ensureLock();
    }, retryMs);

    heartbeatTimer = setInterval(() => {
      if (!hasLock) {
        return;
      }
      void workerLockService.heartbeat(lockName, ownerId, ttlSeconds, {
        pid: process.pid,
        hostname: os.hostname(),
        mode: env.WORKER_MODE
      }).then((result) => {
        if (!result.acquired && hasLock) {
          hasLock = false;
          logger.warn('Worker heartbeat lost lock, stopping runtime', { lockName });
          void runtime.stop();
        }
      }).catch((error) => {
        logger.warn('Worker heartbeat failed', {
          message: error.message
        });
      });
    }, heartbeatMs);

    if (typeof retryTimer.unref === 'function') {
      retryTimer.unref();
    }
    if (typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref();
    }

    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  } catch (error) {
    logger.error('Failed to start worker process', {
      message: error.message,
      stack: error.stack
    });
    stopTimers();
    await runtime.stop();
    await releaseLock();
    await prisma.$disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  void startWorker();
}

module.exports = {
  startWorker
};
