const express = require('express');
const { body, param, query } = require('express-validator');

const authController = require('../controllers/auth.controller');
const { authenticate, requireActiveSession, requireBearerAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

router.post(
  '/login',
  rateLimit.authLimiter,
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('otp').optional().isLength({ min: 6, max: 8 }).withMessage('OTP format is invalid')
  ],
  validate,
  authController.login
);

router.get('/telegram/config', authController.telegramConfig);
router.post(
  '/login/telegram',
  rateLimit.authLimiter,
  [
    body('id').notEmpty().withMessage('Telegram id is required'),
    body('auth_date').notEmpty().withMessage('Telegram auth_date is required'),
    body('hash').isString().notEmpty().withMessage('Telegram hash is required'),
    body('otp').optional().isLength({ min: 6, max: 8 }).withMessage('OTP format is invalid')
  ],
  validate,
  authController.loginTelegram
);
router.get('/telegram/link', requireBearerAuth, authenticate, authController.getTelegramLink);
router.put(
  '/telegram/link',
  requireBearerAuth,
  authenticate,
  requireActiveSession,
  [body('telegramId').isString().notEmpty().withMessage('telegramId is required')],
  validate,
  authController.linkTelegram
);
router.delete('/telegram/link', requireBearerAuth, authenticate, requireActiveSession, authController.unlinkTelegram);

router.post('/logout', authController.logout);
router.put(
  '/profile',
  requireBearerAuth,
  authenticate,
  requireActiveSession,
  rateLimit.profileLimiter,
  [
    body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
    body('username')
      .optional({ values: 'falsy' })
      .isString()
      .trim()
      .isLength({ min: 3, max: 32 })
      .withMessage('Username must be between 3 and 32 characters'),
    body('newPassword')
      .optional({ values: 'falsy' })
      .isString()
      .isLength({ min: 8, max: 128 })
      .withMessage('New password must be between 8 and 128 characters'),
    body('confirmPassword')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Confirm password must be a string')
  ],
  validate,
  authController.updateProfile
);
router.post(
  '/refresh',
  rateLimit.refreshLimiter,
  [
    body('refreshToken')
      .optional()
      .isString()
      .withMessage('refreshToken must be a string')
  ],
  validate,
  authController.refresh
);
router.get('/me', requireBearerAuth, authenticate, authController.me);
router.get(
  '/sessions',
  requireBearerAuth,
  authenticate,
  requireActiveSession,
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('limit must be between 1 and 100')
      .toInt(),
    query('includeRevoked')
      .optional()
      .isBoolean()
      .withMessage('includeRevoked must be boolean')
      .toBoolean()
  ],
  validate,
  authController.listSessions
);
router.delete(
  '/sessions/:sid',
  requireBearerAuth,
  authenticate,
  requireActiveSession,
  [
    param('sid')
      .isString()
      .matches(/^[a-f0-9]{20,128}$/i)
      .withMessage('sid format is invalid'),
    body('allowCurrent').optional().isBoolean().withMessage('allowCurrent must be boolean').toBoolean()
  ],
  validate,
  authController.revokeSessionById
);
router.post('/logout-all', requireBearerAuth, authenticate, requireActiveSession, authController.logoutAll);
router.post('/2fa/setup', requireBearerAuth, authenticate, requireActiveSession, authController.setupTwoFactor);
router.post(
  '/2fa/enable',
  requireBearerAuth,
  authenticate,
  requireActiveSession,
  [body('otp').isLength({ min: 6, max: 8 }).withMessage('OTP is required')],
  validate,
  authController.enableTwoFactor
);
router.post(
  '/2fa/disable',
  requireBearerAuth,
  authenticate,
  requireActiveSession,
  [body('otp').optional().isLength({ min: 6, max: 8 }).withMessage('OTP format is invalid')],
  validate,
  authController.disableTwoFactor
);

module.exports = router;
