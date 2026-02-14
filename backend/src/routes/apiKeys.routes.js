const express = require('express');
const { authenticate, requireBearerAuth } = require('../middleware/auth');
const apiKeyService = require('../services/apiKey.service');
const { body } = require('express-validator');
const validate = require('../middleware/validator');
const ApiResponse = require('../utils/response');

const router = express.Router();

// All routes require authentication
router.use(requireBearerAuth, authenticate);

/**
 * @route GET /api/api-keys
 * @desc List all API keys for current admin
 * @access Private
 */
router.get('/', async (req, res, next) => {
    try {
        const adminId = req.admin.role === 'SUPER_ADMIN' ? null : req.admin.id;
        const keys = await apiKeyService.list(adminId);
        res.json(ApiResponse.success(keys, 'API keys retrieved'));
    } catch (error) {
        next(error);
    }
});

/**
 * @route POST /api/api-keys
 * @desc Create a new API key
 * @access Private
 */
router.post(
    '/',
    [
        body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Name is required'),
        body('permissions').optional().isArray().withMessage('Permissions must be an array'),
        body('expiresAt').optional().isISO8601().toDate().withMessage('Invalid expiration date')
    ],
    validate,
    async (req, res, next) => {
        try {
            const { name, permissions = [], expiresAt } = req.body;

            const apiKey = await apiKeyService.create({
                adminId: req.admin.id,
                name,
                permissions,
                expiresAt
            });

            res.status(201).json(ApiResponse.success(apiKey, 'API key created'));
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route DELETE /api/api-keys/:id
 * @desc Revoke an API key
 * @access Private
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        const adminId = req.admin.role === 'SUPER_ADMIN' ? null : req.admin.id;

        await apiKeyService.revoke(id, adminId);
        res.json(ApiResponse.success(null, 'API key revoked'));
    } catch (error) {
        next(error);
    }
});

module.exports = router;
