const os = require('node:os');
const crypto = require('node:crypto');

const prisma = require('../config/database');
const logger = require('../config/logger');

class WorkerLockService {
  constructor() {
    this.defaultOwnerId = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
  }

  getDefaultOwnerId() {
    return this.defaultOwnerId;
  }

  async acquire(name, ownerId, ttlSeconds = 45, metadata = null) {
    if (!name || !ownerId) {
      throw new Error('Lock name and ownerId are required');
    }

    const ttl = Math.max(15, Number.parseInt(String(ttlSeconds), 10) || 45);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    try {
      const lock = await prisma.$transaction(async (tx) => {
        const existing = await tx.workerLock.findUnique({
          where: { name }
        });

        if (!existing) {
          return tx.workerLock.create({
            data: {
              name,
              ownerId,
              heartbeatAt: now,
              expiresAt,
              metadata: metadata || undefined
            }
          });
        }

        const isExpired = existing.expiresAt.getTime() <= now.getTime();
        const sameOwner = existing.ownerId === ownerId;
        if (!sameOwner && !isExpired) {
          return null;
        }

        return tx.workerLock.update({
          where: { name },
          data: {
            ownerId,
            heartbeatAt: now,
            expiresAt,
            metadata: metadata || existing.metadata || undefined
          }
        });
      });

      return {
        acquired: Boolean(lock),
        lock
      };
    } catch (error) {
      if (error.code === 'P2002') {
        // Unique race: retry once.
        return this.acquire(name, ownerId, ttl, metadata);
      }

      logger.error('Failed to acquire worker lock', {
        name,
        ownerId,
        message: error.message
      });
      throw error;
    }
  }

  async heartbeat(name, ownerId, ttlSeconds = 45, metadata = null) {
    return this.acquire(name, ownerId, ttlSeconds, metadata);
  }

  async release(name, ownerId) {
    if (!name || !ownerId) {
      return false;
    }

    const result = await prisma.workerLock.deleteMany({
      where: {
        name,
        ownerId
      }
    });

    return result.count > 0;
  }

  async get(name) {
    if (!name) {
      return null;
    }

    return prisma.workerLock.findUnique({
      where: { name }
    });
  }
}

module.exports = new WorkerLockService();
