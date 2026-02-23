const { Router } = require('express');
const { body, param, query } = require('express-validator');
const userController = require('../controllers/user.controller');
const validator = require('../middleware/validator');
const { authenticate, authorize } = require('../middleware/auth');
const {
  idParamValidator,
  paginationValidators,
  userValidators,
  bulkValidators,
  keyLifecycleValidators
} = require('../utils/validators');

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

// Static routes MUST come before parameterized routes
router.get('/stats', userController.getUserStats);
router.get('/telemetry/sync-status', userController.getTelemetrySyncStatus);
router.post('/telemetry/fallback-autotune/run', userController.runFallbackAutotune);
router.get(
  '/sessions/stream',
  [
    query('userIds')
      .optional()
      .isString()
      .withMessage('userIds must be a comma-separated string of user IDs'),
    query('includeOffline')
      .optional()
      .isBoolean()
      .withMessage('includeOffline must be boolean')
      .toBoolean(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 500 })
      .withMessage('limit must be between 1 and 500')
      .toInt(),
    query('interval')
      .optional()
      .isInt({ min: 500, max: 10000 })
      .withMessage('interval must be between 500 and 10000 ms')
      .toInt()
  ],
  validator,
  userController.streamSessionSnapshots
);
router.get(
  '/sessions',
  [
    query('userIds')
      .optional()
      .isString()
      .withMessage('userIds must be a comma-separated string of user IDs'),
    query('includeOffline')
      .optional()
      .isBoolean()
      .withMessage('includeOffline must be boolean')
      .toBoolean(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 500 })
      .withMessage('limit must be between 1 and 500')
      .toInt()
  ],
  validator,
  userController.getSessionSnapshots
);
router.get(
  '/',
  [
    ...paginationValidators,
    query('status')
      .optional()
      .isString()
      .trim()
      .isIn(['ACTIVE', 'EXPIRED', 'DISABLED', 'LIMITED'])
      .withMessage('status must be one of ACTIVE, EXPIRED, DISABLED, LIMITED'),
    query('search')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 200 })
      .withMessage('search must be at most 200 characters')
  ],
  validator,
  userController.listUsers
);

// Bulk operations
router.post('/bulk/create', bulkValidators.createUsers, validator, userController.bulkCreate);
router.post('/bulk/delete', authorize('SUPER_ADMIN'), bulkValidators.userIds, validator, userController.bulkDelete);
router.post('/bulk/reset-traffic', bulkValidators.userIds, validator, userController.bulkResetTraffic);
router.post('/bulk/extend-expiry', bulkValidators.extendExpiry, validator, userController.bulkExtendExpiry);
router.post('/bulk/update-status', bulkValidators.updateStatus, validator, userController.bulkUpdateStatus);
router.post('/bulk/assign-inbounds', bulkValidators.assignInbounds, validator, userController.bulkAssignInbounds);
router.post(
  '/bulk/inbounds/reorder-pattern',
  [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .isInt({ min: 1 })
      .withMessage('userIds must contain valid IDs')
      .toInt(),
    body('pattern')
      .optional()
      .isIn(['myanmar'])
      .withMessage('pattern must be "myanmar"'),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean()
  ],
  validator,
  userController.bulkReorderUserInboundsByPattern
);
router.post(
  '/bulk/inbounds/reorder-quality',
  [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .isInt({ min: 1 })
      .withMessage('userIds must contain valid IDs')
      .toInt(),
    body('windowMinutes')
      .optional()
      .isInt({ min: 5, max: 1440 })
      .withMessage('windowMinutes must be between 5 and 1440')
      .toInt(),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean()
  ],
  validator,
  userController.bulkReorderUserInboundsByQuality
);
router.post('/bulk/keys/rotate', keyLifecycleValidators.bulkRotate, validator, userController.bulkRotateUserKeys);
router.post('/bulk/keys/revoke', authorize('SUPER_ADMIN'), keyLifecycleValidators.bulkRevoke, validator, userController.bulkRevokeUserKeys);

// Parameterized routes
router.get(
  '/:id/devices',
  [
    ...idParamValidator,
    query('windowMinutes')
      .optional()
      .isInt({ min: 5, max: 1440 })
      .withMessage('windowMinutes must be between 5 and 1440')
      .toInt()
  ],
  validator,
  userController.getUserDevices
);
router.post(
  '/:id/diagnostics',
  [
    ...idParamValidator,
    body('windowMinutes')
      .optional()
      .isInt({ min: 5, max: 1440 })
      .withMessage('windowMinutes must be between 5 and 1440')
      .toInt(),
    body('portProbeTimeoutMs')
      .optional()
      .isInt({ min: 300, max: 5000 })
      .withMessage('portProbeTimeoutMs must be between 300 and 5000')
      .toInt()
  ],
  validator,
  userController.runUserDiagnostics
);
router.delete(
  '/:id/devices/:fingerprint',
  [
    ...idParamValidator,
    param('fingerprint')
      .isString()
      .matches(/^[a-z0-9:._-]{8,128}$/i)
      .withMessage('fingerprint must be 8-128 characters and contain only letters, numbers, :, ., _, or -')
  ],
  validator,
  userController.revokeUserDevice
);
router.post('/:id/sessions/disconnect', idParamValidator, validator, userController.disconnectUserSessions);
router.get('/:id/session', idParamValidator, validator, userController.getUserSessionSnapshot);
router.get('/:id/effective-inbounds', idParamValidator, validator, userController.getEffectiveInbounds);
router.get('/:id/effective-policy', idParamValidator, validator, userController.getEffectivePolicy);
router.post('/:id/keys/rotate', [...idParamValidator, ...keyLifecycleValidators.rotate], validator, userController.rotateUserKeys);
router.post(
  '/:id/keys/revoke',
  authorize('SUPER_ADMIN'),
  [...idParamValidator, ...keyLifecycleValidators.revoke],
  validator,
  userController.revokeUserKeys
);
router.post('/:id/subscription/regenerate', idParamValidator, validator, userController.regenerateSubscriptionToken);
router.get('/:id/subscription', idParamValidator, validator, userController.getSubscriptionInfo);
router.get(
  '/:id/traffic',
  [
    ...idParamValidator,
    query('days').optional().isInt({ min: 1, max: 365 }).withMessage('days must be between 1 and 365').toInt()
  ],
  validator,
  userController.getUserTraffic
);
router.get(
  '/:id/activity',
  [
    ...idParamValidator,
    query('hours').optional().isInt({ min: 1, max: 720 }).withMessage('hours must be between 1 and 720').toInt(),
    query('eventLimit')
      .optional()
      .isInt({ min: 50, max: 1000 })
      .withMessage('eventLimit must be between 50 and 1000')
      .toInt(),
    query('ipChurnThreshold')
      .optional()
      .isInt({ min: 2, max: 50 })
      .withMessage('ipChurnThreshold must be between 2 and 50')
      .toInt(),
    query('reconnectThreshold')
      .optional()
      .isInt({ min: 3, max: 200 })
      .withMessage('reconnectThreshold must be between 3 and 200')
      .toInt(),
    query('reconnectWindowMinutes')
      .optional()
      .isInt({ min: 1, max: 120 })
      .withMessage('reconnectWindowMinutes must be between 1 and 120')
      .toInt(),
    query('trafficSpikeFactor')
      .optional()
      .isFloat({ min: 1.1, max: 20 })
      .withMessage('trafficSpikeFactor must be between 1.1 and 20')
      .toFloat(),
    query('trafficSpikeMinBytes')
      .optional()
      .matches(/^\d+$/)
      .withMessage('trafficSpikeMinBytes must be a non-negative integer')
  ],
  validator,
  userController.getUserActivity
);
router.post('/:id/reset-traffic', idParamValidator, validator, userController.resetTraffic);
router.post(
  '/:id/inbounds/:inboundId/toggle',
  [
    ...idParamValidator,
    param('inboundId').isInt({ min: 1 }).withMessage('inboundId must be a positive integer').toInt(),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean()
  ],
  validator,
  userController.toggleUserInbound
);
router.patch(
  '/:id/inbounds/:inboundId/priority',
  [
    ...idParamValidator,
    param('inboundId').isInt({ min: 1 }).withMessage('inboundId must be a positive integer').toInt(),
    body('priority').isInt({ min: 1, max: 9999 }).withMessage('priority must be between 1 and 9999').toInt()
  ],
  validator,
  userController.updateUserInboundPriority
);
router.post(
  '/:id/inbounds/reorder-pattern/preview',
  [
    ...idParamValidator,
    body('pattern')
      .optional()
      .isIn(['myanmar'])
      .withMessage('pattern must be "myanmar"')
  ],
  validator,
  userController.previewUserInboundPatternReorder
);
router.post(
  '/:id/inbounds/reorder-quality/preview',
  [
    ...idParamValidator,
    body('windowMinutes')
      .optional()
      .isInt({ min: 5, max: 1440 })
      .withMessage('windowMinutes must be between 5 and 1440')
      .toInt()
  ],
  validator,
  userController.previewUserInboundQualityReorder
);
router.post(
  '/:id/inbounds/reorder-pattern',
  [
    ...idParamValidator,
    body('pattern')
      .optional()
      .isIn(['myanmar'])
      .withMessage('pattern must be "myanmar"'),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean()
  ],
  validator,
  userController.reorderUserInboundsByPattern
);
router.post(
  '/:id/inbounds/reorder-quality',
  [
    ...idParamValidator,
    body('windowMinutes')
      .optional()
      .isInt({ min: 5, max: 1440 })
      .withMessage('windowMinutes must be between 5 and 1440')
      .toInt(),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean()
  ],
  validator,
  userController.reorderUserInboundsByQuality
);
router.post(
  '/:id/inbounds/reorder',
  [
    ...idParamValidator,
    body('assignments').isArray({ min: 1 }).withMessage('assignments must be a non-empty array'),
    body('assignments.*.inboundId').isInt({ min: 1 }).withMessage('assignments[].inboundId must be a positive integer').toInt(),
    body('assignments.*.priority')
      .optional()
      .isInt({ min: 1, max: 9999 })
      .withMessage('assignments[].priority must be between 1 and 9999')
      .toInt(),
    body('assignments.*.enabled')
      .optional()
      .isBoolean()
      .withMessage('assignments[].enabled must be boolean')
      .toBoolean()
  ],
  validator,
  userController.reorderUserInbounds
);
router.post(
  '/:id/extend-expiry',
  [...idParamValidator, body('days').isInt({ min: 1 }).withMessage('days must be a positive integer').toInt()],
  validator,
  userController.extendExpiry
);
router.get('/:id', idParamValidator, validator, userController.getUser);
router.post('/', userValidators.create, validator, userController.createUser);
router.put('/:id', [...idParamValidator, ...userValidators.update], validator, userController.updateUser);
router.delete('/:id', authorize('SUPER_ADMIN'), idParamValidator, validator, userController.deleteUser);

module.exports = router;
