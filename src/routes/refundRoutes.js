const express = require('express');
const router = express.Router();
const { publicRefundPolicy } = require('../controllers/refundController');

router.get('/', publicRefundPolicy);

module.exports = router;