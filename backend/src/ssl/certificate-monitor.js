const cron = require('node-cron');
const fs = require('fs/promises');
const { X509Certificate } = require('crypto');

const env = require('../config/env');
const logger = require('../config/logger');
const acmeManager = require('./acme-manager');
const { getBotManager } = require('../telegram/bot');

function resolveCertFile(certPath = env.SSL_CERT_PATH) {
  const ext = certPath ? certPath.toLowerCase() : '';
  if (ext.endsWith('.pem') || ext.endsWith('.crt') || ext.endsWith('.cer')) {
    return certPath;
  }

  return `${certPath}/fullchain.pem`;
}

class CertificateMonitor {
  async sendTelegramAlert(message) {
    const botManager = getBotManager();
    if (!botManager?.enabled || typeof botManager.sendAlert !== 'function') {
      logger.info('Telegram bot unavailable; SSL alert not sent');
      return false;
    }

    await botManager.sendAlert(message);
    return true;
  }

  async runDailyCheck() {
    logger.info('Checking SSL certificate...');

    const domain = env.SSL_DOMAIN || process.env.SSL_DOMAIN;
    if (!domain) {
      return {
        skipped: true,
        reason: 'SSL domain not configured'
      };
    }

    try {
      const certInfo = await acmeManager.getCertificateInfo(domain);
      if (!certInfo) {
        logger.warn('Could not get certificate info');
        return {
          skipped: true,
          reason: 'Certificate info unavailable'
        };
      }

      logger.info(`Certificate expires in ${certInfo.daysRemaining} days`);

      if (certInfo.daysRemaining < env.SSL_RENEW_DAYS) {
        logger.info('Certificate needs renewal');
        await acmeManager.renew(domain);

        const renewedInfo = await acmeManager.getCertificateInfo(domain);
        const validUntil = renewedInfo?.notAfter || certInfo.notAfter;

        await this.sendTelegramAlert(
          `SSL certificate renewed successfully\nValid until: ${new Date(validUntil).toLocaleDateString()}`
        );

        return {
          renewed: true,
          domain,
          previous: certInfo,
          current: renewedInfo || certInfo
        };
      }

      return {
        renewed: false,
        domain,
        status: certInfo
      };
    } catch (error) {
      logger.error('Certificate check failed', {
        message: error.message,
        stack: error.stack
      });

      await this.sendTelegramAlert(`SSL certificate check failed: ${error.message}`);
      throw error;
    }
  }

  start(schedule = '0 2 * * *') {
    if (!cron.validate(schedule)) {
      logger.warn('Invalid certificate monitor cron schedule', { schedule });
      return null;
    }

    logger.info('Starting certificate monitor schedule', { schedule });
    return cron.schedule(schedule, async () => {
      try {
        await this.runDailyCheck();
      } catch (error) {
        logger.error('Scheduled certificate check failed', {
          message: error.message,
          stack: error.stack
        });
      }
    });
  }

  async getCertificateStatus(certPath = env.SSL_CERT_PATH) {
    const certFile = resolveCertFile(certPath);

    try {
      const pem = await fs.readFile(certFile, 'utf8');
      const certificate = new X509Certificate(pem);

      const expiresAt = new Date(certificate.validTo);
      const validFrom = new Date(certificate.validFrom);
      const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      return {
        exists: true,
        certPath: certFile,
        validFrom,
        expiresAt,
        daysRemaining,
        isExpiringSoon: daysRemaining <= env.SSL_RENEW_DAYS
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          exists: false,
          certPath: certFile,
          daysRemaining: 0,
          isExpiringSoon: true
        };
      }

      throw error;
    }
  }

  async ensureValidCertificate({
    domain = env.SSL_DOMAIN,
    renewThresholdDays = env.SSL_RENEW_DAYS
  } = {}) {
    const status = await this.getCertificateStatus();

    if (!domain) {
      return {
        renewed: false,
        reason: 'SSL domain not configured',
        status
      };
    }

    if (status.exists && status.daysRemaining > renewThresholdDays) {
      return {
        renewed: false,
        reason: 'Certificate is healthy',
        status
      };
    }

    logger.info('Certificate renewal triggered', {
      exists: status.exists,
      daysRemaining: status.daysRemaining,
      domain
    });

    if (!status.exists) {
      await acmeManager.issueWildcardCertificate(domain);
    } else {
      await acmeManager.renewCertificate(domain);
    }

    await acmeManager.installCertificate({ domain });

    const updatedStatus = await this.getCertificateStatus();

    return {
      renewed: true,
      reason: 'Certificate renewed',
      status: updatedStatus
    };
  }
}

module.exports = new CertificateMonitor();
