/**
 * Connection Logs Service
 * Handles logging and querying of connection events
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ConnectionLogsService {
    computeProtocolQualityScore({ connectSuccesses = 0, limitRejects = 0, reconnects = 0 }) {
        const safeConnects = Number(connectSuccesses) || 0;
        const safeRejects = Number(limitRejects) || 0;
        const safeReconnects = Number(reconnects) || 0;
        const attempts = safeConnects + safeRejects;
        const rejectRate = attempts > 0 ? safeRejects / attempts : 0;
        const reconnectPenalty = safeConnects > 0 ? safeReconnects / safeConnects : safeReconnects;

        // Higher is better. Rejects and rapid reconnects carry heavier penalties.
        const rawScore = (safeConnects * 10)
            - (safeRejects * 16)
            - (safeReconnects * 6)
            - (rejectRate * 25)
            - (reconnectPenalty * 10);

        return Number(rawScore.toFixed(2));
    }

    /**
     * Log a connection event
     * @param {Object} data - Connection data
     * @param {number} data.userId - User ID
     * @param {number} data.inboundId - Inbound ID
     * @param {string} data.clientIp - Client IP address
     * @param {string} [data.deviceFingerprint] - Deterministic device fingerprint
     * @param {string} [data.userAgent] - Device user agent
     * @param {string} data.action - 'connect' | 'disconnect' | reject_*
     * @returns {Promise<Object>}
     */
    async log(data) {
        const {
            userId,
            inboundId,
            clientIp,
            action,
            deviceFingerprint,
            userAgent
        } = data;

        return prisma.connectionLog.create({
            data: {
                userId,
                inboundId,
                clientIp,
                action,
                deviceFingerprint: deviceFingerprint || null,
                userAgent: userAgent ? String(userAgent).slice(0, 1024) : null
            }
        });
    }

    /**
     * Get connection logs with filtering
     * @param {Object} options - Query options
     * @returns {Promise<{ logs: Array, total: number }>}
     */
    async list(options = {}) {
        const {
            page = 1,
            limit = 50,
            userId,
            inboundId,
            clientIp,
            action,
            startDate,
            endDate
        } = options;

        const where = {};

        if (userId) where.userId = userId;
        if (inboundId) where.inboundId = inboundId;
        if (clientIp) where.clientIp = { contains: clientIp };
        if (action) where.action = action;

        if (startDate || endDate) {
            where.timestamp = {};
            if (startDate) where.timestamp.gte = new Date(startDate);
            if (endDate) where.timestamp.lte = new Date(endDate);
        }

        const [logs, total] = await Promise.all([
            prisma.connectionLog.findMany({
                where,
                include: {
                    user: {
                        select: { id: true, email: true }
                    },
                    inbound: {
                        select: { id: true, tag: true, port: true, protocol: true }
                    }
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { timestamp: 'desc' }
            }),
            prisma.connectionLog.count({ where })
        ]);

        return { logs, total, page, limit, pages: Math.ceil(total / limit) };
    }

    /**
     * Get recent connections for a user
     * @param {number} userId 
     * @param {number} limit 
     * @returns {Promise<Array>}
     */
    async getRecentByUser(userId, limit = 20) {
        return prisma.connectionLog.findMany({
            where: { userId },
            include: {
                inbound: {
                    select: { tag: true, port: true, protocol: true }
                }
            },
            take: limit,
            orderBy: { timestamp: 'desc' }
        });
    }

    /**
     * Get unique IP addresses for a user
     * @param {number} userId 
     * @returns {Promise<string[]>}
     */
    async getUniqueIpsByUser(userId) {
        const logs = await prisma.connectionLog.findMany({
            where: { userId },
            select: { clientIp: true },
            distinct: ['clientIp']
        });

        return logs.map(log => log.clientIp);
    }

    /**
     * Get recent connection state (distinct IPs/fingerprints within a time window)
     * @param {number} userId
     * @param {Date} since
     * @returns {Promise<{ ips: string[], fingerprints: string[] }>}
     */
    async getRecentConnectionState(userId, since) {
        const logs = await prisma.connectionLog.findMany({
            where: {
                userId,
                action: 'connect',
                timestamp: {
                    gte: since
                }
            },
            select: {
                clientIp: true,
                deviceFingerprint: true
            }
        });

        const ips = [];
        const fingerprints = [];
        const ipSet = new Set();
        const fpSet = new Set();

        for (const log of logs) {
            if (log.clientIp && !ipSet.has(log.clientIp)) {
                ipSet.add(log.clientIp);
                ips.push(log.clientIp);
            }

            if (log.deviceFingerprint && !fpSet.has(log.deviceFingerprint)) {
                fpSet.add(log.deviceFingerprint);
                fingerprints.push(log.deviceFingerprint);
            }
        }

        return {
            ips,
            fingerprints
        };
    }

    /**
     * Build quality counters by user over a rolling time window.
     * @param {number[]} userIds
     * @param {number} windowMinutes
     * @returns {Promise<Map<number, {
     *   connectSuccesses: number,
     *   limitRejects: number,
     *   reconnects: number,
     *   reconnectFrequencyPerHour: number,
     *   avgTrafficPerMinute: number,
     *   byProtocol: Array<{
     *     protocol: string,
     *     connectSuccesses: number,
     *     limitRejects: number,
     *     reconnects: number
     *   }>,
     *   byProfile: Array<{
     *     inboundId: number | null,
     *     tag: string,
     *     protocol: string,
     *     port: number,
     *     connectSuccesses: number,
     *     limitRejects: number,
     *     reconnects: number
     *   }>
     * }>>}
     */
    async getQualityByUsers(userIds = [], windowMinutes = 60) {
        const normalizedUserIds = Array.isArray(userIds)
            ? userIds
                .map((value) => Number.parseInt(String(value), 10))
                .filter((value) => Number.isInteger(value) && value > 0)
            : [];

        if (normalizedUserIds.length === 0) {
            return new Map();
        }

        const safeWindowMinutes = Number.isInteger(Number(windowMinutes))
            ? Math.min(Math.max(Number(windowMinutes), 5), 24 * 60)
            : 60;

        const since = new Date(Date.now() - safeWindowMinutes * 60 * 1000);

        const [logs, trafficSums] = await Promise.all([
            prisma.connectionLog.findMany({
                where: {
                    userId: { in: normalizedUserIds },
                    timestamp: { gte: since }
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
                    timestamp: 'asc'
                }
            }),
            prisma.trafficLog.groupBy({
                by: ['userId'],
                where: {
                    userId: { in: normalizedUserIds },
                    timestamp: { gte: since }
                },
                _sum: {
                    upload: true,
                    download: true
                }
            })
        ]);

        const trafficByUserId = new Map(
            trafficSums.map((entry) => [
                entry.userId,
                Number(entry._sum.upload || 0n) + Number(entry._sum.download || 0n)
            ])
        );

        const qualityByUser = new Map();

        const ensureQuality = (userId) => {
            let quality = qualityByUser.get(userId);
            if (!quality) {
                quality = {
                    connectSuccesses: 0,
                    limitRejects: 0,
                    reconnects: 0,
                    reconnectFrequencyPerHour: 0,
                    avgTrafficPerMinute: 0,
                    byProtocol: [],
                    byProfile: [],
                    _protocolMap: new Map(),
                    _profileMap: new Map(),
                    _connectsByFingerprint: new Map()
                };
                qualityByUser.set(userId, quality);
            }
            return quality;
        };

        for (const log of logs) {
            const quality = ensureQuality(log.userId);
            const protocol = String(log.inbound?.protocol || 'UNKNOWN');
            const inboundId = Number.isInteger(Number(log.inbound?.id)) ? Number(log.inbound.id) : null;
            const profileTag = String(log.inbound?.tag || (inboundId ? `inbound-${inboundId}` : 'unknown'));
            const profileKey = inboundId ? `id:${inboundId}` : `tag:${profileTag}`;
            const protocolEntry = quality._protocolMap.get(protocol) || {
                protocol,
                connectSuccesses: 0,
                limitRejects: 0,
                reconnects: 0,
                _connectsByFingerprint: new Map()
            };
            const profileEntry = quality._profileMap.get(profileKey) || {
                profileKey,
                inboundId,
                tag: profileTag,
                protocol,
                port: Number(log.inbound?.port || 0),
                connectSuccesses: 0,
                limitRejects: 0,
                reconnects: 0,
                _connectsByFingerprint: new Map()
            };

            if (log.action === 'connect') {
                quality.connectSuccesses += 1;
                protocolEntry.connectSuccesses += 1;
                profileEntry.connectSuccesses += 1;

                const fingerprint = String(log.deviceFingerprint || `ip:${log.clientIp || 'unknown'}`);
                quality._connectsByFingerprint.set(
                    fingerprint,
                    (quality._connectsByFingerprint.get(fingerprint) || 0) + 1
                );
                protocolEntry._connectsByFingerprint.set(
                    fingerprint,
                    (protocolEntry._connectsByFingerprint.get(fingerprint) || 0) + 1
                );
                profileEntry._connectsByFingerprint.set(
                    fingerprint,
                    (profileEntry._connectsByFingerprint.get(fingerprint) || 0) + 1
                );
            } else if (String(log.action || '').startsWith('reject_')) {
                quality.limitRejects += 1;
                protocolEntry.limitRejects += 1;
                profileEntry.limitRejects += 1;
            }

            quality._protocolMap.set(protocol, protocolEntry);
            quality._profileMap.set(profileKey, profileEntry);
        }

        const windowHours = safeWindowMinutes / 60;
        for (const [userId, quality] of qualityByUser.entries()) {
            let reconnects = 0;
            for (const count of quality._connectsByFingerprint.values()) {
                reconnects += Math.max(0, count - 1);
            }
            quality.reconnects = reconnects;
            quality.reconnectFrequencyPerHour = windowHours > 0
                ? Number((reconnects / windowHours).toFixed(2))
                : reconnects;
            quality.avgTrafficPerMinute = Number(
                ((trafficByUserId.get(userId) || 0) / safeWindowMinutes).toFixed(2)
            );

            const totalProtocolConnectSuccesses = Array.from(quality._protocolMap.values()).reduce(
                (total, entry) => total + Number(entry.connectSuccesses || 0),
                0
            );
            const totalProfileConnectSuccesses = Array.from(quality._profileMap.values()).reduce(
                (total, entry) => total + Number(entry.connectSuccesses || 0),
                0
            );

            quality.byProtocol = Array.from(quality._protocolMap.values())
                .map((entry) => {
                    let protocolReconnects = 0;
                    for (const count of entry._connectsByFingerprint.values()) {
                        protocolReconnects += Math.max(0, count - 1);
                    }

                    const safeConnects = Number(entry.connectSuccesses || 0);
                    const safeRejects = Number(entry.limitRejects || 0);
                    const attempts = safeConnects + safeRejects;
                    const rejectRate = attempts > 0 ? Number((safeRejects / attempts).toFixed(4)) : 0;
                    const reconnectFrequencyPerHour = windowHours > 0
                        ? Number((protocolReconnects / windowHours).toFixed(2))
                        : protocolReconnects;
                    const trafficShare = totalProtocolConnectSuccesses > 0
                        ? safeConnects / totalProtocolConnectSuccesses
                        : 0;
                    const avgTrafficPerMinute = Number((quality.avgTrafficPerMinute * trafficShare).toFixed(2));
                    const score = this.computeProtocolQualityScore({
                        connectSuccesses: safeConnects,
                        limitRejects: safeRejects,
                        reconnects: protocolReconnects
                    });

                    return {
                        protocol: entry.protocol,
                        connectSuccesses: safeConnects,
                        limitRejects: safeRejects,
                        reconnects: protocolReconnects,
                        reconnectFrequencyPerHour,
                        avgTrafficPerMinute,
                        rejectRate,
                        score
                    };
                })
                .sort((a, b) => {
                    if (a.score !== b.score) {
                        return b.score - a.score;
                    }
                    if (a.connectSuccesses !== b.connectSuccesses) {
                        return b.connectSuccesses - a.connectSuccesses;
                    }
                    return a.protocol.localeCompare(b.protocol);
                });

            quality.byProfile = Array.from(quality._profileMap.values())
                .map((entry) => {
                    let profileReconnects = 0;
                    for (const count of entry._connectsByFingerprint.values()) {
                        profileReconnects += Math.max(0, count - 1);
                    }

                    const safeConnects = Number(entry.connectSuccesses || 0);
                    const safeRejects = Number(entry.limitRejects || 0);
                    const attempts = safeConnects + safeRejects;
                    const rejectRate = attempts > 0 ? Number((safeRejects / attempts).toFixed(4)) : 0;
                    const reconnectFrequencyPerHour = windowHours > 0
                        ? Number((profileReconnects / windowHours).toFixed(2))
                        : profileReconnects;
                    const trafficShare = totalProfileConnectSuccesses > 0
                        ? safeConnects / totalProfileConnectSuccesses
                        : 0;
                    const avgTrafficPerMinute = Number((quality.avgTrafficPerMinute * trafficShare).toFixed(2));
                    const score = this.computeProtocolQualityScore({
                        connectSuccesses: safeConnects,
                        limitRejects: safeRejects,
                        reconnects: profileReconnects
                    });

                    return {
                        inboundId: entry.inboundId,
                        tag: entry.tag,
                        protocol: entry.protocol,
                        port: Number(entry.port || 0),
                        connectSuccesses: safeConnects,
                        limitRejects: safeRejects,
                        reconnects: profileReconnects,
                        reconnectFrequencyPerHour,
                        avgTrafficPerMinute,
                        rejectRate,
                        score
                    };
                })
                .sort((a, b) => {
                    if (a.score !== b.score) {
                        return b.score - a.score;
                    }
                    if (a.connectSuccesses !== b.connectSuccesses) {
                        return b.connectSuccesses - a.connectSuccesses;
                    }
                    return a.tag.localeCompare(b.tag);
                });

            quality.score = this.computeProtocolQualityScore({
                connectSuccesses: quality.connectSuccesses,
                limitRejects: quality.limitRejects,
                reconnects: quality.reconnects
            });

            delete quality._protocolMap;
            delete quality._profileMap;
            delete quality._connectsByFingerprint;
        }

        for (const userId of normalizedUserIds) {
            if (!qualityByUser.has(userId)) {
                qualityByUser.set(userId, {
                    connectSuccesses: 0,
                    limitRejects: 0,
                    reconnects: 0,
                    reconnectFrequencyPerHour: 0,
                    avgTrafficPerMinute: Number(((trafficByUserId.get(userId) || 0) / safeWindowMinutes).toFixed(2)),
                    byProtocol: [],
                    byProfile: [],
                    score: 0
                });
            }
        }

        return qualityByUser;
    }

    /**
     * Get connection stats
     * @returns {Promise<Object>}
     */
    async getStats() {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [total, today, thisWeek] = await Promise.all([
            prisma.connectionLog.count(),
            prisma.connectionLog.count({
                where: { timestamp: { gte: last24h } }
            }),
            prisma.connectionLog.count({
                where: { timestamp: { gte: last7d } }
            })
        ]);

        return { total, today, thisWeek };
    }

    /**
     * Cleanup old logs
     * @param {number} daysToKeep - Days to keep logs
     * @returns {Promise<number>} - Number of deleted logs
     */
    async cleanup(daysToKeep = 30) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysToKeep);

        const result = await prisma.connectionLog.deleteMany({
            where: { timestamp: { lt: cutoff } }
        });

        return result.count;
    }
}

module.exports = new ConnectionLogsService();
