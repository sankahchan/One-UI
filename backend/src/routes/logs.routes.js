const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const connectionLogsService = require('../services/connectionLogs.service');
const xrayLogsService = require('../services/xrayLogs.service');
const prisma = require('../config/database');
const { query } = require('express-validator');
const validate = require('../middleware/validator');
const ApiResponse = require('../utils/response');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route GET /api/logs/connections
 * @desc Get connection logs with filtering
 * @access Private
 */
router.get(
    '/xray/tail',
    [
        query('type').optional().isIn(['access', 'error', 'output']),
        query('lines').optional().isInt({ min: 1, max: 2000 }).toInt(),
        query('search').optional().isString().trim(),
        query('level').optional().isIn(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'UNKNOWN']),
        query('protocol').optional().isIn([
            'VLESS',
            'VMESS',
            'TROJAN',
            'SHADOWSOCKS',
            'SOCKS',
            'HTTP',
            'DOKODEMO_DOOR',
            'WIREGUARD',
            'MTPROTO',
            'UNKNOWN'
        ]),
        query('ip').optional().isString().trim(),
        query('user').optional().isString().trim()
    ],
    validate,
    async (req, res, next) => {
        try {
            const payload = await xrayLogsService.tail({
                type: req.query.type,
                lines: req.query.lines,
                search: req.query.search,
                level: req.query.level,
                protocol: req.query.protocol,
                ip: req.query.ip,
                user: req.query.user
            });

            res.json(ApiResponse.success(payload, 'Xray logs retrieved'));
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/xray/stream',
    [
        query('type').optional().isIn(['access', 'error', 'output']),
        query('lines').optional().isInt({ min: 1, max: 2000 }).toInt(),
        query('search').optional().isString().trim(),
        query('level').optional().isIn(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'UNKNOWN']),
        query('protocol').optional().isIn([
            'VLESS',
            'VMESS',
            'TROJAN',
            'SHADOWSOCKS',
            'SOCKS',
            'HTTP',
            'DOKODEMO_DOOR',
            'WIREGUARD',
            'MTPROTO',
            'UNKNOWN'
        ]),
        query('ip').optional().isString().trim(),
        query('user').optional().isString().trim(),
        query('interval').optional().isInt({ min: 500, max: 10000 }).toInt()
    ],
    validate,
    async (req, res, next) => {
        try {
            const streamConfig = {
                type: req.query.type,
                lines: req.query.lines,
                search: req.query.search,
                level: req.query.level,
                protocol: req.query.protocol,
                ip: req.query.ip,
                user: req.query.user
            };
            const intervalMs = xrayLogsService.normalizeInterval(req.query.interval);

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            const writeEvent = (event, data) => {
                res.write(`event: ${event}\n`);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            let running = false;
            const pushSnapshot = async () => {
                if (running) return;
                running = true;
                try {
                    const payload = await xrayLogsService.tail(streamConfig);
                    writeEvent('snapshot', payload);
                } catch (error) {
                    writeEvent('error', { message: error.message || 'Failed to read Xray logs' });
                } finally {
                    running = false;
                }
            };

            await pushSnapshot();

            const intervalId = setInterval(() => {
                void pushSnapshot();
            }, intervalMs);

            const heartbeatId = setInterval(() => {
                res.write(': ping\n\n');
            }, 20_000);

            req.on('close', () => {
                clearInterval(intervalId);
                clearInterval(heartbeatId);
                res.end();
            });
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/system',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
        query('search').optional().isString().trim(),
        query('level').optional().isIn(['INFO', 'WARNING', 'ERROR', 'CRITICAL']),
        query('start').optional().isISO8601().withMessage('start must be ISO 8601 datetime'),
        query('end').optional().isISO8601().withMessage('end must be ISO 8601 datetime')
    ],
    validate,
    async (req, res, next) => {
        try {
            const page = Number.isInteger(req.query.page) ? req.query.page : 1;
            const limit = Number.isInteger(req.query.limit) ? req.query.limit : 50;
            const skip = (page - 1) * limit;
            const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
            const level = typeof req.query.level === 'string' ? req.query.level : '';
            const startRaw = typeof req.query.start === 'string' ? req.query.start : '';
            const endRaw = typeof req.query.end === 'string' ? req.query.end : '';
            const start = startRaw ? new Date(startRaw) : null;
            const end = endRaw ? new Date(endRaw) : null;

            const where = {};
            if (level) {
                where.level = level;
            }
            if (search) {
                where.message = {
                    contains: search,
                    mode: 'insensitive'
                };
            }
            if (start || end) {
                where.timestamp = {};
                if (start) {
                    where.timestamp.gte = start;
                }
                if (end) {
                    where.timestamp.lte = end;
                }
            }

            const [logs, total] = await Promise.all([
                prisma.systemLog.findMany({
                    where,
                    skip,
                    take: limit,
                    orderBy: {
                        timestamp: 'desc'
                    }
                }),
                prisma.systemLog.count({ where })
            ]);

            res.json(
                ApiResponse.success(
                    {
                        logs,
                        pagination: {
                            page,
                            limit,
                            total,
                            totalPages: Math.ceil(total / limit)
                        }
                    },
                    'System logs retrieved'
                )
            );
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/system/stream',
    [
        query('search').optional().isString().trim(),
        query('level').optional().isIn(['INFO', 'WARNING', 'ERROR', 'CRITICAL']),
        query('interval').optional().isInt({ min: 500, max: 10000 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 200 }).toInt()
    ],
    validate,
    async (req, res, next) => {
        try {
            const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
            const level = typeof req.query.level === 'string' ? req.query.level : '';
            const intervalMs = Number.isInteger(req.query.interval)
                ? Math.min(Math.max(req.query.interval, 500), 10000)
                : 2000;
            const limit = Number.isInteger(req.query.limit)
                ? Math.min(Math.max(req.query.limit, 1), 200)
                : 100;

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            const writeEvent = (event, data) => {
                res.write(`event: ${event}\n`);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            const where = {};
            if (level) {
                where.level = level;
            }
            if (search) {
                where.message = {
                    contains: search,
                    mode: 'insensitive'
                };
            }

            let running = false;
            const pushSnapshot = async () => {
                if (running) {
                    return;
                }
                running = true;

                try {
                    const logs = await prisma.systemLog.findMany({
                        where,
                        take: limit,
                        orderBy: {
                            timestamp: 'desc'
                        }
                    });

                    writeEvent('snapshot', {
                        logs,
                        generatedAt: new Date().toISOString()
                    });
                } catch (error) {
                    writeEvent('error', { message: error.message || 'Failed to stream system logs' });
                } finally {
                    running = false;
                }
            };

            await pushSnapshot();

            const intervalId = setInterval(() => {
                void pushSnapshot();
            }, intervalMs);

            const heartbeatId = setInterval(() => {
                res.write(': ping\n\n');
            }, 20_000);

            req.on('close', () => {
                clearInterval(intervalId);
                clearInterval(heartbeatId);
                res.end();
            });
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/connections',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('userId').optional().isInt().toInt(),
        query('inboundId').optional().isInt().toInt(),
        query('clientIp').optional().isString().trim(),
        query('action').optional().isIn(['connect', 'disconnect']),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601()
    ],
    validate,
    async (req, res, next) => {
        try {
            const result = await connectionLogsService.list(req.query);
            res.json(ApiResponse.success(result, 'Connection logs retrieved'));
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route GET /api/logs/connections/stats
 * @desc Get connection statistics
 * @access Private (Admin only)
 */
router.get(
    '/connections/stats',
    authorize('SUPER_ADMIN', 'ADMIN'),
    async (_req, res, next) => {
        try {
            const stats = await connectionLogsService.getStats();
            res.json(ApiResponse.success(stats, 'Connection stats retrieved'));
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route GET /api/logs/connections/user/:userId
 * @desc Get recent connections for a specific user
 * @access Private
 */
router.get(
    '/connections/user/:userId',
    async (req, res, next) => {
        try {
            const userId = parseInt(req.params.userId, 10);
            const logs = await connectionLogsService.getRecentByUser(userId);
            res.json(ApiResponse.success(logs, 'User connection logs retrieved'));
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route DELETE /api/logs/connections/cleanup
 * @desc Cleanup old connection logs
 * @access Private (Super Admin only)
 */
router.delete(
    '/connections/cleanup',
    authorize('SUPER_ADMIN'),
    async (req, res, next) => {
        try {
            const daysToKeep = parseInt(req.query.days, 10) || 30;
            const count = await connectionLogsService.cleanup(daysToKeep);
            res.json(ApiResponse.success({ deleted: count }, `Deleted ${count} old logs`));
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;
