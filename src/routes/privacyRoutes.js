const express = require('express');
const router = express.Router();
const { publicPrivacyPolicy } = require('../controllers/privacyController');

router.get('/', publicPrivacyPolicy);

module.exports = router;
