const prisma = require('../config/database');
const subscriptionGenerator = require('../subscription/generator');
const clientDetector = require('../subscription/utils/client-detector');
const { buildProtocolUrl } = require('../subscription/formats/url-builder');
const QRCode = require('qrcode');
const metrics = require('../observability/metrics');


class SubscriptionController {
  buildRequestContext(req) {
    return {
      clientIp: req.ip,
      userAgent: req.headers['user-agent'] || '',
      deviceFingerprint:
        req.headers['x-device-fingerprint']
        || req.headers['x-client-fingerprint']
        || req.headers['x-oneui-device-id']
        || '',
      acceptLanguage: req.headers['accept-language'] || '',
      secChUa: req.headers['sec-ch-ua'] || '',
      secChUaPlatform: req.headers['sec-ch-ua-platform'] || '',
      secChUaMobile: req.headers['sec-ch-ua-mobile'] || ''
    };
  }

  recordRequestMetric(format, statusCode) {
    metrics.recordSubscriptionRequest({
      format: String(format || 'unknown').toLowerCase(),
      statusCode
    });
  }

  async getSubscription(req, res, next) {
    const requestedFormat = String(req.query?.target || 'auto').toLowerCase();
    try {
      const { token } = req.params;
      const { target, dl } = req.query;
      const userAgent = req.headers['user-agent'] || '';

      if (!/^[a-f0-9]{64}$/.test(token)) {
        this.recordRequestMetric(requestedFormat, 400);
        return res.status(400).send('Invalid subscription token');
      }

      if (req.accepts('html') && !dl && !target) {
        const protocol = req.secure ? 'https' : 'http';
        const baseUrl = process.env.APP_URL || process.env.SUBSCRIPTION_URL || `${protocol}://${req.get('host')}`;
        return res.redirect(`${baseUrl}/user/${token}`);
      }

      const format = String(target || clientDetector.detect(userAgent)).toLowerCase();
      const { content, user, fileName, branding, format: resolvedFormat } = await subscriptionGenerator.generate(
        token,
        format,
        userAgent,
        this.buildRequestContext(req)
      );

      const contentType = clientDetector.getContentType(resolvedFormat);
      const extension = clientDetector.getFileExtension(resolvedFormat);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename="${fileName || `${user.email}.${extension}`}"`);
      res.setHeader('Profile-Update-Interval', '24');
      res.setHeader(
        'Subscription-Userinfo',
        `upload=${user.upload}; download=${user.download}; total=${user.total}; expire=${user.expire}`
      );
      if (branding?.appName) {
        res.setHeader('X-OneUI-Branding', branding.appName);
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      this.recordRequestMetric(resolvedFormat || format, 200);

      return res.send(content);
    } catch (error) {
      if (
        error.message.includes('not found') ||
        error.message.includes('expired') ||
        error.message.includes('exceeded')
      ) {
        this.recordRequestMetric(requestedFormat, 403);
        return res.status(403).send(error.message);
      }
      if (error.message.includes('Unsupported format')) {
        this.recordRequestMetric(requestedFormat, 400);
        return res.status(400).send(error.message);
      }
      if (error.message.includes('No active') || error.message.includes('WireGuard keys are missing')) {
        this.recordRequestMetric(requestedFormat, 404);
        return res.status(404).send(error.message);
      }
      this.recordRequestMetric(requestedFormat, 500);
      return next(error);
    }
  }

  /**
   * Generate QR code image for subscription link
   */
  async getQRCode(req, res, next) {
    try {
      const { token } = req.params;
      const { size = 256, format = 'png' } = req.query;

      if (!/^[a-f0-9]{64}$/.test(token)) {
        this.recordRequestMetric('qr', 400);
        return res.status(400).send('Invalid subscription token');
      }

      // Build the subscription URL
      const protocol = req.secure ? 'https' : 'http';
      const baseUrl = process.env.APP_URL || `${protocol}://${req.get('host')}`;
      const subscriptionUrl = `${baseUrl}/sub/${token}`;

      const qrSize = Math.min(Math.max(parseInt(size) || 256, 128), 1024);

      if (format === 'svg') {
        const svg = await QRCode.toString(subscriptionUrl, {
          type: 'svg',
          width: qrSize,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
        res.setHeader('Content-Type', 'image/svg+xml');
        this.recordRequestMetric('qr', 200);
        return res.send(svg);
      }

      // Default to PNG
      const buffer = await QRCode.toBuffer(subscriptionUrl, {
        width: qrSize,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      this.recordRequestMetric('qr', 200);
      return res.send(buffer);
    } catch (error) {
      this.recordRequestMetric('qr', 500);
      return next(error);
    }
  }

  async getSubscriptionLinks(req, res, next) {
    try {
      const { token } = req.params;

      if (!/^[a-f0-9]{64}$/.test(token)) {
        return res.status(400).json({ success: false, error: 'Invalid subscription token' });
      }

      const user = await prisma.user.findUnique({
        where: { subscriptionToken: token },
        include: {
          inbounds: {
            where: {
              enabled: true,
              inbound: { enabled: true }
            },
            include: { inbound: true }
          }
        }
      });

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (user.status !== 'ACTIVE') {
        return res.status(403).json({ success: false, error: 'User is not active' });
      }

      const protocol = req.secure ? 'https' : 'http';
      const baseUrl = process.env.APP_URL || process.env.SUBSCRIPTION_URL || `${protocol}://${req.get('host')}`;
      const subscriptionUrl = `${baseUrl}/sub/${token}`;

      const urls = {
        v2ray: `${subscriptionUrl}?target=v2ray`,
        clash: `${subscriptionUrl}?target=clash`,
        singbox: `${subscriptionUrl}?target=singbox`,
        wireguard: `${subscriptionUrl}?target=wireguard`
      };

      const [v2rayQr, clashQr, singboxQr, wireguardQr] = await Promise.all([
        QRCode.toDataURL(urls.v2ray),
        QRCode.toDataURL(urls.clash),
        QRCode.toDataURL(urls.singbox),
        QRCode.toDataURL(urls.wireguard)
      ]);

      const links = (
        await Promise.all(
          user.inbounds.map(async (userInbound) => {
            const inbound = userInbound.inbound;
            const url = buildProtocolUrl(inbound.protocol, user, inbound);
            if (!url) {
              return null;
            }

            const qrCode = await QRCode.toDataURL(url);
            return {
              inboundId: inbound.id,
              remark: inbound.remark || `${user.email}-${inbound.protocol}`,
              protocol: inbound.protocol,
              network: inbound.network,
              security: inbound.security || 'NONE',
              url,
              qrCode
            };
          })
        )
      ).filter(Boolean);

      const totalUsed = Number(user.uploadUsed ?? 0n) + Number(user.downloadUsed ?? 0n);
      const totalLimit = Number(user.dataLimit ?? 0n);
      const usagePercent = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;
      const isDeferredExpiry = Boolean(user.startOnFirstUse) && !user.firstUsedAt;
      const daysRemaining = user.expireDate
        ? isDeferredExpiry
          ? Math.max(
            1,
            Math.ceil((new Date(user.expireDate).getTime() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
          )
          : Math.max(0, Math.ceil((new Date(user.expireDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : null;

      return res.json({
        success: true,
        data: {
          user: {
            email: user.email,
            status: user.status,
            startOnFirstUse: Boolean(user.startOnFirstUse),
            firstUsedAt: user.firstUsedAt,
            daysRemaining,
            usagePercent
          },
          subscription: {
            urls,
            qrCodes: {
              v2ray: v2rayQr,
              clash: clashQr,
              singbox: singboxQr,
              wireguard: wireguardQr
            }
          },
          links,
          shareUrl: `${baseUrl}/user/${token}`
        }
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Generate Clash/ClashMeta YAML configuration
   */
  async getClash(req, res, next) {
    const requestedFormat = req.query?.meta === 'true' ? 'clashmeta' : 'clash';
    try {
      const { token } = req.params;
      const { meta = 'false' } = req.query;

      if (!/^[a-f0-9]{64}$/.test(token)) {
        this.recordRequestMetric(requestedFormat, 400);
        return res.status(400).send('Invalid subscription token');
      }

      const format = meta === 'true' ? 'clashmeta' : 'clash';
      const { content, user, fileName, branding } = await subscriptionGenerator.generate(
        token,
        format,
        req.headers['user-agent'] || '',
        this.buildRequestContext(req)
      );

      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${fileName || `${user.email}.yaml`}"`);
      res.setHeader('Profile-Update-Interval', '24');
      res.setHeader(
        'Subscription-Userinfo',
        `upload=${user.upload}; download=${user.download}; total=${user.total}; expire=${user.expire}`
      );
      if (branding?.appName) {
        res.setHeader('X-OneUI-Branding', branding.appName);
      }
      this.recordRequestMetric(format, 200);

      return res.send(content);
    } catch (error) {
      if (
        error.message.includes('not found') ||
        error.message.includes('expired') ||
        error.message.includes('exceeded')
      ) {
        this.recordRequestMetric(requestedFormat, 403);
        return res.status(403).send(error.message);
      }
      this.recordRequestMetric(requestedFormat, 500);
      return next(error);
    }
  }
}

module.exports = new SubscriptionController();
