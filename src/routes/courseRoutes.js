const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const courseController = require('../controllers/courseController');
const validate = require('../middleware/validation');

router.get('/', courseController.getCourses);

router.get('/:id',
  [
    param('id').isUUID().withMessage('Valid course ID required'),
    validate
  ],
  courseController.getCourseById
);

module.exports = router;
