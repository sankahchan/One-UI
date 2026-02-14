const express = require('express');
const QRCode = require('qrcode');

const prisma = require('../config/database');
const ApiResponse = require('../utils/response');

const router = express.Router();

const portalAuth = async (req, res, next) => {
  try {
    const token = req.headers['x-subscription-token'];

    if (!token || typeof token !== 'string') {
      return res.status(401).json(ApiResponse.error('Subscription token required', 'UNAUTHORIZED'));
    }

    const user = await prisma.user.findUnique({
      where: { subscriptionToken: token }
    });

    if (!user) {
      return res.status(401).json(ApiResponse.error('Invalid subscription token', 'UNAUTHORIZED'));
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

router.get('/me', portalAuth, async (req, res, next) => {
  try {
    const user = req.user;
    const totalUsed = user.uploadUsed + user.downloadUsed;
    const remaining = user.dataLimit - totalUsed;
    const remainingPercent = user.dataLimit > 0n ? Number((remaining * 10000n) / user.dataLimit) / 100 : 0;
    const isDeferredExpiry = Boolean(user.startOnFirstUse) && !user.firstUsedAt;
    const daysRemaining = isDeferredExpiry
      ? Math.max(1, Math.ceil((new Date(user.expireDate).getTime() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)))
      : Math.ceil((new Date(user.expireDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    return res.json(
      ApiResponse.success({
        email: user.email,
        status: user.status,
        uploadUsed: user.uploadUsed,
        downloadUsed: user.downloadUsed,
        totalUsed,
        dataLimit: user.dataLimit,
        remaining,
        remainingPercent,
        startOnFirstUse: Boolean(user.startOnFirstUse),
        firstUsedAt: user.firstUsedAt,
        expireDate: user.expireDate,
        daysRemaining
      })
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/subscription', portalAuth, async (req, res, next) => {
  try {
    const user = req.user;
    const baseUrl = process.env.SUBSCRIPTION_URL || `${req.protocol}://${req.get('host')}`;
    const subscriptionUrl = `${baseUrl}/sub/${user.subscriptionToken}`;

    const [v2rayQr, clashQr, singboxQr, wireguardQr] = await Promise.all([
      QRCode.toDataURL(`${subscriptionUrl}?target=v2ray`),
      QRCode.toDataURL(`${subscriptionUrl}?target=clash`),
      QRCode.toDataURL(`${subscriptionUrl}?target=singbox`),
      QRCode.toDataURL(`${subscriptionUrl}?target=wireguard`)
    ]);

    return res.json(
      ApiResponse.success({
        urls: {
          v2ray: `${subscriptionUrl}?target=v2ray`,
          clash: `${subscriptionUrl}?target=clash`,
          singbox: `${subscriptionUrl}?target=singbox`,
          wireguard: `${subscriptionUrl}?target=wireguard`
        },
        qrCodes: {
          v2ray: v2rayQr,
          clash: clashQr,
          singbox: singboxQr,
          wireguard: wireguardQr
        }
      })
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/traffic', portalAuth, async (req, res, next) => {
  try {
    const user = req.user;
    const rawDays = Number.parseInt(req.query.days, 10);
    const days = Number.isInteger(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await prisma.trafficLog.findMany({
      where: {
        userId: user.id,
        timestamp: {
          gte: startDate
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    return res.json(ApiResponse.success(logs));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
