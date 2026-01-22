const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const articleController = require('../controllers/articleController');
const validate = require('../middleware/validation');

router.get('/', articleController.getArticles);

router.get('/categories', articleController.getArticleCategories);

router.get('/tags', articleController.getPopularTags);

router.get('/:slug',
  [
    param('slug').notEmpty().withMessage('Valid article slug required'),
    validate
  ],
  articleController.getArticleBySlug
);

module.exports = router;
