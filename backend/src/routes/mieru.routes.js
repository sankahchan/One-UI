const express = require('express');
const { body, query } = require('express-validator');

const mieruController = require('../controllers/mieru.controller');
const { authenticate, authorize, requireBearerAuth } = require('../middleware/auth');
const validate = require('../middleware/validator');

const router = express.Router();

router.use(requireBearerAuth, authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.get('/policy', mieruController.getPolicy);
router.get('/status', mieruController.getStatus);
router.get('/profile', mieruController.getProfile);
router.post('/restart', mieruController.restart);
router.put(
  '/profile',
  [
    body('server')
      .trim()
      .isString()
      .withMessage('server must be a string')
      .notEmpty()
      .withMessage('server is required')
      .isLength({ max: 255 })
      .withMessage('server must be at most 255 characters'),
    body('portRange')
      .optional()
      .isString()
      .withMessage('portRange must be a string')
      .isLength({ min: 3, max: 32 })
      .withMessage('portRange must be 3-32 characters'),
    body('transport')
      .optional()
      .isIn(['TCP', 'UDP', 'tcp', 'udp'])
      .withMessage('transport must be TCP or UDP'),
    body('udp')
      .optional()
      .isBoolean()
      .withMessage('udp must be boolean')
      .toBoolean(),
    body('multiplexing')
      .optional()
      .isString()
      .withMessage('multiplexing must be a string')
      .isLength({ min: 3, max: 64 })
      .withMessage('multiplexing must be 3-64 characters')
  ],
  validate,
  mieruController.updateProfile
);
router.post(
  '/sync',
  [
    body('reason')
      .optional()
      .isString()
      .withMessage('reason must be a string')
      .isLength({ min: 1, max: 120 })
      .withMessage('reason must be 1-120 characters')
  ],
  validate,
  mieruController.sync
);
router.get(
  '/logs',
  [
    query('lines')
      .optional()
      .isInt({ min: 10, max: 500 })
      .withMessage('lines must be between 10 and 500')
      .toInt()
  ],
  validate,
  mieruController.getLogs
);
router.get(
  '/users',
  [
    query('includeOnline')
      .optional()
      .isBoolean()
      .withMessage('includeOnline must be boolean')
      .toBoolean()
  ],
  validate,
  mieruController.listUsers
);
router.post(
  '/users',
  [
    body('username')
      .trim()
      .isString()
      .withMessage('username must be a string')
      .notEmpty()
      .withMessage('username is required')
      .matches(/^[A-Za-z0-9._@-]+$/)
      .withMessage('username may only contain letters, numbers, dot, underscore, @, and dash')
      .isLength({ min: 3, max: 96 })
      .withMessage('username must be 3-96 characters'),
    body('password')
      .trim()
      .isString()
      .withMessage('password must be a string')
      .notEmpty()
      .withMessage('password is required')
      .isLength({ min: 4, max: 256 })
      .withMessage('password must be 4-256 characters'),
    body('enabled')
      .optional()
      .isBoolean()
      .withMessage('enabled must be boolean')
      .toBoolean()
  ],
  validate,
  mieruController.createUser
);
router.put(
  '/users/:username',
  [
    body('username')
      .optional()
      .trim()
      .isString()
      .withMessage('username must be a string')
      .matches(/^[A-Za-z0-9._@-]+$/)
      .withMessage('username may only contain letters, numbers, dot, underscore, @, and dash')
      .isLength({ min: 3, max: 96 })
      .withMessage('username must be 3-96 characters'),
    body('password')
      .optional()
      .trim()
      .isString()
      .withMessage('password must be a string')
      .isLength({ min: 4, max: 256 })
      .withMessage('password must be 4-256 characters'),
    body('enabled')
      .optional()
      .isBoolean()
      .withMessage('enabled must be boolean')
      .toBoolean()
  ],
  validate,
  mieruController.updateUser
);
router.delete('/users/:username', mieruController.deleteUser);
router.get('/users/:username/export', mieruController.exportUser);
router.get('/online', mieruController.getOnlineSnapshot);

module.exports = router;
