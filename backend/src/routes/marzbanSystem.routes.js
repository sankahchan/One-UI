const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const marzbanService = require('../services/marzban.service');
const marzbanErrorHandler = require('../middleware/marzbanErrorHandler');
const systemController = require('../controllers/system.controller');

const router = Router();

// Pass-through standard unauthenticated Xray routes 
router.get('/health', systemController.health);
router.get('/metrics', systemController.metrics);
router.post('/alerts/webhook', systemController.alertWebhook);

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

// GET /api/system/stats
router.get('/stats', async (req, res, next) => {
    try {
        const data = await marzbanService.marzbanFetch('/api/system', {
            method: 'GET'
        });

        // Marzban /api/system response generally matches this schema natively:
        // { mem_total, mem_used, cpu_cores, cpu_usage, total_user, users_active... }
        // We map it cleanly if the frontend strictly expects camelCase as described
        return res.status(200).json({
            success: true,
            stats: {
                memTotal: data.mem_total || 0,
                memUsed: data.mem_used || 0,
                cpuUsage: data.cpu_usage || 0,
                totalUsers: data.total_user || 0,
                activeUsers: data.users_active || 0,
                disabledUsers: data.users_disabled || 0,
                limitedUsers: data.users_limited || 0,
                expiredUsers: data.users_expired || 0,
                inboundBandwidth: data.incoming_bandwidth || 0,
                outboundBandwidth: data.outgoing_bandwidth || 0
            }
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/system/inbounds
router.get('/inbounds', async (req, res, next) => {
    try {
        const data = await marzbanService.marzbanFetch('/api/inbounds', {
            method: 'GET'
        });

        // Marzban returns an object grouped by protocol: { vless: [...], vmess: [...], trojan: [...] }
        return res.status(200).json({
            success: true,
            inbounds: data
        });
    } catch (error) {
        next(error);
    }
});

router.use(marzbanErrorHandler);

module.exports = router;
