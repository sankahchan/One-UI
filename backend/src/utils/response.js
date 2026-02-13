function toJSONSafe(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJSONSafe(entry));
  }

  if (value instanceof Date || value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'object') {
    const output = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = toJSONSafe(nestedValue);
    }

    return output;
  }

  return value;
}

class ApiResponse {
  static success(data = null, message = 'Success', meta = {}) {
    return {
      success: true,
      message,
      data: toJSONSafe(data),
      ...toJSONSafe(meta)
    };
  }

  static error(message = 'Error', code = 'ERROR', details = null) {
    return {
      success: false,
      error: {
        message,
        code,
        details: toJSONSafe(details)
      }
    };
  }

  static paginated(data, pagination) {
    return {
      success: true,
      data: toJSONSafe(data),
      pagination: toJSONSafe(pagination)
    };
  }

  static sendSuccess(res, { statusCode = 200, message = 'Success', data = null, meta = null } = {}) {
    const extraMeta = meta ? { meta } : {};
    return res.status(statusCode).json(ApiResponse.success(data, message, extraMeta));
  }
}

module.exports = ApiResponse;
module.exports.sendSuccess = ApiResponse.sendSuccess;
