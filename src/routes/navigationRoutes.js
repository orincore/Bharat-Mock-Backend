const express = require('express');
const router = express.Router();
const navigationController = require('../controllers/navigationController');

router.get('/', navigationController.getNavigationLinks);

module.exports = router;
