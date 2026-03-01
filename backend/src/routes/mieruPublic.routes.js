const express = require('express');

const mieruPublicController = require('../controllers/mieruPublic.controller');

const router = express.Router();

router.get('/:token/info', mieruPublicController.getInfo);
router.get('/:token', mieruPublicController.getSubscription);

module.exports = router;
