/**
 * Public User Info Routes
 * Provides public endpoints for users to view their subscription info
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const QRCode = require('qrcode');
const subscriptionBrandingService = require('../services/subscriptionBranding.service');

const prisma = new PrismaClient();
const router = express.Router();

/**
 * Get user info by subscription token (public endpoint)
 * GET /user/:token/info
 */
router.get('/:token/info', async (req, res, next) => {
    try {
        const { token } = req.params;

        if (!/^[a-f0-9]{64}$/.test(token)) {
            return res.status(400).json({ error: 'Invalid token format' });
        }

        const user = await prisma.user.findUnique({
            where: { subscriptionToken: token },
            include: {
                inbounds: {
                    where: { enabled: true },
                    include: {
                        inbound: {
                            select: {
                                id: true,
                                tag: true,
                                remark: true,
                                protocol: true,
                                port: true,
                                network: true,
                                security: true
                            }
                        }
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const branding = await subscriptionBrandingService.resolveEffectiveBrandingForUser(user.id);

        // Calculate usage stats
        const uploadUsed = Number(user.uploadUsed);
        const downloadUsed = Number(user.downloadUsed);
        const totalUsed = uploadUsed + downloadUsed;
        const dataLimit = Number(user.dataLimit);
        const remainingData = dataLimit > 0 ? Math.max(0, dataLimit - totalUsed) : -1;
        const usagePercent = dataLimit > 0 ? Math.min(100, (totalUsed / dataLimit) * 100) : 0;

        // Calculate days remaining
        const now = new Date();
        const expireDate = new Date(user.expireDate);
        const daysRemaining = Math.max(0, Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24)));

        // Build subscription URL
        const protocol = req.secure ? 'https' : 'http';
        const baseUrl = process.env.APP_URL || `${protocol}://${req.get('host')}`;
        const subscriptionUrl = `${baseUrl}/sub/${token}`;

        // Prepare inbound list
        const inbounds = user.inbounds
            .filter(ui => ui.inbound)
            .map(ui => ({
                id: ui.inbound.id,
                tag: ui.inbound.tag,
                remark: ui.inbound.remark,
                protocol: ui.inbound.protocol,
                port: ui.inbound.port,
                network: ui.inbound.network,
                security: ui.inbound.security
            }));

        return res.json({
            success: true,
            data: {
                email: user.email,
                status: user.status,
                usage: {
                    upload: uploadUsed,
                    download: downloadUsed,
                    total: totalUsed,
                    limit: dataLimit,
                    remaining: remainingData,
                    percent: Math.round(usagePercent * 100) / 100
                },
                expiry: {
                    date: user.expireDate,
                    daysRemaining
                },
                subscription: {
                    url: subscriptionUrl,
                    clashUrl: `${subscriptionUrl}/clash`,
                    qrUrl: `${subscriptionUrl}/qr`
                },
                inbounds,
                trafficResetPeriod: user.trafficResetPeriod || 'NEVER',
                lastTrafficReset: user.lastTrafficReset,
                branding: branding ? {
                    appName: branding.appName || 'One-UI',
                    logoUrl: branding.logoUrl || null,
                    primaryColor: branding.primaryColor || null,
                    accentColor: branding.accentColor || null,
                    profileTitle: branding.profileTitle || null,
                    profileDescription: branding.profileDescription || null,
                    supportUrl: branding.supportUrl || null,
                    customFooter: branding.customFooter || null
                } : null
            }
        });
    } catch (error) {
        return next(error);
    }
});

/**
 * Get user usage stats only (lightweight endpoint)
 * GET /user/:token/usage
 */
router.get('/:token/usage', async (req, res, next) => {
    try {
        const { token } = req.params;

        if (!/^[a-f0-9]{64}$/.test(token)) {
            return res.status(400).json({ error: 'Invalid token format' });
        }

        const user = await prisma.user.findUnique({
            where: { subscriptionToken: token },
            select: {
                uploadUsed: true,
                downloadUsed: true,
                dataLimit: true,
                expireDate: true,
                status: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const totalUsed = Number(user.uploadUsed) + Number(user.downloadUsed);
        const dataLimit = Number(user.dataLimit);

        return res.json({
            upload: Number(user.uploadUsed),
            download: Number(user.downloadUsed),
            total: totalUsed,
            limit: dataLimit,
            percent: dataLimit > 0 ? Math.round((totalUsed / dataLimit) * 10000) / 100 : 0,
            expireDate: user.expireDate,
            status: user.status
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
