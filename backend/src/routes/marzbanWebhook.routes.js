const { Router } = require('express');
const env = require('../config/env');
const logger = require('../config/logger');
const socketLayer = require('../utils/socket'); // Single instance wrapper

const router = Router();

// POST /api/webhook/marzban
router.post('/', async (req, res, next) => {
    try {
        const signature = req.headers['x-webhook-secret'] || req.headers['X-Webhook-Secret'];

        // Validate secret token from Marzban webhook settings against .env
        if (!signature || signature !== env.MARZBAN_WEBHOOK_SECRET) {
            logger.warn('Marzban webhook rejected: Invalid x-webhook-secret signature');
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { username, action, user } = req.body;

        // Explicitly define which tracking actions we push to connected UIs
        const validActions = [
            'user_created', 'user_updated', 'user_deleted',
            'user_limited', 'user_expired', 'user_disabled', 'user_enabled'
        ];

        if (validActions.includes(action)) {
            try {
                const io = socketLayer.getIo();
                io.emit('marzban_event', {
                    username: username || (user ? user.username : 'unknown'),
                    action,
                    timestamp: Date.now()
                });
                logger.info(`Propagated Marzban websocket event [${action}] for user: ${username}`);
            } catch (wsError) {
                logger.error('Failed to emit marzban socket event', { message: wsError.message });
                // Fail-safe: we don't throw 500 when WS fails; the webhook should still close out.
            }
        } else {
            logger.debug(`Marzban webhook ignored unmapped action: [${action}]`);
        }

        return res.status(200).json({ success: true, message: 'Webhook received' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
