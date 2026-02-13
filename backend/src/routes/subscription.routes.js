const express = require('express');
const subscriptionController = require('../controllers/subscription.controller');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

// Main subscription endpoint
router.get('/:token', rateLimit.subscriptionLimiter, subscriptionController.getSubscription.bind(subscriptionController));

// QR code endpoint
router.get('/:token/qr', rateLimit.subscriptionLimiter, subscriptionController.getQRCode.bind(subscriptionController));

// Per-inbound protocol links with QR codes
router.get('/:token/links', rateLimit.subscriptionLimiter, subscriptionController.getSubscriptionLinks.bind(subscriptionController));

// Clash/ClashMeta config endpoint
router.get('/:token/clash', rateLimit.subscriptionLimiter, subscriptionController.getClash.bind(subscriptionController));

module.exports = router;

