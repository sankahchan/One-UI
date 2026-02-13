const env = require('../config/env');
const logger = require('../config/logger');
const certificateMonitor = require('../ssl/certificate-monitor');
const alerts = require('../telegram/notifications/alerts');

async function runSslRenew() {
  if (!env.SSL_ENABLED) {
    return {
      skipped: true,
      reason: 'SSL automation disabled'
    };
  }

  try {
    const result = await certificateMonitor.ensureValidCertificate({
      domain: env.SSL_DOMAIN,
      renewThresholdDays: env.SSL_RENEW_DAYS
    });

    if (result.renewed) {
      await alerts.sendAlert(`SSL certificate renewed successfully for ${env.SSL_DOMAIN}`, 'INFO');
    }

    logger.info('SSL renew job completed', result);
    return result;
  } catch (error) {
    logger.error('SSL renew job failed', {
      message: error.message,
      stack: error.stack
    });

    await alerts.sendAlert(`SSL renew job failed: ${error.message}`, 'CRITICAL');
    throw error;
  }
}

module.exports = {
  runSslRenew
};
