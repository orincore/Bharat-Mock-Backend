const logger = require('../config/logger');
const {
  listPlans,
  createPlan,
  updatePlan,
  togglePlan,
  listPromocodes,
  createPromocode,
  updatePromocode,
  listSubscriptionTransactions,
  getPlanById,
  getPromocodeByCode,
  createPendingSubscription,
  getPendingSubscriptionByOrder,
  markSubscriptionActive,
  updateUserPremiumState,
  incrementPromocodeUsage,
  getLatestSubscriptionForUser,
  updateSubscriptionAutoRenew,
  updateUserAutoRenewFlag,
  cancelSubscription: cancelSubscriptionRecord
} = require('../services/subscriptionService');
const { createOrder, verifySignature, isConfigured } = require('../services/razorpayService');
const {
  sendSubscriptionActivatedEmail,
  sendAutoRenewStatusEmail,
  sendSubscriptionCancelledEmail
} = require('../utils/emailService');

const parseFeatures = (features) => {
  if (!features) return [];
  if (Array.isArray(features)) return features;
  if (typeof features === 'string') {
    return features
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
};

const validatePromocodeForPlan = ({ promo, planId, autoRenew }) => {
  const now = new Date();

  if (!promo) {
    return { valid: false, message: 'Promo code not found' };
  }

  if (promo.start_at && new Date(promo.start_at) > now) {
    return { valid: false, message: 'Promo code is not active yet' };
  }

  if (promo.end_at && new Date(promo.end_at) < now) {
    return { valid: false, message: 'Promo code has expired' };
  }

  if (promo.max_redemptions && promo.redemptions_count >= promo.max_redemptions) {
    return { valid: false, message: 'Promo code usage limit reached' };
  }

  if (promo.applicable_plan_ids?.length && !promo.applicable_plan_ids.includes(planId)) {
    return { valid: false, message: 'Promo code not applicable for this plan' };
  }

  if (promo.auto_renew_only && !autoRenew) {
    return { valid: false, message: 'Promo code requires auto renew to be enabled' };
  }

  return { valid: true };
};

const applyDiscount = (amountCents, promo) => {
  if (!promo) return amountCents;

  if (promo.discount_type === 'percent') {
    const discount = Math.floor((amountCents * promo.discount_value) / 100);
    return Math.max(100, amountCents - discount);
  }

  const fixedDiscount = promo.discount_value * 100;
  return Math.max(100, amountCents - fixedDiscount);
};

const getPlans = async (req, res) => {
  try {
    const plans = await listPlans();
    res.json({ success: true, data: plans });
  } catch (error) {
    logger.error('Failed to fetch plans:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription plans' });
  }
};

const adminListPlans = async (req, res) => {
  try {
    const plans = await listPlans({ includeInactive: true });
    res.json({ success: true, data: plans });
  } catch (error) {
    logger.error('Failed to fetch admin plans:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch plans' });
  }
};

const adminCreatePlan = async (req, res) => {
  try {
    const payload = {
      name: req.body.name,
      slug: req.body.slug,
      description: req.body.description || '',
      duration_days: Number(req.body.duration_days) || 30,
      price_cents: Number(req.body.price_cents) || 0,
      currency_code: req.body.currency_code || 'INR',
      features: parseFeatures(req.body.features)
    };

    if (!payload.name || !payload.slug) {
      return res.status(400).json({ success: false, message: 'Name and slug are required' });
    }

    const plan = await createPlan(payload);
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    logger.error('Failed to create plan:', error);
    res.status(500).json({ success: false, message: 'Failed to create plan' });
  }
};

const adminUpdatePlan = async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.features) {
      payload.features = parseFeatures(payload.features);
    }

    const plan = await updatePlan(req.params.planId, payload);
    res.json({ success: true, data: plan });
  } catch (error) {
    logger.error('Failed to update plan:', error);
    res.status(500).json({ success: false, message: 'Failed to update plan' });
  }
};

const adminTogglePlan = async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'is_active flag required' });
    }
    const plan = await togglePlan(req.params.planId, is_active);
    res.json({ success: true, data: plan });
  } catch (error) {
    logger.error('Failed to toggle plan:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle plan' });
  }
};

const adminListPromocodes = async (req, res) => {
  try {
    const promos = await listPromocodes();
    res.json({ success: true, data: promos });
  } catch (error) {
    logger.error('Failed to fetch promocodes:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch promocodes' });
  }
};

const adminCreatePromocode = async (req, res) => {
  try {
    const payload = {
      code: (req.body.code || '').trim().toUpperCase(),
      description: req.body.description || '',
      discount_type: req.body.discount_type || 'percent',
      discount_value: Number(req.body.discount_value) || 0,
      max_redemptions: req.body.max_redemptions ? Number(req.body.max_redemptions) : null,
      min_amount_cents: req.body.min_amount_cents ? Number(req.body.min_amount_cents) : null,
      start_at: req.body.start_at || null,
      end_at: req.body.end_at || null,
      auto_renew_only: Boolean(req.body.auto_renew_only)
    };

    if (!payload.code || !payload.discount_value) {
      return res.status(400).json({ success: false, message: 'Code and discount value are required' });
    }

    const planIds = Array.isArray(req.body.plan_ids) ? req.body.plan_ids : [];
    const promo = await createPromocode(payload, planIds);
    res.status(201).json({ success: true, data: promo });
  } catch (error) {
    logger.error('Failed to create promocode:', error);
    res.status(500).json({ success: false, message: 'Failed to create promocode' });
  }
};

const adminUpdatePromocode = async (req, res) => {
  try {
    const { plan_ids: incomingPlanIds, ...rest } = req.body || {};
    if (rest.code) {
      rest.code = rest.code.trim().toUpperCase();
    }

    const planIds = Array.isArray(incomingPlanIds) ? incomingPlanIds : null;
    const promo = await updatePromocode(req.params.promoId, rest, planIds);
    res.json({ success: true, data: promo });
  } catch (error) {
    logger.error('Failed to update promocode:', error);
    res.status(500).json({ success: false, message: 'Failed to update promocode' });
  }
};

const adminListTransactions = async (req, res) => {
  try {
    const { status, plan_id: planId, search, limit } = req.query || {};
    const transactions = await listSubscriptionTransactions({
      status: status || 'all',
      planId: planId || undefined,
      search: search || undefined,
      limit: limit ? Number(limit) : undefined
    });
    res.json({ success: true, data: transactions });
  } catch (error) {
    logger.error('Failed to fetch subscription transactions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
};

const buildPromoDescription = (promo, amountBefore, amountAfter) => {
  if (!promo) return null;
  const saved = Math.max(0, amountBefore - amountAfter);
  if (promo.discount_type === 'percent') {
    return `${promo.discount_value}% off • Saved ${formatCurrency(saved)}`;
  }
  return `Saved ${formatCurrency(saved)} with ${promo.code}`;
};

const formatCurrency = (amountCents) => `₹${(amountCents / 100).toFixed(2)}`;

const resolvePlanAndPromo = async ({ planId, promoCode, autoRenew }) => {
  const plan = await getPlanById(planId);
  if (!plan || !plan.is_active) {
    return { errorStatus: 404, errorMessage: 'Plan not found' };
  }

  let promo = null;
  if (promoCode) {
    promo = await getPromocodeByCode(promoCode.trim().toUpperCase());
    const validation = validatePromocodeForPlan({ promo, planId, autoRenew });
    if (!validation.valid) {
      return { errorStatus: 400, errorMessage: validation.message };
    }
  }

  let adjustedAmount = plan.price_cents;
  if (promo) {
    adjustedAmount = applyDiscount(adjustedAmount, promo);
    if (promo.min_amount_cents && adjustedAmount < promo.min_amount_cents) {
      return { errorStatus: 400, errorMessage: 'Plan price does not meet promo minimum' };
    }
  }

  return {
    plan,
    promo,
    amountCents: plan.price_cents,
    adjustedAmount,
    promoDescription: buildPromoDescription(promo, plan.price_cents, adjustedAmount)
  };
};

const previewSubscriptionCheckout = async (req, res) => {
  try {
    const { plan_id: planId, promo_code: promoCode, auto_renew: autoRenew = true } = req.body || {};

    if (!planId) {
      return res.status(400).json({ success: false, message: 'plan_id is required' });
    }

    const result = await resolvePlanAndPromo({ planId, promoCode, autoRenew });
    if (result.errorStatus) {
      return res.status(result.errorStatus).json({ success: false, message: result.errorMessage });
    }

    const { plan, promo, amountCents, adjustedAmount, promoDescription } = result;

    return res.json({
      success: true,
      data: {
        plan: {
          id: plan.id,
          name: plan.name,
          duration_days: plan.duration_days,
          price_cents: plan.price_cents,
          currency_code: plan.currency_code
        },
        amount_cents: amountCents,
        adjusted_amount_cents: adjustedAmount,
        promo: promo
          ? {
              id: promo.id,
              code: promo.code,
              discount_type: promo.discount_type,
              discount_value: promo.discount_value
            }
          : null,
        promoDescription
      }
    });
  } catch (error) {
    logger.error('Failed to preview subscription checkout:', error);
    res.status(500).json({ success: false, message: 'Failed to preview checkout' });
  }
};

const startSubscriptionCheckout = async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const { plan_id: planId, promo_code: promoCode, auto_renew: autoRenew = true } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'plan_id is required' });
    }

    const result = await resolvePlanAndPromo({ planId, promoCode, autoRenew });
    if (result.errorStatus) {
      return res.status(result.errorStatus).json({ success: false, message: result.errorMessage });
    }

    const { plan, promo, adjustedAmount, promoDescription } = result;

    const shortPlanId = plan.id.replace(/-/g, '').slice(0, 12);
    const receipt = `sub_${shortPlanId}_${Date.now()}`.slice(0, 40);

    const order = await createOrder({
      amount: adjustedAmount,
      currency: plan.currency_code,
      receipt,
      notes: {
        planId: plan.id,
        userId: req.user.id
      }
    });

    const subscription = await createPendingSubscription({
      userId: req.user.id,
      planId: plan.id,
      promocodeId: promo?.id || null,
      autoRenew,
      razorpayOrderId: order.id,
      amountCents: adjustedAmount,
      currencyCode: plan.currency_code
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        subscriptionId: subscription.id,
        adjustedAmount,
        promoDescription
      }
    });
  } catch (error) {
    logger.error('Failed to start subscription checkout:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate checkout' });
  }
};

const confirmSubscriptionPayment = async (req, res) => {
  try {
    const { order_id: orderId, payment_id: paymentId, signature } = req.body;
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: 'Payment verification details missing' });
    }

    if (!verifySignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    const subscription = await getPendingSubscriptionByOrder(orderId);
    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Pending subscription not found' });
    }

    if (subscription.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized subscription confirmation' });
    }

    const plan = await getPlanById(subscription.plan_id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const startDate = new Date();
    const expiresAt = new Date(startDate.getTime() + plan.duration_days * 24 * 60 * 60 * 1000);

    await markSubscriptionActive({
      subscriptionId: subscription.id,
      paymentId,
      startDate: startDate.toISOString(),
      endDate: expiresAt.toISOString()
    });

    await updateUserPremiumState({
      userId: subscription.user_id,
      planId: plan.id,
      expiresAt: expiresAt.toISOString(),
      autoRenew: subscription.auto_renew
    });

    if (subscription.promocode_id) {
      await incrementPromocodeUsage(subscription.promocode_id);
    }

    try {
      await sendSubscriptionActivatedEmail(req.user.email, req.user.name, {
        planName: plan.name,
        amount: subscription.amount_cents,
        currency: subscription.currency_code,
        expiresAt: expiresAt.toISOString(),
        autoRenew: subscription.auto_renew
      });
    } catch (emailError) {
      logger.warn('Failed to send subscription email:', emailError);
    }

    res.json({ success: true, message: 'Subscription activated successfully' });
  } catch (error) {
    logger.error('Failed to confirm subscription:', error);
    res.status(500).json({ success: false, message: 'Failed to confirm subscription' });
  }
};

const toggleAutoRenew = async (req, res) => {
  try {
    const { enable } = req.body;
    if (typeof enable !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enable flag is required' });
    }

    const subscription = await getLatestSubscriptionForUser(req.user.id);
    if (!subscription) {
      return res.status(404).json({ success: false, message: 'No subscription found' });
    }

    await updateSubscriptionAutoRenew(subscription.id, enable);
    await updateUserAutoRenewFlag(req.user.id, enable);

    try {
      const plan = await getPlanById(subscription.plan_id);
      if (plan) {
        await sendAutoRenewStatusEmail(req.user.email, req.user.name, {
          planName: plan.name,
          autoRenew: enable,
          expiresAt: subscription.expires_at
        });
      }
    } catch (emailError) {
      logger.warn('Failed to send auto renew email:', emailError);
    }

    res.json({ success: true, message: `Auto renew ${enable ? 'enabled' : 'disabled'} successfully` });
  } catch (error) {
    logger.error('Failed to toggle auto renew:', error);
    res.status(500).json({ success: false, message: 'Failed to update auto renew' });
  }
};

const cancelSubscription = async (req, res) => {
  try {
    const subscription = await getLatestSubscriptionForUser(req.user.id);
    if (!subscription || subscription.status !== 'active') {
      return res.status(404).json({ success: false, message: 'No active subscription found' });
    }

    const updatedSubscription = await cancelSubscriptionRecord(subscription.id, req.user.id);
    await updateUserAutoRenewFlag(req.user.id, false);

    try {
      const plan = subscription.plan_id ? await getPlanById(subscription.plan_id) : null;
      await sendSubscriptionCancelledEmail(req.user.email, req.user.name, {
        planName: plan?.name || 'Premium plan',
        expiresAt: subscription.expires_at
      });
    } catch (emailError) {
      logger.warn('Failed to send subscription cancelled email:', emailError);
    }

    res.json({
      success: true,
      message: 'Auto renew disabled. Your premium access remains active until the current expiry date.',
      data: updatedSubscription
    });
  } catch (error) {
    logger.error('Failed to cancel subscription:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel subscription' });
  }
};

module.exports = {
  getPlans,
  adminListPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminTogglePlan,
  adminListPromocodes,
  adminCreatePromocode,
  adminUpdatePromocode,
  adminListTransactions,
  previewSubscriptionCheckout,
  startSubscriptionCheckout,
  confirmSubscriptionPayment,
  toggleAutoRenew,
  cancelSubscription
};
