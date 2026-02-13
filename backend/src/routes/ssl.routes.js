const express = require('express');

const { authenticate, authorize } = require('../middleware/auth');
const ApiResponse = require('../utils/response');
const acmeManager = require('../ssl/acme-manager');

const router = express.Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.post('/install', async (_req, res, next) => {
  try {
    await acmeManager.install();
    res.json(ApiResponse.success({ message: 'acme.sh installed successfully' }));
  } catch (error) {
    next(error);
  }
});

router.post('/issue', async (req, res, next) => {
  try {
    const { domain, cloudflareEmail, cloudflareApiKey } = req.body || {};

    if (!domain || !cloudflareEmail || !cloudflareApiKey) {
      return res.status(400).json(ApiResponse.error('Missing required fields', 'VALIDATION_ERROR'));
    }

    await acmeManager.issueWildcard(domain, cloudflareEmail, cloudflareApiKey);

    res.json(
      ApiResponse.success({
        message: 'Certificate issued successfully',
        domain
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post('/renew', async (req, res, next) => {
  try {
    const { domain } = req.body || {};

    if (!domain) {
      return res.status(400).json(ApiResponse.error('Domain is required', 'VALIDATION_ERROR'));
    }

    await acmeManager.renew(domain);

    res.json(
      ApiResponse.success({
        message: 'Certificate renewed successfully',
        domain
      })
    );
  } catch (error) {
    next(error);
  }
});

router.get('/info', async (_req, res, next) => {
  try {
    const domain = process.env.SSL_DOMAIN;

    if (!domain) {
      return res.json(
        ApiResponse.success({
          enabled: false,
          message: 'SSL not configured'
        })
      );
    }

    const certInfo = await acmeManager.getCertificateInfo(domain);
    res.json(
      ApiResponse.success({
        enabled: true,
        domain,
        ...(certInfo || {})
      })
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;
