const logger = require('../config/logger');

const marzbanErrorHandler = (err, req, res, next) => {
    // If the error comes from our Axios interceptor, it has `response` or `request` properties
    const isAxiosError = err.isAxiosError || !!err.response;

    if (isAxiosError) {
        const status = err.response?.status || 503;
        let message = err.message;

        if (status === 409) {
            message = 'Username already exists';
        } else if (status === 422) {
            // Marzban usually returns validation context in body
            const detail = err.response?.data?.detail;
            message = typeof detail === 'string' ? detail : (JSON.stringify(detail) || 'Validation error');
        } else if (status === 404) {
            message = 'User not found';
        } else if (status === 503 || !err.response) {
            message = 'Cannot connect to Marzban core — check if it is running';
        } else if (err.response?.data?.detail) {
            message = String(err.response.data.detail);
        } else if (err.response?.data?.message) {
            message = String(err.response.data.message);
        }

        logger.warn('Marzban proxy error handled natively', { status, path: req.path, message });

        return res.status(status).json({
            error: true,
            message,
            code: status
        });
    }

    // Fallback to exactly formatting the object
    const fallbackStatus = err.status || err.statusCode || 500;
    return res.status(fallbackStatus).json({
        error: true,
        message: err.message || 'Internal server error',
        code: fallbackStatus
    });
};

module.exports = marzbanErrorHandler;
