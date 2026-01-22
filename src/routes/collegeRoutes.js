const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const collegeController = require('../controllers/collegeController');
const validate = require('../middleware/validation');

router.get('/', collegeController.getColleges);

router.get('/:id',
  [
    param('id').isUUID().withMessage('Valid college ID required'),
    validate
  ],
  collegeController.getCollegeById
);

module.exports = router;
