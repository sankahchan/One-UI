const { Router } = require('express');
const { param, query } = require('express-validator');

const groupController = require('../controllers/group.controller');
const validator = require('../middleware/validator');
const { authenticate, authorize } = require('../middleware/auth');
const { idParamValidator, paginationValidators, groupValidators } = require('../utils/validators');

const router = Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.get(
  '/',
  [
    ...paginationValidators,
    query('search').optional().isString().withMessage('search must be a string'),
    query('includeDisabled')
      .optional()
      .isBoolean()
      .withMessage('includeDisabled must be boolean')
      .toBoolean()
  ],
  validator,
  groupController.listGroups
);

router.get(
  '/templates',
  [
    ...paginationValidators,
    query('search').optional().isString().withMessage('search must be a string')
  ],
  validator,
  groupController.listPolicyTemplates
);
router.get(
  '/templates/:templateId',
  [
    param('templateId').isInt({ min: 1 }).withMessage('templateId must be a positive integer').toInt()
  ],
  validator,
  groupController.getPolicyTemplate
);
router.post('/templates', groupValidators.templateCreate, validator, groupController.createPolicyTemplate);
router.put(
  '/templates/:templateId',
  [
    param('templateId').isInt({ min: 1 }).withMessage('templateId must be a positive integer').toInt(),
    ...groupValidators.templateUpdate
  ],
  validator,
  groupController.updatePolicyTemplate
);
router.delete(
  '/templates/:templateId',
  [
    param('templateId').isInt({ min: 1 }).withMessage('templateId must be a positive integer').toInt()
  ],
  validator,
  groupController.deletePolicyTemplate
);

router.get(
  '/policy-schedules',
  [
    ...paginationValidators,
    query('search').optional().isString().withMessage('search must be a string'),
    query('groupId').optional().isInt({ min: 1 }).withMessage('groupId must be a positive integer').toInt(),
    query('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean()
  ],
  validator,
  groupController.listPolicySchedules
);
router.get(
  '/policy-schedules/:scheduleId',
  [
    param('scheduleId').isInt({ min: 1 }).withMessage('scheduleId must be a positive integer').toInt()
  ],
  validator,
  groupController.getPolicySchedule
);
router.post('/policy-schedules', groupValidators.scheduleCreate, validator, groupController.createPolicySchedule);
router.put(
  '/policy-schedules/:scheduleId',
  [
    param('scheduleId').isInt({ min: 1 }).withMessage('scheduleId must be a positive integer').toInt(),
    ...groupValidators.scheduleUpdate
  ],
  validator,
  groupController.updatePolicySchedule
);
router.delete(
  '/policy-schedules/:scheduleId',
  [
    param('scheduleId').isInt({ min: 1 }).withMessage('scheduleId must be a positive integer').toInt()
  ],
  validator,
  groupController.deletePolicySchedule
);
router.post(
  '/policy-schedules/:scheduleId/run',
  [
    param('scheduleId').isInt({ min: 1 }).withMessage('scheduleId must be a positive integer').toInt()
  ],
  validator,
  groupController.runPolicySchedule
);

router.get(
  '/policy-rollouts',
  [
    ...paginationValidators,
    query('groupId').optional().isInt({ min: 1 }).withMessage('groupId must be a positive integer').toInt(),
    query('scheduleId').optional().isInt({ min: 1 }).withMessage('scheduleId must be a positive integer').toInt(),
    query('status').optional().isIn(['SUCCESS', 'FAILED', 'DRY_RUN']).withMessage('status is invalid'),
    query('source').optional().isIn(['MANUAL', 'SCHEDULED']).withMessage('source is invalid')
  ],
  validator,
  groupController.listPolicyRollouts
);

router.get('/:id', idParamValidator, validator, groupController.getGroup);
router.post('/', groupValidators.create, validator, groupController.createGroup);
router.put('/:id', [...idParamValidator, ...groupValidators.update], validator, groupController.updateGroup);
router.delete('/:id', idParamValidator, validator, groupController.deleteGroup);
router.post('/:id/users/add', [...idParamValidator, ...groupValidators.userIds], validator, groupController.addUsers);
router.post('/:id/users/remove', [...idParamValidator, ...groupValidators.userIds], validator, groupController.removeUsers);
router.post('/:id/users/move', [...idParamValidator, ...groupValidators.userIds], validator, groupController.moveUsers);
router.put('/:id/inbounds', [...idParamValidator, ...groupValidators.inboundIds], validator, groupController.setInbounds);
router.post('/:id/policy/template', [...idParamValidator, ...groupValidators.applyTemplate], validator, groupController.applyPolicyTemplate);
router.post('/:id/policy/apply', [...idParamValidator, ...groupValidators.applyPolicy], validator, groupController.applyPolicy);

module.exports = router;
