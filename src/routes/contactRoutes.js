const express = require('express');
const router = express.Router();
const { publicContact } = require('../controllers/contactController');

router.get('/', publicContact);

module.exports = router;
