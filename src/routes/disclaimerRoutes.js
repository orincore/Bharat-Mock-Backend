const express = require('express');
const router = express.Router();
const { publicDisclaimer } = require('../controllers/disclaimerController');

router.get('/', publicDisclaimer);

module.exports = router;
