const express = require('express');
const net = require('node:net');
const tls = require('node:tls');
const { body, param } = require('express-validator');

const { authenticate, authorize, requireBearerAuth } = require('../middleware/auth');
const validate = require('../middleware/validator');
const { realityLimiter } = require('../middleware/rateLimit');
const inboundService = require('../services/inbound.service');
const webhookService = require('../services/webhook.service');
const myanmarOptimized = require('../config/myanmar-optimized');
const ApiResponse = require('../utils/response');

const router = express.Router();

function buildActor(req) {
  if (!req?.admin) {
    return null;
  }

  return {
    id: req.admin.id,
    username: req.admin.username,
    role: req.admin.role
  };
}

function buildRequest(req) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || ''
  };
}

function emitAudit(req, event, payload = {}) {
  webhookService.emitEvent(event, payload, {
    actor: buildActor(req),
    request: buildRequest(req)
  });
}

function isValidHostname(hostname = '') {
  const value = String(hostname || '').trim();
  if (!value || value.length > 253) {
    return false;
  }

  if (net.isIP(value)) {
    return true;
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(value)) {
    return false;
  }

  if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) {
    return false;
  }

  return value.split('.').every((label) => /^[a-zA-Z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

function parseDestination(dest = '') {
  const raw = String(dest || '').trim();
  const separator = raw.lastIndexOf(':');
  if (separator <= 0 || separator === raw.length - 1) {
    throw new Error('dest must be in host:port format');
  }

  const host = raw.slice(0, separator).trim();
  const portText = raw.slice(separator + 1).trim();
  const port = Number.parseInt(portText, 10);

  if (!isValidHostname(host)) {
    throw new Error('Invalid destination host');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid destination port');
  }

  return { host, port, destination: `${host}:${port}` };
}

function testTlsDestination({ host, port, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    let settled = false;

    const socket = tls.connect({
      host,
      port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      timeout: timeoutMs
    });

    const finalize = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch (_error) {
        // ignore socket cleanup errors
      }
      resolve(payload);
    };

    socket.once('secureConnect', () => {
      const cipher = socket.getCipher();
      finalize({
        accessible: true,
        tlsProtocol: socket.getProtocol() || null,
        cipher: cipher?.name || null
      });
    });

    socket.once('timeout', () => {
      finalize({
        accessible: false,
        error: 'Connection timed out'
      });
    });

    socket.once('error', (error) => {
      finalize({
        accessible: false,
        error: error.message || 'Connection failed'
      });
    });
  });
}

router.use(requireBearerAuth, authenticate, authorize('SUPER_ADMIN', 'ADMIN'), realityLimiter);

router.post(
  '/generate-keys',
  [
    body('count').optional().isInt({ min: 1, max: 10 }).withMessage('count must be between 1 and 10').toInt(),
    body('serverName').optional().isString().trim().isLength({ min: 1, max: 255 }).withMessage('serverName is invalid')
  ],
  validate,
  async (req, res, next) => {
    try {
      const bundle = await inboundService.generateRealityKeyBundle({
        count: req.body?.count,
        serverName: req.body?.serverName
      });

      emitAudit(req, 'reality.keys.generated', {
        shortIdCount: Array.isArray(bundle.shortIds) ? bundle.shortIds.length : 0,
        serverName: bundle.serverName || req.body?.serverName || null
      });

      return res.json(ApiResponse.success({
        privateKey: bundle.privateKey,
        publicKey: bundle.publicKey,
        shortIds: bundle.shortIds,
        shortId: bundle.shortId,
        fingerprint: bundle.fingerprint,
        serverName: bundle.serverName,
        note: 'Keep private key secret. Share public key with clients only.'
      }));
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/inbounds/:id/rotate-keys',
  [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer').toInt(),
    body('shortIdCount').optional().isInt({ min: 1, max: 10 }).withMessage('shortIdCount must be between 1 and 10').toInt()
  ],
  validate,
  async (req, res, next) => {
    try {
      const inbound = await inboundService.rotateRealityInboundKeys(req.params.id, {
        shortIdCount: req.body?.shortIdCount
      });

      emitAudit(req, 'reality.keys.rotated', {
        inboundId: inbound.id,
        inboundTag: inbound.tag
      });

      return res.json(
        ApiResponse.success(
          {
            id: inbound.id,
            tag: inbound.tag,
            security: inbound.security,
            protocol: inbound.protocol,
            realityPublicKey: inbound.realityPublicKey,
            realityShortIds: inbound.realityShortIds
          },
          'Reality keys rotated successfully'
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.get('/destinations', (_req, res) => {
  return res.json(ApiResponse.success({
    destinations: myanmarOptimized.realityDestinations,
    recommendedWsPaths: myanmarOptimized.recommendedWsPaths,
    avoidPaths: myanmarOptimized.avoidPaths,
    recommendedPorts: myanmarOptimized.recommendedPorts,
    avoidPorts: myanmarOptimized.avoidPorts
  }));
});

router.post(
  '/test-destination',
  [body('dest').isString().trim().notEmpty().withMessage('dest is required')],
  validate,
  async (req, res, next) => {
    try {
      const parsed = parseDestination(req.body?.dest);
      const result = await testTlsDestination(parsed);

      emitAudit(req, 'reality.destination.tested', {
        destination: parsed.destination,
        accessible: result.accessible
      });

      return res.json(ApiResponse.success({
        destination: parsed.destination,
        host: parsed.host,
        port: parsed.port,
        accessible: result.accessible,
        tlsProtocol: result.tlsProtocol || null,
        cipher: result.cipher || null,
        message: result.accessible ? 'Destination is reachable from this server' : (result.error || 'Destination is not reachable')
      }));
    } catch (error) {
      if (error?.message?.includes('dest must be') || error?.message?.includes('Invalid destination')) {
        return res.status(400).json(ApiResponse.error(error.message, 'VALIDATION_ERROR'));
      }
      return next(error);
    }
  }
);

module.exports = router;
