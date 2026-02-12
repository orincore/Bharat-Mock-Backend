const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { getAppInit } = require('../controllers/initController');

router.get('/', optionalAuth, getAppInit);

module.exports = router;
