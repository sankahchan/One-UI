const { createLogger, format, transports } = require('winston');
const env = require('./env');

const logger = createLogger({
  level: env.LOG_LEVEL,
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'xray-panel-backend' },
  transports: [
    new transports.Console({
      format:
        env.NODE_ENV === 'development'
          ? format.combine(format.colorize(), format.timestamp(), format.simple())
          : format.combine(format.timestamp(), format.json())
    })
  ]
});

module.exports = logger;
