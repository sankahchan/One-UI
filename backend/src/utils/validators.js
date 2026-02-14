const { body, param, query } = require('express-validator');

const idParamValidator = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer').toInt()
];

const paginationValidators = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt()
];

const authValidators = {
  login: [
    body('username').isString().trim().notEmpty().withMessage('username is required'),
    body('password').isString().notEmpty().withMessage('password is required')
  ]
};

function bigintValidator(fieldName) {
  return body(fieldName)
    .optional()
    .custom((value) => {
      if (typeof value === 'number') {
        return Number.isInteger(value) && value >= 0;
      }

      if (typeof value === 'string') {
        return /^\d+$/.test(value.trim());
      }

      return false;
    })
    .withMessage(`${fieldName} must be a non-negative integer`);
}

function isValidFallbackEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  if (entry.dest === undefined || entry.dest === null || String(entry.dest).trim() === '') {
    return false;
  }

  return true;
}

function validateFallbacksValue(value) {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  let fallbacks = value;

  if (typeof fallbacks === 'string') {
    try {
      fallbacks = JSON.parse(fallbacks);
    } catch (_error) {
      throw new Error('fallbacks must be valid JSON');
    }
  }

  if (!Array.isArray(fallbacks)) {
    throw new Error('fallbacks must be an array');
  }

  if (!fallbacks.every(isValidFallbackEntry)) {
    throw new Error('each fallback must include a dest value');
  }

  return true;
}

const userStatusValues = ['ACTIVE', 'EXPIRED', 'DISABLED', 'LIMITED'];
const trafficResetPeriodValues = ['NEVER', 'DAILY', 'WEEKLY', 'MONTHLY'];
const inboundProtocolValues = ['VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS', 'SOCKS', 'HTTP', 'DOKODEMO_DOOR', 'WIREGUARD', 'MTPROTO'];
const inboundNetworkValues = ['TCP', 'WS', 'GRPC', 'HTTP', 'HTTPUPGRADE', 'XHTTP'];
const inboundSecurityValues = ['NONE', 'TLS', 'REALITY'];

const userValidators = {
  create: [
    body('email').isEmail().withMessage('valid email is required').normalizeEmail(),
    body('dataLimit').isFloat({ min: 0 }).withMessage('dataLimit must be a non-negative number'),
    body('expiryDays').isInt({ min: 1 }).withMessage('expiryDays must be a positive integer').toInt(),
    body('inboundIds').isArray({ min: 1 }).withMessage('at least one inbound is required'),
    body('inboundIds.*').isInt({ min: 1 }).withMessage('inboundIds must contain valid IDs').toInt(),
    body('note').optional().isString().isLength({ max: 500 }).withMessage('note max length is 500'),
    body('ipLimit').optional().isInt({ min: 0 }).withMessage('ipLimit must be 0 or greater (0 = unlimited)').toInt(),
    body('deviceLimit').optional().isInt({ min: 0 }).withMessage('deviceLimit must be 0 or greater (0 = unlimited)').toInt(),
    body('startOnFirstUse').optional().isBoolean().withMessage('startOnFirstUse must be boolean').toBoolean(),
    body('status').optional().isIn(userStatusValues).withMessage('status is invalid')
  ],
  update: [
    body('email').optional().isEmail().withMessage('valid email is required').normalizeEmail(),
    body('dataLimit').optional().isFloat({ min: 0 }).withMessage('dataLimit must be a non-negative number'),
    body('expiryDays').optional().isInt({ min: 1 }).withMessage('expiryDays must be a positive integer').toInt(),
    body('inboundIds').optional().isArray().withMessage('inboundIds must be an array'),
    body('inboundIds.*').optional().isInt({ min: 1 }).withMessage('inboundIds must contain valid IDs').toInt(),
    body('note').optional().isString().isLength({ max: 500 }).withMessage('note max length is 500'),
    body('status').optional().isIn(userStatusValues).withMessage('status is invalid'),
    body('ipLimit').optional().isInt({ min: 0 }).withMessage('ipLimit must be 0 or greater (0 = unlimited)').toInt(),
    body('deviceLimit').optional().isInt({ min: 0 }).withMessage('deviceLimit must be 0 or greater (0 = unlimited)').toInt(),
    body('startOnFirstUse').optional().isBoolean().withMessage('startOnFirstUse must be boolean').toBoolean()
  ]
};

const inboundValidators = {
  create: [
    body('port').isInt({ min: 1, max: 65535 }).withMessage('port must be between 1 and 65535').toInt(),
    body('protocol').isIn(inboundProtocolValues).withMessage('protocol is invalid'),
    body('tag').isString().isLength({ min: 1, max: 100 }).withMessage('tag is required'),
    body('remark').optional().isString().isLength({ max: 255 }).withMessage('remark max length is 255'),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
    body('network').optional().isIn(inboundNetworkValues).withMessage('network is invalid'),
    body('security').optional().isIn(inboundSecurityValues).withMessage('security is invalid'),
    body('security').optional().custom((value, { req }) => {
      if (value === 'REALITY' && req.body.protocol !== 'VLESS') {
        throw new Error('REALITY security is only supported with VLESS');
      }
      return true;
    }),
    body('serverName').optional().isString().isLength({ max: 255 }).withMessage('serverName max length is 255'),
    body('serverAddress').isString().trim().notEmpty().withMessage('serverAddress is required'),
    body('alpn').optional().isString().withMessage('alpn must be a string'),
    body('wsPath').optional().isString().withMessage('wsPath must be a string'),
    body('wsHost').optional().isString().withMessage('wsHost must be a string'),
    body('xhttpMode').optional().isString().withMessage('xhttpMode must be a string'),
    body('grpcServiceName').optional().isString().withMessage('grpcServiceName must be a string'),
    body('cipher').optional().isString().withMessage('cipher must be a string'),
    body('domains')
      .optional()
      .custom((value) => Array.isArray(value) || typeof value === 'string')
      .withMessage('domains must be an array or comma-separated string'),
    body('domains.*').optional().isString().withMessage('domains must be a list of strings'),
    body('fallbacks').optional().custom(validateFallbacksValue),
    body('realityPublicKey').optional().isString().withMessage('realityPublicKey must be a string'),
    body('realityPrivateKey').optional().isString().withMessage('realityPrivateKey must be a string'),
    body('realityShortId').optional().isString().withMessage('realityShortId must be a string'),
    body('realityShortIds').optional().isArray().withMessage('realityShortIds must be an array'),
    body('realityShortIds.*').optional().isString().withMessage('realityShortIds must be a list of strings'),
    body('realityServerNames').optional().isArray().withMessage('realityServerNames must be an array'),
    body('realityServerNames.*').optional().isString().withMessage('realityServerNames must be a list of strings'),
    body('realityFingerprint').optional().isString().withMessage('realityFingerprint must be a string'),
    body('realityDest').optional().isString().isLength({ max: 255 }).withMessage('realityDest max length is 255'),
    body('realitySpiderX').optional().isString().isLength({ max: 255 }).withMessage('realitySpiderX max length is 255'),
    body('wgPrivateKey').optional().isString().withMessage('wgPrivateKey must be a string'),
    body('wgPublicKey').optional().isString().withMessage('wgPublicKey must be a string'),
    body('wgAddress').optional().isString().withMessage('wgAddress must be a string'),
    body('wgPeerPublicKey').optional().isString().withMessage('wgPeerPublicKey must be a string'),
    body('wgPeerEndpoint').optional().isString().withMessage('wgPeerEndpoint must be a string'),
    body('wgAllowedIPs').optional().isString().withMessage('wgAllowedIPs must be a string'),
    body('wgMtu').optional().isInt({ min: 576, max: 9000 }).withMessage('wgMtu must be between 576 and 9000').toInt(),
    body('dokodemoTargetPort').optional().isInt({ min: 1, max: 65535 }).withMessage('dokodemoTargetPort must be between 1 and 65535').toInt(),
    body('dokodemoNetwork').optional().isString().withMessage('dokodemoNetwork must be a string'),
    body('dokodemoFollowRedirect').optional().isBoolean().withMessage('dokodemoFollowRedirect must be boolean').toBoolean()
  ],
  update: [
    body('port').optional().isInt({ min: 1, max: 65535 }).withMessage('port must be between 1 and 65535').toInt(),
    body('protocol').optional().isIn(inboundProtocolValues).withMessage('protocol is invalid'),
    body('tag').optional().isString().isLength({ min: 1, max: 100 }).withMessage('tag length is invalid'),
    body('remark').optional().isString().isLength({ max: 255 }).withMessage('remark max length is 255'),
    body('enabled').optional().isBoolean().withMessage('enabled must be boolean').toBoolean(),
    body('network').optional().isIn(inboundNetworkValues).withMessage('network is invalid'),
    body('security').optional().isIn(inboundSecurityValues).withMessage('security is invalid'),
    body('security').optional().custom((value, { req }) => {
      const effectiveProtocol = req.body.protocol;
      if (value === 'REALITY' && effectiveProtocol && effectiveProtocol !== 'VLESS') {
        throw new Error('REALITY security is only supported with VLESS');
      }
      return true;
    }),
    body('serverName').optional().isString().isLength({ max: 255 }).withMessage('serverName max length is 255'),
    body('serverAddress').optional().isString().trim().notEmpty().withMessage('serverAddress is invalid'),
    body('alpn').optional().isString().withMessage('alpn must be a string'),
    body('wsPath').optional().isString().withMessage('wsPath must be a string'),
    body('wsHost').optional().isString().withMessage('wsHost must be a string'),
    body('xhttpMode').optional().isString().withMessage('xhttpMode must be a string'),
    body('grpcServiceName').optional().isString().withMessage('grpcServiceName must be a string'),
    body('cipher').optional().isString().withMessage('cipher must be a string'),
    body('domains')
      .optional()
      .custom((value) => Array.isArray(value) || typeof value === 'string')
      .withMessage('domains must be an array or comma-separated string'),
    body('domains.*').optional().isString().withMessage('domains must be a list of strings'),
    body('fallbacks').optional().custom(validateFallbacksValue),
    body('realityPublicKey').optional().isString().withMessage('realityPublicKey must be a string'),
    body('realityPrivateKey').optional().isString().withMessage('realityPrivateKey must be a string'),
    body('realityShortId').optional().isString().withMessage('realityShortId must be a string'),
    body('realityShortIds').optional().isArray().withMessage('realityShortIds must be an array'),
    body('realityShortIds.*').optional().isString().withMessage('realityShortIds must be a list of strings'),
    body('realityServerNames').optional().isArray().withMessage('realityServerNames must be an array'),
    body('realityServerNames.*').optional().isString().withMessage('realityServerNames must be a list of strings'),
    body('realityFingerprint').optional().isString().withMessage('realityFingerprint must be a string'),
    body('realityDest').optional().isString().isLength({ max: 255 }).withMessage('realityDest max length is 255'),
    body('realitySpiderX').optional().isString().isLength({ max: 255 }).withMessage('realitySpiderX max length is 255'),
    body('wgPrivateKey').optional().isString().withMessage('wgPrivateKey must be a string'),
    body('wgPublicKey').optional().isString().withMessage('wgPublicKey must be a string'),
    body('wgAddress').optional().isString().withMessage('wgAddress must be a string'),
    body('wgPeerPublicKey').optional().isString().withMessage('wgPeerPublicKey must be a string'),
    body('wgPeerEndpoint').optional().isString().withMessage('wgPeerEndpoint must be a string'),
    body('wgAllowedIPs').optional().isString().withMessage('wgAllowedIPs must be a string'),
    body('wgMtu').optional().isInt({ min: 576, max: 9000 }).withMessage('wgMtu must be between 576 and 9000').toInt(),
    body('dokodemoTargetPort').optional().isInt({ min: 1, max: 65535 }).withMessage('dokodemoTargetPort must be between 1 and 65535').toInt(),
    body('dokodemoNetwork').optional().isString().withMessage('dokodemoNetwork must be a string'),
    body('dokodemoFollowRedirect').optional().isBoolean().withMessage('dokodemoFollowRedirect must be boolean').toBoolean()
  ]
};

const bulkValidators = {
  createUsers: [
    body('prefix')
      .isString()
      .trim()
      .matches(/^[a-zA-Z0-9._-]+$/)
      .withMessage('prefix must contain only letters, numbers, dot, underscore, or dash')
      .isLength({ min: 1, max: 40 })
      .withMessage('prefix length must be between 1 and 40'),
    body('domain')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('domain is required'),
    body('count')
      .isInt({ min: 1, max: 200 })
      .withMessage('count must be between 1 and 200')
      .toInt(),
    body('startIndex')
      .optional()
      .isInt({ min: 1, max: 999999 })
      .withMessage('startIndex must be between 1 and 999999')
      .toInt(),
    body('padding')
      .optional()
      .isInt({ min: 0, max: 8 })
      .withMessage('padding must be between 0 and 8')
      .toInt(),
    body('dataLimit')
      .isFloat({ min: 0 })
      .withMessage('dataLimit must be a non-negative number'),
    body('expiryDays')
      .isInt({ min: 1 })
      .withMessage('expiryDays must be a positive integer')
      .toInt(),
    body('inboundIds')
      .isArray({ min: 1 })
      .withMessage('inboundIds must be a non-empty array'),
    body('inboundIds.*')
      .isInt({ min: 1 })
      .withMessage('inboundIds must contain valid IDs')
      .toInt(),
    body('note')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('note max length is 500'),
    body('ipLimit')
      .optional()
      .isInt({ min: 0 })
      .withMessage('ipLimit must be 0 or greater')
      .toInt(),
    body('deviceLimit')
      .optional()
      .isInt({ min: 0 })
      .withMessage('deviceLimit must be 0 or greater')
      .toInt(),
    body('status')
      .optional()
      .isIn(userStatusValues)
      .withMessage('status is invalid')
  ],
  userIds: [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .isInt({ min: 1 })
      .withMessage('userIds must contain valid IDs')
      .toInt()
  ],
  extendExpiry: [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .isInt({ min: 1 })
      .withMessage('userIds must contain valid IDs')
      .toInt(),
    body('days')
      .isInt({ min: 1 })
      .withMessage('days must be a positive integer')
      .toInt()
  ],
  updateStatus: [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .isInt({ min: 1 })
      .withMessage('userIds must contain valid IDs')
      .toInt(),
    body('status')
      .isIn(userStatusValues)
      .withMessage('status must be one of: ACTIVE, EXPIRED, DISABLED, LIMITED')
  ],
  assignInbounds: [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .isInt({ min: 1 })
      .withMessage('userIds must contain valid IDs')
      .toInt(),
    body('inboundIds')
      .isArray({ min: 1 })
      .withMessage('inboundIds must be a non-empty array'),
    body('inboundIds.*')
      .isInt({ min: 1 })
      .withMessage('inboundIds must contain valid IDs')
      .toInt(),
    body('mode')
      .optional()
      .isIn(['merge', 'replace'])
      .withMessage('mode must be either merge or replace')
  ]
};

const keyLifecycleValidators = {
  rotate: [
    body('rotateUuid').optional().isBoolean().withMessage('rotateUuid must be boolean').toBoolean(),
    body('rotatePassword').optional().isBoolean().withMessage('rotatePassword must be boolean').toBoolean(),
    body('rotateSubscriptionToken')
      .optional()
      .isBoolean()
      .withMessage('rotateSubscriptionToken must be boolean')
      .toBoolean(),
    body('reactivate').optional().isBoolean().withMessage('reactivate must be boolean').toBoolean(),
    body('resetTraffic').optional().isBoolean().withMessage('resetTraffic must be boolean').toBoolean()
  ],
  revoke: [
    body('disableUser').optional().isBoolean().withMessage('disableUser must be boolean').toBoolean(),
    body('disableInbounds').optional().isBoolean().withMessage('disableInbounds must be boolean').toBoolean(),
    body('revokeSubscription')
      .optional()
      .isBoolean()
      .withMessage('revokeSubscription must be boolean')
      .toBoolean(),
    body('rotateCredentials')
      .optional()
      .isBoolean()
      .withMessage('rotateCredentials must be boolean')
      .toBoolean()
  ],
  bulkRotate: [
    ...bulkValidators.userIds,
    body('rotateUuid').optional().isBoolean().withMessage('rotateUuid must be boolean').toBoolean(),
    body('rotatePassword').optional().isBoolean().withMessage('rotatePassword must be boolean').toBoolean(),
    body('rotateSubscriptionToken')
      .optional()
      .isBoolean()
      .withMessage('rotateSubscriptionToken must be boolean')
      .toBoolean(),
    body('reactivate').optional().isBoolean().withMessage('reactivate must be boolean').toBoolean(),
    body('resetTraffic').optional().isBoolean().withMessage('resetTraffic must be boolean').toBoolean()
  ],
  bulkRevoke: [
    ...bulkValidators.userIds,
    body('disableUser').optional().isBoolean().withMessage('disableUser must be boolean').toBoolean(),
    body('disableInbounds').optional().isBoolean().withMessage('disableInbounds must be boolean').toBoolean(),
    body('revokeSubscription')
      .optional()
      .isBoolean()
      .withMessage('revokeSubscription must be boolean')
      .toBoolean(),
    body('rotateCredentials')
      .optional()
      .isBoolean()
      .withMessage('rotateCredentials must be boolean')
      .toBoolean()
  ]
};

const inboundBulkValidators = {
  inboundIds: [
    body('inboundIds')
      .isArray({ min: 1 })
      .withMessage('inboundIds must be a non-empty array'),
    body('inboundIds.*')
      .isInt({ min: 1 })
      .withMessage('inboundIds must contain valid IDs')
      .toInt()
  ],
  setEnabled: [
    body('inboundIds')
      .isArray({ min: 1 })
      .withMessage('inboundIds must be a non-empty array'),
    body('inboundIds.*')
      .isInt({ min: 1 })
      .withMessage('inboundIds must contain valid IDs')
      .toInt(),
    body('enabled')
      .isBoolean()
      .withMessage('enabled must be a boolean')
      .toBoolean()
  ]
};

const groupValidators = {
  create: [
    body('name')
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('name must be between 1 and 100 characters'),
    body('remark')
      .optional()
      .isString()
      .isLength({ max: 255 })
      .withMessage('remark max length is 255'),
    body('isDisabled')
      .optional()
      .isBoolean()
      .withMessage('isDisabled must be boolean')
      .toBoolean(),
    body('dataLimit')
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage('dataLimit must be a non-negative number'),
    body('expiryDays')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 3650 })
      .withMessage('expiryDays must be between 1 and 3650')
      .toInt(),
    body('ipLimit')
      .optional({ nullable: true })
      .isInt({ min: 0, max: 1000 })
      .withMessage('ipLimit must be between 0 and 1000')
      .toInt(),
    body('status')
      .optional({ nullable: true })
      .isIn(userStatusValues)
      .withMessage('status is invalid'),
    body('trafficResetPeriod')
      .optional({ nullable: true })
      .isIn(trafficResetPeriodValues)
      .withMessage('trafficResetPeriod is invalid'),
    body('trafficResetDay')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 31 })
      .withMessage('trafficResetDay must be between 1 and 31')
      .toInt(),
    body('userIds')
      .optional()
      .isArray()
      .withMessage('userIds must be an array'),
    body('userIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('userIds must contain positive integers')
      .toInt(),
    body('inboundIds')
      .optional()
      .isArray()
      .withMessage('inboundIds must be an array'),
    body('inboundIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('inboundIds must contain positive integers')
      .toInt()
  ],
  update: [
    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('name must be between 1 and 100 characters'),
    body('remark')
      .optional()
      .isString()
      .isLength({ max: 255 })
      .withMessage('remark max length is 255'),
    body('isDisabled')
      .optional()
      .isBoolean()
      .withMessage('isDisabled must be boolean')
      .toBoolean(),
    body('dataLimit')
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage('dataLimit must be a non-negative number'),
    body('expiryDays')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 3650 })
      .withMessage('expiryDays must be between 1 and 3650')
      .toInt(),
    body('ipLimit')
      .optional({ nullable: true })
      .isInt({ min: 0, max: 1000 })
      .withMessage('ipLimit must be between 0 and 1000')
      .toInt(),
    body('status')
      .optional({ nullable: true })
      .isIn(userStatusValues)
      .withMessage('status is invalid'),
    body('trafficResetPeriod')
      .optional({ nullable: true })
      .isIn(trafficResetPeriodValues)
      .withMessage('trafficResetPeriod is invalid'),
    body('trafficResetDay')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 31 })
      .withMessage('trafficResetDay must be between 1 and 31')
      .toInt(),
    body('userIds')
      .optional()
      .isArray()
      .withMessage('userIds must be an array'),
    body('userIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('userIds must contain positive integers')
      .toInt(),
    body('inboundIds')
      .optional()
      .isArray()
      .withMessage('inboundIds must be an array'),
    body('inboundIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('inboundIds must contain positive integers')
      .toInt()
  ],
  userIds: [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .isInt({ min: 1 })
      .withMessage('userIds must contain positive integers')
      .toInt()
  ],
  inboundIds: [
    body('inboundIds')
      .isArray()
      .withMessage('inboundIds must be an array'),
    body('inboundIds')
      .custom((value) => {
        if (!Array.isArray(value)) {
          return false;
        }

        return value.every((entry) => {
          if (typeof entry === 'number') {
            return Number.isInteger(entry) && entry > 0;
          }
          if (typeof entry === 'string') {
            const parsed = Number.parseInt(entry, 10);
            return Number.isInteger(parsed) && parsed > 0;
          }
          if (entry && typeof entry === 'object') {
            const parsedInboundId = Number.parseInt(String(entry.inboundId ?? entry.id ?? ''), 10);
            if (!Number.isInteger(parsedInboundId) || parsedInboundId < 1) {
              return false;
            }

            if (entry.priority !== undefined) {
              const parsedPriority = Number.parseInt(String(entry.priority), 10);
              if (!Number.isInteger(parsedPriority) || parsedPriority < 1 || parsedPriority > 9999) {
                return false;
              }
            }

            if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
              return false;
            }

            return true;
          }
          return false;
        });
      })
      .withMessage('inboundIds must contain positive IDs or objects with inboundId')
  ],
  applyPolicy: [
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean(),
    body('userIds')
      .optional()
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('userIds must contain positive integers')
      .toInt()
  ],
  templateCreate: [
    body('name')
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('name must be between 1 and 120 characters'),
    body('description')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 500 })
      .withMessage('description max length is 500'),
    body('isDefault')
      .optional()
      .isBoolean()
      .withMessage('isDefault must be boolean')
      .toBoolean(),
    body('dataLimit')
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage('dataLimit must be a non-negative number'),
    body('expiryDays')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 3650 })
      .withMessage('expiryDays must be between 1 and 3650')
      .toInt(),
    body('ipLimit')
      .optional({ nullable: true })
      .isInt({ min: 0, max: 1000 })
      .withMessage('ipLimit must be between 0 and 1000')
      .toInt(),
    body('status')
      .optional({ nullable: true })
      .isIn(userStatusValues)
      .withMessage('status is invalid'),
    body('trafficResetPeriod')
      .optional({ nullable: true })
      .isIn(trafficResetPeriodValues)
      .withMessage('trafficResetPeriod is invalid'),
    body('trafficResetDay')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 31 })
      .withMessage('trafficResetDay must be between 1 and 31')
      .toInt()
  ],
  templateUpdate: [
    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('name must be between 1 and 120 characters'),
    body('description')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 500 })
      .withMessage('description max length is 500'),
    body('isDefault')
      .optional()
      .isBoolean()
      .withMessage('isDefault must be boolean')
      .toBoolean(),
    body('dataLimit')
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage('dataLimit must be a non-negative number'),
    body('expiryDays')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 3650 })
      .withMessage('expiryDays must be between 1 and 3650')
      .toInt(),
    body('ipLimit')
      .optional({ nullable: true })
      .isInt({ min: 0, max: 1000 })
      .withMessage('ipLimit must be between 0 and 1000')
      .toInt(),
    body('status')
      .optional({ nullable: true })
      .isIn(userStatusValues)
      .withMessage('status is invalid'),
    body('trafficResetPeriod')
      .optional({ nullable: true })
      .isIn(trafficResetPeriodValues)
      .withMessage('trafficResetPeriod is invalid'),
    body('trafficResetDay')
      .optional({ nullable: true })
      .isInt({ min: 1, max: 31 })
      .withMessage('trafficResetDay must be between 1 and 31')
      .toInt()
  ],
  applyTemplate: [
    body('templateId')
      .isInt({ min: 1 })
      .withMessage('templateId must be a positive integer')
      .toInt(),
    body('applyNow')
      .optional()
      .isBoolean()
      .withMessage('applyNow must be boolean')
      .toBoolean(),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean(),
    body('userIds')
      .optional()
      .isArray({ min: 1 })
      .withMessage('userIds must be a non-empty array'),
    body('userIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('userIds must contain positive integers')
      .toInt()
  ],
  scheduleCreate: [
    body('name')
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('name must be between 1 and 120 characters'),
    body('groupId')
      .isInt({ min: 1 })
      .withMessage('groupId must be a positive integer')
      .toInt(),
    body('templateId')
      .optional({ nullable: true })
      .isInt({ min: 1 })
      .withMessage('templateId must be a positive integer')
      .toInt(),
    body('cronExpression')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('cronExpression is required'),
    body('timezone')
      .optional()
      .isString()
      .isLength({ max: 120 })
      .withMessage('timezone max length is 120'),
    body('enabled')
      .optional()
      .isBoolean()
      .withMessage('enabled must be boolean')
      .toBoolean(),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean(),
    body('targetUserIds')
      .optional()
      .isArray()
      .withMessage('targetUserIds must be an array'),
    body('targetUserIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('targetUserIds must contain positive integers')
      .toInt()
  ],
  scheduleUpdate: [
    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage('name must be between 1 and 120 characters'),
    body('groupId')
      .optional()
      .isInt({ min: 1 })
      .withMessage('groupId must be a positive integer')
      .toInt(),
    body('templateId')
      .optional({ nullable: true })
      .isInt({ min: 1 })
      .withMessage('templateId must be a positive integer')
      .toInt(),
    body('cronExpression')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('cronExpression must not be empty'),
    body('timezone')
      .optional()
      .isString()
      .isLength({ max: 120 })
      .withMessage('timezone max length is 120'),
    body('enabled')
      .optional()
      .isBoolean()
      .withMessage('enabled must be boolean')
      .toBoolean(),
    body('dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be boolean')
      .toBoolean(),
    body('targetUserIds')
      .optional()
      .isArray()
      .withMessage('targetUserIds must be an array'),
    body('targetUserIds.*')
      .optional()
      .isInt({ min: 1 })
      .withMessage('targetUserIds must contain positive integers')
      .toInt()
  ]
};

module.exports = {
  idParamValidator,
  paginationValidators,
  authValidators,
  userValidators,
  inboundValidators,
  bulkValidators,
  keyLifecycleValidators,
  inboundBulkValidators,
  groupValidators
};
