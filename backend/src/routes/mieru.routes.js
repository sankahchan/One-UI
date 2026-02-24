const express = require('express');
const { query } = require('express-validator');

const mieruController = require('../controllers/mieru.controller');
const { authenticate, authorize, requireBearerAuth } = require('../middleware/auth');
const validate = require('../middleware/validator');

const router = express.Router();

router.use(requireBearerAuth, authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.get('/policy', mieruController.getPolicy);
router.get('/status', mieruController.getStatus);
router.post('/restart', mieruController.restart);
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
