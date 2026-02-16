/**
 * Traffic Reset Scheduler Job
 * Automatically resets user traffic based on their trafficResetPeriod setting
 */

const logger = require('../config/logger');
const prisma = require('../config/database');

class TrafficResetJob {
    constructor() {
        this.isRunning = false;
    }

    /**
     * Check if a user's traffic should be reset based on their reset period
     * @param {Object} user - User object with trafficResetPeriod, trafficResetDay, lastTrafficReset
     * @returns {boolean}
     */
    shouldReset(user) {
        if (user.trafficResetPeriod === 'NEVER') {
            return false;
        }

        const now = new Date();
        const lastReset = user.lastTrafficReset ? new Date(user.lastTrafficReset) : null;

        switch (user.trafficResetPeriod) {
            case 'DAILY': {
                // Reset once per day (after midnight)
                if (!lastReset) return true;
                return now.toDateString() !== lastReset.toDateString();
            }

            case 'WEEKLY': {
                // Reset on specified day of week (1=Monday, 7=Sunday)
                const dayOfWeek = now.getDay() || 7; // Convert Sunday from 0 to 7
                if (dayOfWeek !== user.trafficResetDay) return false;
                if (!lastReset) return true;
                // Check if we've already reset today
                return now.toDateString() !== lastReset.toDateString();
            }

            case 'MONTHLY': {
                // Reset on specified day of month
                const dayOfMonth = now.getDate();
                if (dayOfMonth !== user.trafficResetDay) return false;
                if (!lastReset) return true;
                // Check if we've already reset this month
                return now.toDateString() !== lastReset.toDateString();
            }

            default:
                return false;
        }
    }

    /**
     * Reset traffic for a single user
     * @param {number} userId 
     */
    async resetUserTraffic(userId) {
        await prisma.user.update({
            where: { id: userId },
            data: {
                uploadUsed: 0n,
                downloadUsed: 0n,
                lastTrafficReset: new Date(),
                status: 'ACTIVE' // Re-enable if was LIMITED
            }
        });

        logger.info(`[TrafficReset] Reset traffic for user ${userId}`);
    }

    /**
     * Run the traffic reset check for all users
     */
    async run() {
        if (this.isRunning) {
            logger.info('[TrafficReset] Already running, skipping');
            return;
        }

        this.isRunning = true;

        try {
            // Get all users with a reset period set (not NEVER)
            const users = await prisma.user.findMany({
                where: {
                    trafficResetPeriod: { not: 'NEVER' },
                    status: { in: ['ACTIVE', 'LIMITED'] }
                },
                select: {
                    id: true,
                    email: true,
                    trafficResetPeriod: true,
                    trafficResetDay: true,
                    lastTrafficReset: true
                }
            });

            let resetCount = 0;

            for (const user of users) {
                if (this.shouldReset(user)) {
                    await this.resetUserTraffic(user.id);
                    resetCount++;
                }
            }

            if (resetCount > 0) {
                logger.info(`[TrafficReset] Reset traffic for ${resetCount} users`);
            }
        } catch (error) {
            logger.error('[TrafficReset] Error:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Start the scheduler (runs every hour)
     */
    start() {
        // Run immediately on start
        this.run();

        // Then run every hour
        this.interval = setInterval(() => {
            this.run();
        }, 60 * 60 * 1000);

        logger.info('[TrafficReset] Scheduler started');
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        logger.info('[TrafficReset] Scheduler stopped');
    }
}

module.exports = new TrafficResetJob();
