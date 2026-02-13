/**
 * API Key Authentication Middleware
 * Authenticates requests using X-API-Key header
 */

const apiKeyService = require('../services/apiKey.service');
const { UnauthorizedError } = require('../utils/errors');

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
    requireApiKey,
    hasPermission
};
