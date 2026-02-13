const { Router } = require('express');
const systemController = require('../controllers/system.controller');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.get('/health', systemController.health);
router.get('/metrics', systemController.metrics);
router.post('/alerts/webhook', systemController.alertWebhook);
router.get('/stats', authenticate, systemController.stats);
router.get('/analytics/snapshots', authenticate, systemController.analyticsSnapshots);

module.exports = router;
