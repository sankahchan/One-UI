const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const marzbanService = require('../services/marzban.service');
const marzbanErrorHandler = require('../middleware/marzbanErrorHandler');

const router = Router();

// Secure these routes for administrators only
router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

// GET /api/users
router.get('/', async (req, res, next) => {
    try {
        const { status, search, limit = 100, offset = 0 } = req.query;
        const params = { limit, offset };

        // Pass query params down if they exist
        if (status) params.status = status.toLowerCase();
        if (search) params.username = search;

        const data = await marzbanService.marzbanFetch('/api/users', { params });

        // Transform Marzban payload structure natively to One-UI expected structure if necessary
        // Because this acts as a direct proxy adapter according to instructions, we return: { users: Object[], total: number }
        return res.status(200).json({
            success: true,
            users: data.users || [],
            total: data.total || 0
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/users
router.post('/', async (req, res, next) => {
    try {
        const { username, dataLimitGB, expireDays, protocols, note } = req.body;

        // Convert One-UI constraints directly into Marzban API constraints
        // Math.floor(Date.now() / 1000) converts JS ms to UNIX seconds
        let expireValue = null;
        if (expireDays && expireDays > 0) {
            expireValue = Math.floor(Date.now() / 1000) + (expireDays * 86400);
        }

        let dataLimitBytes = 0;
        if (dataLimitGB && dataLimitGB > 0) {
            dataLimitBytes = dataLimitGB * 1073741824; // 1 GB in Bytes
        }

        const marzbanPayload = {
            username,
            proxies: { vless: { flow: "" } }, // Always include vless default per instructions
            inbounds: {}, // Empty means all inbounds
            data_limit: dataLimitBytes,
            expire: expireValue,
            data_limit_reset_strategy: "no_reset",
            note: note || ""
        };

        const data = await marzbanService.marzbanFetch('/api/user', {
            method: 'POST',
            data: marzbanPayload
        });

        return res.status(201).json({
            success: true,
            user: data,
            message: 'User created successfully'
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/users/:username
router.get('/:username', async (req, res, next) => {
    try {
        const { username } = req.params;
        const data = await marzbanService.marzbanFetch(`/api/user/${encodeURIComponent(username)}`, {
            method: 'GET'
        });

        return res.status(200).json({
            success: true,
            user: data
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/users/:username
router.put('/:username', async (req, res, next) => {
    try {
        const { username } = req.params;
        const { dataLimitGB, expireDays, status, note } = req.body;

        const marzbanPayload = {};
        if (typeof note !== 'undefined') marzbanPayload.note = note;
        if (typeof status !== 'undefined') marzbanPayload.status = status;

        if (typeof expireDays !== 'undefined') {
            if (expireDays > 0) {
                marzbanPayload.expire = Math.floor(Date.now() / 1000) + (expireDays * 86400);
            } else {
                marzbanPayload.expire = null; // Infinite
            }
        }

        if (typeof dataLimitGB !== 'undefined') {
            marzbanPayload.data_limit = dataLimitGB > 0 ? dataLimitGB * 1073741824 : 0;
        }

        const data = await marzbanService.marzbanFetch(`/api/user/${encodeURIComponent(username)}`, {
            method: 'PUT',
            data: marzbanPayload
        });

        return res.status(200).json({
            success: true,
            user: data,
            message: 'User updated successfully'
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/users/:username
router.delete('/:username', async (req, res, next) => {
    try {
        const { username } = req.params;
        await marzbanService.marzbanFetch(`/api/user/${encodeURIComponent(username)}`, {
            method: 'DELETE'
        });

        return res.status(200).json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/users/:username/reset-traffic
router.post('/:username/reset-traffic', async (req, res, next) => {
    try {
        const { username } = req.params;
        const data = await marzbanService.marzbanFetch(`/api/user/${encodeURIComponent(username)}/reset`, {
            method: 'POST'
        });

        return res.status(200).json({
            success: true,
            user: data,
            message: 'User traffic reset successfully'
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/users/:username/revoke-subscription
router.post('/:username/revoke-subscription', async (req, res, next) => {
    try {
        const { username } = req.params;
        const data = await marzbanService.marzbanFetch(`/api/user/${encodeURIComponent(username)}/revoke_sub`, {
            method: 'POST'
        });

        return res.status(200).json({
            success: true,
            user: data,
            message: 'User subscription URL successfully revoked/regenerated'
        });
    } catch (error) {
        next(error);
    }
});

router.use(marzbanErrorHandler);

module.exports = router;
