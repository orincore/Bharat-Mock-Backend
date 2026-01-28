const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validation');
const passport = require('../config/passport');

router.post('/register',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
    validate
  ],
  authController.register
);

router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  authController.login
);

router.get('/profile', authenticate, authController.getProfile);

router.put('/profile',
  authenticate,
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
    body('date_of_birth').optional().isISO8601().withMessage('Valid date required'),
    validate
  ],
  authController.updateProfile
);

router.post('/forgot-password',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    validate
  ],
  authController.forgotPassword
);

router.post('/reset-password',
  [
    body('token').isLength({ min: 6, max: 6 }).withMessage('A valid 6-digit code is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate
  ],
  authController.resetPassword
);

router.post('/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
    validate
  ],
  authController.changePassword
);

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login?error=oauth_failed` }),
  authController.googleCallback
);

router.post('/onboarding',
  authenticate,
  [
    body('phone')
      .matches(/^\+?[1-9]\d{7,14}$/)
      .withMessage('Valid phone number required'),
    body('date_of_birth').isISO8601().withMessage('Valid date required'),
    body('interested_categories').isArray({ min: 1 }).withMessage('At least one category must be selected'),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate
  ],
  authController.completeOnboarding
);

module.exports = router;
