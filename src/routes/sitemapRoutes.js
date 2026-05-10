const express = require('express');
const router = express.Router();
const sitemapController = require('../controllers/sitemapController');

// Optimized sitemap endpoint - returns all data needed for sitemap in one call
router.get('/', sitemapController.getSitemapData);

module.exports = router;
