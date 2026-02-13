const authService = require('../services/auth.service');
const { UnauthorizedError } = require('../utils/errors');

const authenticate = async (req, _res, next) => {
  try {
    if (!authService.isAdminIpAllowed(req.ip)) {
      throw new UnauthorizedError('Access from this IP is not allowed');
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyAccessToken(token);

    req.admin = decoded;
    next();
  } catch (_error) {
    next(new UnauthorizedError('Invalid or expired token'));
  }
};

const requireActiveSession = async (req, _res, next) => {
  try {
    if (!req.admin || !req.admin.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const sessionId = req.admin.sid ? String(req.admin.sid).trim() : '';
    if (!sessionId) {
      if (authService.isSessionClaimRequired()) {
        throw new UnauthorizedError('Session context missing');
      }
      return next();
    }

    await authService.assertActiveSession(req.admin.id, sessionId);
    next();
  } catch (_error) {
    next(new UnauthorizedError('Inactive or expired session'));
  }
};

const authorize = (...allowedRoles) => {
  return (req, _res, next) => {
    if (!req.admin) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return next(new UnauthorizedError('Insufficient permissions'));
    }

    next();
  };
};

module.exports = { authenticate, authorize, requireActiveSession };
