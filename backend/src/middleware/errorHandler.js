const logger = require('../config/logger');
const ApiResponse = require('../utils/response');

const errorHandler = (err, req, res, _next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  if (err.code === 'P2002') {
    const field = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target || null;

    return res.status(409).json(
      ApiResponse.error('Resource already exists', 'DUPLICATE_ERROR', {
        field
      })
    );
  }

  if (err.code === 'P2025') {
    return res.status(404).json(ApiResponse.error('Resource not found', 'NOT_FOUND'));
  }

  if (err.name === 'ValidationError') {
    return res
      .status(err.statusCode || 422)
      .json(ApiResponse.error(err.message, 'VALIDATION_ERROR', err.errors || err.details || null));
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(err.statusCode || 401).json(ApiResponse.error(err.message, 'UNAUTHORIZED'));
  }

  if (err.name === 'NotFoundError') {
    return res.status(err.statusCode || 404).json(ApiResponse.error(err.message, 'NOT_FOUND'));
  }

  if (err.name === 'ConflictError') {
    return res.status(err.statusCode || 409).json(ApiResponse.error(err.message, 'CONFLICT'));
  }

  if (err.name === 'ForbiddenError') {
    return res.status(err.statusCode || 403).json(ApiResponse.error(err.message, 'FORBIDDEN'));
  }

  return res
    .status(err.status || err.statusCode || 500)
    .json(
      ApiResponse.error(
        process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        'INTERNAL_ERROR'
      )
    );
};

module.exports = errorHandler;
