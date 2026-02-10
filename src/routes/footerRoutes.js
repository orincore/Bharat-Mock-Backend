const express = require('express');
const router = express.Router();
const { getFooterLinks } = require('../controllers/footerController');

router.get('/', getFooterLinks);

module.exports = router;
