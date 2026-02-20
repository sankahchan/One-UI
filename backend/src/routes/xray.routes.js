const express = require('express');
const { body, query } = require('express-validator');
const xrayController = require('../controllers/xray.controller');
const { authenticate, authorize, requireBearerAuth } = require('../middleware/auth');
const validate = require('../middleware/validator');
const { xrayUpdateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// All routes require authentication
router.use(requireBearerAuth, authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.post('/restart', xrayController.restart);
router.get('/status', xrayController.getStatus);
router.get('/config', xrayController.getConfig);
router.post('/config/reload', xrayController.reloadConfig);
router.post('/config/snapshots', authorize('SUPER_ADMIN', 'ADMIN'), xrayController.createConfigSnapshot);
router.get(
  '/config/snapshots',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 200 })
      .withMessage('limit must be between 1 and 200')
      .toInt()
  ],
  validate,
  xrayController.getConfigSnapshots
);
router.post(
  '/config/rollback',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('snapshotId').isString().trim().notEmpty().withMessage('snapshotId is required'),
    body('applyMethod')
      .optional()
      .isIn(['restart', 'hot', 'none'])
      .withMessage('applyMethod must be one of restart, hot, none')
  ],
  validate,
  xrayController.rollbackConfigSnapshot
);
router.post('/confdir/sync', authorize('SUPER_ADMIN', 'ADMIN'), xrayController.syncConfDir);
router.get('/confdir/status', authorize('SUPER_ADMIN', 'ADMIN'), xrayController.getConfDirStatus);
router.get('/routing/profile', authorize('SUPER_ADMIN', 'ADMIN'), xrayController.getRoutingProfile);
router.put(
  '/routing/profile',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('mode')
      .optional()
      .isIn(['smart', 'filtered', 'strict', 'open'])
      .withMessage('mode must be one of smart, filtered, strict, open'),
    body('domesticIps')
      .optional()
      .custom((value) => Array.isArray(value) || typeof value === 'string')
      .withMessage('domesticIps must be an array or comma-separated string'),
    body('domesticDomains')
      .optional()
      .custom((value) => Array.isArray(value) || typeof value === 'string')
      .withMessage('domesticDomains must be an array or comma-separated string'),
    body('blockPrivate')
      .optional()
      .isBoolean()
      .withMessage('blockPrivate must be boolean')
      .toBoolean(),
    body('blockBitTorrent')
      .optional()
      .isBoolean()
      .withMessage('blockBitTorrent must be boolean')
      .toBoolean(),
    body('apply')
      .optional()
      .isBoolean()
      .withMessage('apply must be boolean')
      .toBoolean()
  ],
  validate,
  xrayController.updateRoutingProfile
);
router.get(
  '/geodata/status',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    query('includeHash')
      .optional()
      .isBoolean()
      .withMessage('includeHash must be boolean')
      .toBoolean()
  ],
  validate,
  xrayController.getGeodataStatus
);
router.post(
  '/geodata/update',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('useCommand').optional().isBoolean().withMessage('useCommand must be boolean').toBoolean(),
    body('forceDownload').optional().isBoolean().withMessage('forceDownload must be boolean').toBoolean(),
    body('reload').optional().isBoolean().withMessage('reload must be boolean').toBoolean(),
    body('command').optional().isString().withMessage('command must be a string')
  ],
  validate,
  xrayController.updateGeodata
);
router.get('/online', xrayController.getOnlineUsers);

router.get('/update/policy', authorize('SUPER_ADMIN', 'ADMIN'), xrayController.getUpdatePolicy);
router.get('/update/preflight', authorize('SUPER_ADMIN', 'ADMIN'), xrayController.getUpdatePreflight);
router.get(
  '/update/history',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    query('page').optional().isInt({ min: 1, max: 10000 }).withMessage('page must be between 1 and 10000').toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be between 1 and 200').toInt()
  ],
  validate,
  xrayController.getUpdateHistory
);
router.get('/update/backups', authorize('SUPER_ADMIN', 'ADMIN'), xrayController.getUpdateBackups);
router.get(
  '/update/releases',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    query('force')
      .optional()
      .isBoolean()
      .withMessage('force must be boolean')
      .toBoolean()
  ],
  validate,
  xrayController.getUpdateReleaseIntel
);

router.post(
  '/update/canary',
  authorize('SUPER_ADMIN', 'ADMIN'),
  xrayUpdateLimiter,
  [
    body('channel').optional().isIn(['stable', 'latest']).withMessage('channel must be stable or latest'),
    body('image').optional().isString().withMessage('image must be a string'),
    body('noRollback').optional().isBoolean().withMessage('noRollback must be boolean').toBoolean()
  ],
  validate,
  xrayController.runCanaryUpdate
);

router.post(
  '/update/full',
  authorize('SUPER_ADMIN', 'ADMIN'),
  xrayUpdateLimiter,
  [
    body('channel').optional().isIn(['stable', 'latest']).withMessage('channel must be stable or latest'),
    body('image').optional().isString().withMessage('image must be a string'),
    body('noRollback').optional().isBoolean().withMessage('noRollback must be boolean').toBoolean(),
    body('force').optional().isBoolean().withMessage('force must be boolean').toBoolean()
  ],
  validate,
  xrayController.runFullUpdate
);
router.post(
  '/update/rollback',
  authorize('SUPER_ADMIN', 'ADMIN'),
  xrayUpdateLimiter,
  [
    body('backupTag')
      .optional()
      .isString()
      .matches(/^oneui-xray-backup:[A-Za-z0-9_.-]+$/)
      .withMessage('backupTag must match oneui-xray-backup:<tag>')
  ],
  validate,
  xrayController.runRollbackUpdate
);
router.post(
  '/update/runtime-doctor',
  authorize('SUPER_ADMIN', 'ADMIN'),
  xrayUpdateLimiter,
  [
    body('repair')
      .optional()
      .isBoolean()
      .withMessage('repair must be boolean')
      .toBoolean(),
    body('source')
      .optional()
      .isString()
      .isLength({ min: 1, max: 64 })
      .withMessage('source must be 1-64 chars')
  ],
  validate,
  xrayController.runRuntimeDoctor
);

router.post(
  '/update/unlock',
  authorize('SUPER_ADMIN'),
  xrayUpdateLimiter,
  [
    body('reason')
      .optional()
      .isString()
      .isLength({ max: 120 })
      .withMessage('reason must be a string up to 120 chars'),
    body('force')
      .optional()
      .isBoolean()
      .withMessage('force must be boolean')
      .toBoolean()
  ],
  validate,
  xrayController.forceUnlockUpdate
);

module.exports = router;
