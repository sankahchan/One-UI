/**
 * API Key Authentication Middleware
 * Authenticates requests using X-API-Key header
 */

const apiKeyService = require('../services/apiKey.service');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

const BEARER_ONLY_RESOURCES = new Set([
    'api-keys',
    'auth',
    'backup',
    'ssl',
    'settings',
    'xray',
    'reality'
]);

function inferApiPermission(req) {
    const path = String(req.path || '');
    if (!path.startsWith('/api/')) {
        return null;
    }

    const parts = path.split('/').filter(Boolean);
    const resource = parts.length >= 2 ? parts[1] : '';
    if (!resource) {
        return null;
    }

    const method = String(req.method || '').toUpperCase();
    const action = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'read' : 'write';

    return {
        resource,
        action,
        permission: `${resource}:${action}`
    };
}

/**
 * Middleware that authenticates via API key
 * Sets req.admin and req.apiKey if valid
 */
const apiKeyAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return next();
    }

    try {
        const keyData = await apiKeyService.validate(apiKey);

        if (!keyData) {
            throw new UnauthorizedError('Invalid or expired API key');
        }

        // Set admin from API key
        req.admin = keyData.admin;
        req.apiKey = keyData;
        req.isApiKeyAuth = true;

        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Middleware that enforces API key scopes for /api/* requests.
 * - Empty permissions => full access (backwards compatible).
 * - Supports wildcard: "*" or "<resource>:*".
 * - "write" implies "read" for the same resource.
 * - Certain resources are bearer-only by default.
 */
const enforceApiKeyPermissions = (req, _res, next) => {
    if (!req.isApiKeyAuth) {
        return next();
    }

    const inferred = inferApiPermission(req);
    if (!inferred) {
        return next();
    }

    if (BEARER_ONLY_RESOURCES.has(inferred.resource)) {
        return next(new ForbiddenError('This endpoint requires a Bearer token'));
    }

    const permissions = Array.isArray(req.apiKey?.permissions) ? req.apiKey.permissions : [];
    if (permissions.length === 0 || permissions.includes('*')) {
        return next();
    }

    const resourceWildcard = `${inferred.resource}:*`;
    if (permissions.includes(resourceWildcard) || permissions.includes(inferred.permission)) {
        return next();
    }

    if (inferred.action === 'read' && permissions.includes(`${inferred.resource}:write`)) {
        return next();
    }

    return next(new ForbiddenError(`Missing permission: ${inferred.permission}`));
};

/**
 * Middleware that requires API key authentication
 * Use this for API-key-only endpoints
 */
const requireApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return next(new UnauthorizedError('API key required'));
    }

    try {
        const keyData = await apiKeyService.validate(apiKey);

        if (!keyData) {
            throw new UnauthorizedError('Invalid or expired API key');
        }

        req.admin = keyData.admin;
        req.apiKey = keyData;
        req.isApiKeyAuth = true;

        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Check if request has specific permission
 * @param {string} permission - Permission to check
 */
const hasPermission = (permission) => (req, res, next) => {
    if (!req.apiKey) {
        return next();
    }

    const permissions = req.apiKey.permissions || [];

    // Empty permissions means full access
    if (permissions.length === 0) {
        return next();
    }

    if (!permissions.includes(permission) && !permissions.includes('*')) {
        return next(new UnauthorizedError(`Missing permission: ${permission}`));
    }

    next();
};

module.exports = {
    apiKeyAuth,
    enforceApiKeyPermissions,
    requireApiKey,
    hasPermission
};
