const clientDetector = require('../subscription/utils/client-detector');
const ApiResponse = require('../utils/response');
const mieruManagerService = require('../services/mieruManager.service');

function getRequestOrigin(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
}

function isBrowserRequest(req) {
  const userAgent = String(req.headers['user-agent'] || '');
  const detectedFormat = clientDetector.detect(userAgent);
  const isProxyClient = detectedFormat !== 'v2ray'
    || /(?:clash|singbox|sing-box|sfa|sfi|hiddify|shadowrocket|v2ray|v2rayn|v2rayng|quantumult|surge|stash|wireguard|mieru)/i.test(userAgent);

  return req.accepts('html') && !req.query?.target && !isProxyClient;
}

async function getSubscription(req, res, next) {
  try {
    const { token } = req.params;

    if (isBrowserRequest(req)) {
      return res.redirect(307, `${req.baseUrl}/${token}/page`);
    }

    const exportPayload = await mieruManagerService.getCustomUserExportByToken(token);

    res.setHeader('Content-Type', clientDetector.getContentType('mieru'));
    res.setHeader('Content-Disposition', `inline; filename="mieru-${exportPayload.username}.yaml"`);
    res.setHeader('Profile-Update-Interval', '24');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    return res.send(exportPayload.clashYaml);
  } catch (error) {
    return next(error);
  }
}

async function getInfo(req, res, next) {
  try {
    const info = await mieruManagerService.getCustomUserPublicInfoByToken(req.params.token);
    const origin = getRequestOrigin(req).replace(/\/+$/, '');
    const basePath = `${origin}${req.baseUrl}`;
    const subscriptionUrl = `${basePath}/${info.subscriptionToken}?target=mieru`;
    const pageUrl = `${basePath}/${info.subscriptionToken}/page`;

    res.json(
      ApiResponse.success(
        {
          user: {
            username: info.username,
            enabled: info.enabled,
            quotas: info.quotas || [],
            createdAt: info.createdAt,
            updatedAt: info.updatedAt
          },
          usage: info.usage || null,
          profile: info.profile,
          subscription: {
            url: subscriptionUrl,
            pageUrl
          }
        },
        'Mieru share info fetched successfully'
      )
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSubscription,
  getInfo
};
