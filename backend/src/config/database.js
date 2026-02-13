const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const logger = require('./logger');
const metrics = require('../observability/metrics');

const prismaLogConfig = [
  { emit: 'event', level: 'query' },
  { emit: 'event', level: 'error' }
];

if (env.NODE_ENV === 'development') {
  prismaLogConfig.splice(1, 0, { emit: 'event', level: 'info' }, { emit: 'event', level: 'warn' });
}

const prisma = new PrismaClient({ log: prismaLogConfig });

prisma.$on('query', (event) => {
  metrics.recordDbQuery(event.duration, event.query);

  if (env.NODE_ENV === 'development') {
    logger.debug('Prisma query', {
      query: event.query,
      params: event.params,
      durationMs: event.duration
    });
  }
});

if (env.NODE_ENV === 'development') {
  prisma.$on('info', (event) => {
    logger.info(event.message, { target: event.target });
  });

  prisma.$on('warn', (event) => {
    logger.warn(event.message, { target: event.target });
  });
}

prisma.$on('error', (event) => {
  metrics.recordDbQueryError(event.target);
  logger.error(event.message, { target: event.target });
});

module.exports = prisma;
