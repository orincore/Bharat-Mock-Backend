const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const subscriptionController = require('../controllers/subscriptionController');

// Public endpoints
router.get('/plans', subscriptionController.getPlans);

// Authenticated user endpoints
router.post('/checkout/start', authenticate, subscriptionController.startSubscriptionCheckout);
router.post('/checkout/confirm', authenticate, subscriptionController.confirmSubscriptionPayment);
router.post('/auto-renew', authenticate, subscriptionController.toggleAutoRenew);

// Admin plan management
router.get(
  '/admin/plans',
  authenticate,
  requireAdmin,
  subscriptionController.adminListPlans
);
router.post(
  '/admin/plans',
  authenticate,
  requireAdmin,
  subscriptionController.adminCreatePlan
);
router.put(
  '/admin/plans/:planId',
  authenticate,
  requireAdmin,
  subscriptionController.adminUpdatePlan
);
router.patch(
  '/admin/plans/:planId/toggle',
  authenticate,
  requireAdmin,
  subscriptionController.adminTogglePlan
);

// Admin promo management
router.get(
  '/admin/promocodes',
  authenticate,
  requireAdmin,
  subscriptionController.adminListPromocodes
);
router.post(
  '/admin/promocodes',
  authenticate,
  requireAdmin,
  subscriptionController.adminCreatePromocode
);
router.put(
  '/admin/promocodes/:promoId',
  authenticate,
  requireAdmin,
  subscriptionController.adminUpdatePromocode
);

// Admin subscription transactions
router.get(
  '/admin/transactions',
  authenticate,
  requireAdmin,
  subscriptionController.adminListTransactions
);

module.exports = router;
