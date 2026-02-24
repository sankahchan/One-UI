const express = require('express');
const { body, query } = require('express-validator');

const mieruController = require('../controllers/mieru.controller');
const { authenticate, authorize, requireBearerAuth } = require('../middleware/auth');
const validate = require('../middleware/validator');

const router = express.Router();

router.use(requireBearerAuth, authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.get('/policy', mieruController.getPolicy);
router.get('/status', mieruController.getStatus);
router.post('/restart', mieruController.restart);
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

module.exports = router;
