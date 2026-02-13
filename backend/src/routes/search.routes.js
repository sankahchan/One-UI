const express = require('express');
const { authenticate } = require('../middleware/auth');
const searchService = require('../services/search.service');
const { query } = require('express-validator');
const validate = require('../middleware/validator');
const ApiResponse = require('../utils/response');

const router = express.Router();

/**
 * @route GET /api/search
 * @desc Search across users and inbounds
 * @access Private
 */
router.get(
    '/',
    authenticate,
    [
        query('q').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Query must be 2-100 characters'),
        query('type').optional().isIn(['all', 'users', 'inbounds', 'groups']).withMessage('Type must be all, users, inbounds, or groups'),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt()
    ],
    validate,
    async (req, res, next) => {
        try {
            const { q, type = 'all', limit = 10 } = req.query;
            const results = await searchService.search(q, { type, limit });
            res.json(ApiResponse.success(results, 'Search completed'));
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route GET /api/search/quick
 * @desc Quick search for autocomplete
 * @access Private
 */
router.get(
    '/quick',
    authenticate,
    [
        query('q').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Query must be 2-100 characters')
    ],
    validate,
    async (req, res, next) => {
        try {
            const { q } = req.query;
            const results = await searchService.quickSearch(q);
            res.json(ApiResponse.success(results, 'Quick search completed'));
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;
