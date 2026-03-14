const express = require('express');
const { body, param, query } = require('express-validator');
const outboundController = require('../controllers/outbound.controller');
const { authenticate, authorize, requireBearerAuth } = require('../middleware/auth');
const validate = require('../middleware/validator');

const router = express.Router();

router.use(requireBearerAuth, authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

const outboundProtocolValues = ['FREEDOM', 'BLACKHOLE', 'SOCKS', 'HTTP', 'TROJAN', 'VMESS', 'VLESS', 'SHADOWSOCKS'];

const createValidators = [
  body('tag').isString().trim().isLength({ min: 1, max: 100 }).withMessage('tag is required'),
  body('protocol').isIn(outboundProtocolValues).withMessage('protocol is invalid'),
  body('address').isString().trim().notEmpty().withMessage('address is required'),
  body('port').isInt({ min: 1, max: 65535 }).withMessage('port must be between 1 and 65535').toInt(),
  body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
  body('remark').optional().isString().isLength({ max: 255 }).withMessage('remark max 255 chars'),
  body('settings').optional().isObject().withMessage('settings must be an object'),
  body('streamSettings').optional().isObject().withMessage('streamSettings must be an object'),
  body('mux').optional().isObject().withMessage('mux must be an object'),
  body('priority').optional().isInt({ min: 1, max: 9999 }).withMessage('priority must be between 1 and 9999').toInt()
];

const updateValidators = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer').toInt(),
  body('tag').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('tag length invalid'),
  body('protocol').optional().isIn(outboundProtocolValues).withMessage('protocol is invalid'),
  body('address').optional().isString().trim().notEmpty().withMessage('address is required'),
  body('port').optional().isInt({ min: 1, max: 65535 }).withMessage('port invalid').toInt(),
  body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
  body('remark').optional().isString().isLength({ max: 255 }),
  body('settings').optional().isObject(),
  body('streamSettings').optional().isObject(),
  body('mux').optional().isObject(),
  body('priority').optional().isInt({ min: 1, max: 9999 }).toInt()
];

router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], validate, outboundController.list);

router.get('/:id', [
  param('id').isInt({ min: 1 }).toInt()
], validate, outboundController.getById);

router.post('/', createValidators, validate, outboundController.create);
router.put('/:id', updateValidators, validate, outboundController.update);
router.delete('/:id', [param('id').isInt({ min: 1 }).toInt()], validate, outboundController.remove);
router.post('/:id/toggle', [param('id').isInt({ min: 1 }).toInt()], validate, outboundController.toggle);

module.exports = router;
