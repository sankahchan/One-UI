/**
 * IP Tracking Service
 * Tracks active IP connections per user to enforce IP limits
 */

class IpTrackingService {
    constructor() {
        // Map<userId, Set<clientIp>>
        this.activeConnections = new Map();
        // Map<`${userId}:${ip}`, timestamp> for connection cleanup
        this.connectionTimestamps = new Map();
        // Cleanup stale connections every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    /**
     * Check if user can connect from given IP
     * @param {number} userId 
     * @param {string} clientIp 
     * @param {number} ipLimit - 0 means unlimited
     * @returns {{ allowed: boolean, currentCount: number, limit: number }}
     */
    checkLimit(userId, clientIp, ipLimit) {
        // 0 means unlimited
        if (ipLimit === 0) {
            return { allowed: true, currentCount: 0, limit: 0 };
        }

        const userIps = this.activeConnections.get(userId) || new Set();

        // If this IP is already connected, allow it
        if (userIps.has(clientIp)) {
            return { allowed: true, currentCount: userIps.size, limit: ipLimit };
        }

        // Check if adding new IP would exceed limit
        if (userIps.size >= ipLimit) {
            return {
                allowed: false,
                currentCount: userIps.size,
                limit: ipLimit,
                message: `IP limit exceeded. Max ${ipLimit} devices allowed.`
            };
        }

        return { allowed: true, currentCount: userIps.size, limit: ipLimit };
    }

    /**
     * Track a new connection
     * @param {number} userId 
     * @param {string} clientIp 
     */
    trackConnection(userId, clientIp) {
        if (!this.activeConnections.has(userId)) {
            this.activeConnections.set(userId, new Set());
        }

        this.activeConnections.get(userId).add(clientIp);
        this.connectionTimestamps.set(`${userId}:${clientIp}`, Date.now());
    }

    /**
     * Remove a connection (user disconnected)
     * @param {number} userId 
     * @param {string} clientIp 
     */
    releaseConnection(userId, clientIp) {
        const userIps = this.activeConnections.get(userId);
        if (userIps) {
            userIps.delete(clientIp);
            if (userIps.size === 0) {
                this.activeConnections.delete(userId);
            }
        }
        this.connectionTimestamps.delete(`${userId}:${clientIp}`);
    }

    /**
     * Get current connection count for a user
     * @param {number} userId 
     * @returns {number}
     */
    getConnectionCount(userId) {
        const userIps = this.activeConnections.get(userId);
        return userIps ? userIps.size : 0;
    }

    /**
     * Get all active IPs for a user
     * @param {number} userId 
     * @returns {string[]}
     */
    getActiveIps(userId) {
        const userIps = this.activeConnections.get(userId);
        return userIps ? Array.from(userIps) : [];
    }

    /**
     * Clear all connections for a user (e.g., when user is disabled)
     * @param {number} userId 
     */
    clearUserConnections(userId) {
        const userIps = this.activeConnections.get(userId);
        if (userIps) {
            for (const ip of userIps) {
                this.connectionTimestamps.delete(`${userId}:${ip}`);
            }
        }
        this.activeConnections.delete(userId);
    }

    /**
     * Get all active connections (for monitoring)
     * @returns {{ userId: number, ips: string[] }[]}
     */
    getAllConnections() {
        const connections = [];
        for (const [userId, ips] of this.activeConnections.entries()) {
            connections.push({
                userId,
                ips: Array.from(ips),
                count: ips.size
            });
        }
        return connections;
    }

    /**
     * Cleanup stale connections (older than 30 minutes without activity)
     * This handles cases where disconnect events weren't received
     */
    cleanup() {
        const staleThreshold = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        for (const [key, timestamp] of this.connectionTimestamps.entries()) {
            if (now - timestamp > staleThreshold) {
                const [userId, ip] = key.split(':');
                this.releaseConnection(Number(userId), ip);
            }
        }
    }

    /**
     * Refresh connection timestamp (called on activity)
     * @param {number} userId 
     * @param {string} clientIp 
     */
    refreshConnection(userId, clientIp) {
        const key = `${userId}:${clientIp}`;
        if (this.connectionTimestamps.has(key)) {
            this.connectionTimestamps.set(key, Date.now());
        }
    }

    /**
     * Stop the cleanup interval (for graceful shutdown)
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

// Export singleton instance
module.exports = new IpTrackingService();
