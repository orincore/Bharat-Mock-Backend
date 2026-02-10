const express = require('express');
const router = express.Router();
const { publicAbout } = require('../controllers/aboutController');

router.get('/', publicAbout);

module.exports = router;
