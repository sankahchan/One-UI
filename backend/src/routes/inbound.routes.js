const { Router } = require('express');
const { body } = require('express-validator');
const inboundController = require('../controllers/inbound.controller');
const validator = require('../middleware/validator');
const { authenticate, authorize } = require('../middleware/auth');
const { idParamValidator, paginationValidators, inboundValidators, inboundBulkValidators } = require('../utils/validators');

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.get('/', paginationValidators, validator, inboundController.listInbounds);
router.get('/wireguard/keys', inboundController.generateWireguardKeys);
router.get('/reality/keys', inboundController.generateRealityKeys);
router.get('/random-port', inboundController.getRandomPort);
router.get('/:id/client-templates', idParamValidator, validator, inboundController.getInboundClientTemplates);
router.get('/:id/client-templates/pack', idParamValidator, validator, inboundController.downloadInboundClientTemplatePack);
router.get('/:id/client-templates/pack/all-users', idParamValidator, validator, inboundController.downloadInboundAllUsersClientTemplatePack);
router.get('/:id', idParamValidator, validator, inboundController.getInbound);
router.post('/', inboundValidators.create, validator, inboundController.createInbound);
router.post(
  '/presets/myanmar',
  [
    body('serverAddress').isString().trim().notEmpty().withMessage('serverAddress is required'),
    body('serverName').optional().isString().trim().notEmpty().withMessage('serverName cannot be empty'),
    body('cdnHost').optional().isString().trim().notEmpty().withMessage('cdnHost cannot be empty'),
    body('fallbackPorts')
      .optional()
      .custom((value) => Array.isArray(value) || typeof value === 'string')
      .withMessage('fallbackPorts must be an array or comma-separated string'),
    body('userIds')
      .optional()
      .custom((value) => Array.isArray(value) || typeof value === 'string')
      .withMessage('userIds must be an array or comma-separated string'),
    body('groupIds')
      .optional()
      .custom((value) => Array.isArray(value) || typeof value === 'string')
      .withMessage('groupIds must be an array or comma-separated string'),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be a boolean')
      .toBoolean()
  ],
  validator,
  inboundController.applyMyanmarPreset
);
router.post('/bulk/delete', authorize('SUPER_ADMIN'), inboundBulkValidators.inboundIds, validator, inboundController.bulkDeleteInbounds);
router.post('/bulk/enable', inboundBulkValidators.inboundIds, validator, inboundController.bulkEnableInbounds);
router.post('/bulk/disable', inboundBulkValidators.inboundIds, validator, inboundController.bulkDisableInbounds);
router.post('/:id/toggle', idParamValidator, validator, inboundController.toggleInbound);
router.post('/:id/random-port', idParamValidator, validator, inboundController.assignRandomPort);
router.put('/:id', [...idParamValidator, ...inboundValidators.update], validator, inboundController.updateInbound);
router.delete('/:id', authorize('SUPER_ADMIN'), idParamValidator, validator, inboundController.deleteInbound);

module.exports = router;
