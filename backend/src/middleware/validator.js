const { validationResult } = require('express-validator');
const { ValidationError } = require('../utils/errors');

function validate(req, _res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return next(new ValidationError('Validation failed', errors.array()));
  }

  return next();
}

module.exports = validate;
module.exports.validate = validate;
