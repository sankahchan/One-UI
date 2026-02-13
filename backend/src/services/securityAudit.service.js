const prisma = require('../config/database');
const logger = require('../config/logger');

const LOG_LEVELS = new Set(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);

function normalizeLevel(level) {
  const normalized = String(level || 'INFO').trim().toUpperCase();
  if (LOG_LEVELS.has(normalized)) {
    return normalized;
  }
  return 'INFO';
}

function normalizeMessage(message) {
  const text = String(message || '').trim();
  return text || 'SECURITY_EVENT';
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return metadata;
}

class SecurityAuditService {
  async log({ message, level = 'INFO', metadata = {} } = {}) {
    const normalizedLevel = normalizeLevel(level);
    const normalizedMessage = normalizeMessage(message);
    const normalizedMetadata = normalizeMetadata(metadata);

    try {
      await prisma.systemLog.create({
        data: {
          level: normalizedLevel,
          message: normalizedMessage,
          metadata: normalizedMetadata
        }
      });

      if (normalizedLevel === 'CRITICAL') {
        // Lazy-load to avoid circular import issues during service bootstrap.
        const webhookService = require('./webhook.service');
        webhookService.emitEvent(
          'security.critical',
          {
            message: normalizedMessage,
            metadata: normalizedMetadata
          },
          {
            severity: 'critical',
            request: {
              ip: normalizedMetadata.ip || null,
              userAgent: normalizedMetadata.userAgent || ''
            },
            actor: normalizedMetadata.actorId
              ? {
                  id: normalizedMetadata.actorId,
                  username: normalizedMetadata.actorUsername || null,
                  role: normalizedMetadata.actorRole || null
                }
              : null
          }
        );
      }
    } catch (error) {
      logger.warn('Failed to persist security audit log', {
        message: error.message
      });
    }
  }
}

module.exports = new SecurityAuditService();
