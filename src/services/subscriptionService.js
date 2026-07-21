const prisma = require('../config/prisma');
const logger = require('../config/logger');

const normalizePlan = (plan) => {
  if (!plan) return null;
  const normalPrice = Number(plan.normal_price_cents);
  const salePrice = plan.sale_price_cents !== null && plan.sale_price_cents !== undefined
    ? Number(plan.sale_price_cents)
    : null;
  const effectivePrice = salePrice !== null ? salePrice : normalPrice;
  return {
    ...plan,
    normal_price_cents: normalPrice,
    sale_price_cents: salePrice,
    price_cents: effectivePrice,
    duration_days: Number(plan.duration_days)
  };
};

const normalizePromocode = (promo) => {
  if (!promo) return null;
  const planLinks = promo.promocode_plan_links || [];
  return {
    ...promo,
    applicable_plan_ids: planLinks.map(link => link.plan_id)
  };
};

const listPlans = async ({ includeInactive = false } = {}) => {
  try {
    const plans = await prisma.subscription_plans.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: [
        { sale_price_cents: { sort: 'asc', nulls: 'last' } },
        { normal_price_cents: 'asc' }
      ]
    });
    return plans.map(normalizePlan);
  } catch (error) {
    logger.error('Failed to fetch subscription plans:', error);
    throw new Error('Unable to load subscription plans');
  }
};

const getPlanById = async (planId) => {
  try {
    const plan = await prisma.subscription_plans.findUnique({ where: { id: planId } });
    return normalizePlan(plan);
  } catch (error) {
    logger.error('Failed to load plan by id:', error, { planId });
    return null;
  }
};

const createPlan = async (payload) => {
  try {
    const plan = await prisma.subscription_plans.create({ data: payload });
    return normalizePlan(plan);
  } catch (error) {
    logger.error('Failed to create plan:', error);
    throw new Error('Unable to create plan');
  }
};

const updatePlan = async (planId, payload) => {
  try {
    const plan = await prisma.subscription_plans.update({ where: { id: planId }, data: payload });
    return normalizePlan(plan);
  } catch (error) {
    logger.error('Failed to update plan:', error, { planId });
    throw new Error('Unable to update plan');
  }
};

const togglePlan = async (planId, isActive) => updatePlan(planId, { is_active: isActive });

const listPromocodes = async () => {
  try {
    const promocodes = await prisma.promocodes.findMany({
      include: { promocode_plan_links: { select: { plan_id: true } } },
      orderBy: { created_at: 'desc' }
    });
    return promocodes.map(normalizePromocode);
  } catch (error) {
    logger.error('Failed to list promocodes:', error);
    throw new Error('Unable to list promocodes');
  }
};

const listSubscriptionTransactions = async ({ status, planId, search, limit = 50 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

  const where = {};
  if (status && status !== 'all') {
    where.status = status;
  }
  if (planId) {
    where.plan_id = planId;
  }
  if (search) {
    const sanitized = search.replace(/[,]/g, '');
    where.OR = [
      { razorpay_order_id: { contains: sanitized, mode: 'insensitive' } },
      { razorpay_payment_id: { contains: sanitized, mode: 'insensitive' } }
    ];
  }

  try {
    const rows = await prisma.user_subscriptions.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: safeLimit,
      include: {
        users: { select: { id: true, name: true, email: true } },
        subscription_plans: {
          select: { id: true, name: true, normal_price_cents: true, sale_price_cents: true, currency_code: true }
        },
        promocodes: { select: { id: true, code: true, discount_type: true, discount_value: true } }
      }
    });

    return rows.map(({ users, subscription_plans, promocodes, ...rest }) => ({
      ...rest,
      user: users,
      plan: subscription_plans,
      promocode: promocodes
    }));
  } catch (error) {
    logger.error('Failed to list subscription transactions:', error);
    throw new Error('Unable to fetch subscription transactions');
  }
};

const setPromocodePlanLinks = async (promocodeId, planIds = []) => {
  try {
    await prisma.promocode_plan_links.deleteMany({ where: { promocode_id: promocodeId } });
  } catch (error) {
    logger.error('Failed to clear promocode links:', error, { promocodeId });
    throw new Error('Unable to update promocode plan links');
  }

  if (!Array.isArray(planIds) || planIds.length === 0) {
    return;
  }

  try {
    await prisma.promocode_plan_links.createMany({
      data: planIds.map(planId => ({ promocode_id: promocodeId, plan_id: planId }))
    });
  } catch (error) {
    logger.error('Failed to insert promocode links:', error, { promocodeId, planIds });
    throw new Error('Unable to save promocode plan links');
  }
};

const createPromocode = async (payload, planIds = []) => {
  let created;
  try {
    created = await prisma.promocodes.create({ data: payload });
  } catch (error) {
    logger.error('Failed to create promocode:', error);
    throw new Error('Unable to create promocode');
  }

  await setPromocodePlanLinks(created.id, planIds);

  return getPromocodeById(created.id);
};

const updatePromocode = async (promocodeId, payload, planIds = null) => {
  try {
    await prisma.promocodes.update({ where: { id: promocodeId }, data: payload });
  } catch (error) {
    logger.error('Failed to update promocode:', error, { promocodeId });
    throw new Error('Unable to update promocode');
  }

  if (Array.isArray(planIds)) {
    await setPromocodePlanLinks(promocodeId, planIds);
  }

  return getPromocodeById(promocodeId);
};

const getPromocodeById = async (id) => {
  try {
    const promo = await prisma.promocodes.findUnique({
      where: { id },
      include: { promocode_plan_links: { select: { plan_id: true } } }
    });
    return normalizePromocode(promo);
  } catch (error) {
    logger.warn('Promocode lookup by id failed', { id, error });
    return null;
  }
};

const getPromocodeByCode = async (code) => {
  try {
    const promo = await prisma.promocodes.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
      include: { promocode_plan_links: { select: { plan_id: true } } }
    });
    return normalizePromocode(promo);
  } catch (error) {
    logger.warn('Promocode lookup failed', { code, error });
    return null;
  }
};

const incrementPromocodeUsage = async (promocodeId) => {
  if (!promocodeId) return;
  try {
    await prisma.promocodes.update({
      where: { id: promocodeId },
      data: { redemptions_count: { increment: 1 } }
    });
  } catch (error) {
    logger.error('Failed to increment promocode usage:', error, { promocodeId });
  }
};

const createPendingSubscription = async ({
  userId,
  planId,
  promocodeId,
  autoRenew,
  razorpayOrderId,
  amountCents,
  currencyCode
}) => {
  try {
    const subscription = await prisma.user_subscriptions.create({
      data: {
        user_id: userId,
        plan_id: planId,
        promocode_id: promocodeId,
        auto_renew: autoRenew,
        status: 'pending',
        razorpay_order_id: razorpayOrderId,
        amount_cents: amountCents,
        currency_code: currencyCode
      }
    });

    return { ...subscription, amount_cents: amountCents };
  } catch (error) {
    logger.error('Failed to create pending subscription:', error);
    throw new Error('Unable to create subscription record');
  }
};

const markSubscriptionActive = async ({ subscriptionId, paymentId, startDate, endDate }) => {
  try {
    return await prisma.user_subscriptions.update({
      where: { id: subscriptionId },
      data: {
        status: 'active',
        razorpay_payment_id: paymentId,
        started_at: startDate,
        expires_at: endDate,
        updated_at: new Date()
      }
    });
  } catch (error) {
    logger.error('Failed to activate subscription:', error, { subscriptionId });
    throw new Error('Unable to activate subscription');
  }
};

const getSubscriptionsForRenewalReminder = async (windowHours = 72) => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  try {
    const rows = await prisma.user_subscriptions.findMany({
      where: {
        status: 'active',
        auto_renew: true,
        renewal_reminder_sent_at: null,
        expires_at: { not: null, gte: now, lte: windowEnd }
      },
      select: {
        id: true,
        user_id: true,
        plan_id: true,
        expires_at: true,
        amount_cents: true,
        currency_code: true,
        auto_renew: true,
        status: true,
        renewal_reminder_sent_at: true,
        users: { select: { id: true, email: true, name: true } },
        subscription_plans: {
          select: { id: true, name: true, normal_price_cents: true, sale_price_cents: true, duration_days: true }
        }
      }
    });

    return rows.map(({ users, subscription_plans, ...rest }) => ({ ...rest, user: users, plan: subscription_plans }));
  } catch (error) {
    logger.error('Failed to fetch subscriptions for renewal reminder:', error);
    return [];
  }
};

const getSubscriptionsForExpiryReminder = async (windowHours = 72) => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  try {
    const rows = await prisma.user_subscriptions.findMany({
      where: {
        status: 'active',
        auto_renew: false,
        expiry_reminder_sent_at: null,
        expires_at: { not: null, gte: now, lte: windowEnd }
      },
      select: {
        id: true,
        user_id: true,
        plan_id: true,
        expires_at: true,
        amount_cents: true,
        currency_code: true,
        auto_renew: true,
        status: true,
        expiry_reminder_sent_at: true,
        users: { select: { id: true, email: true, name: true } },
        subscription_plans: {
          select: { id: true, name: true, normal_price_cents: true, sale_price_cents: true, duration_days: true }
        }
      }
    });

    return rows.map(({ users, subscription_plans, ...rest }) => ({ ...rest, user: users, plan: subscription_plans }));
  } catch (error) {
    logger.error('Failed to fetch subscriptions for expiry reminder:', error);
    return [];
  }
};

const getSubscriptionsToExpire = async () => {
  const now = new Date();
  try {
    const rows = await prisma.user_subscriptions.findMany({
      where: {
        status: { in: ['active', 'canceled'] },
        expires_at: { not: null, lte: now }
      },
      select: {
        id: true,
        user_id: true,
        plan_id: true,
        expires_at: true,
        auto_renew: true,
        status: true,
        users: { select: { id: true, email: true, name: true } },
        subscription_plans: { select: { id: true, name: true } }
      }
    });

    return rows.map(({ users, subscription_plans, ...rest }) => ({ ...rest, user: users, plan: subscription_plans }));
  } catch (error) {
    logger.error('Failed to fetch subscriptions to expire:', error);
    return [];
  }
};

const getMidnightExpiredSubscriptions = async () => {
  // Find all active/canceled subscriptions whose expires_at is before start of today (IST midnight)
  // This catches any that the hourly job may have missed
  const now = new Date();
  // Start of today in IST (UTC+5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(now.getTime() + istOffsetMs);
  const startOfTodayIST = new Date(Date.UTC(
    nowIST.getUTCFullYear(),
    nowIST.getUTCMonth(),
    nowIST.getUTCDate(),
    0, 0, 0, 0
  ) - istOffsetMs); // convert back to UTC

  try {
    const rows = await prisma.user_subscriptions.findMany({
      where: {
        status: { in: ['active', 'canceled'] },
        expires_at: { not: null, lt: startOfTodayIST }
      },
      select: {
        id: true,
        user_id: true,
        plan_id: true,
        expires_at: true,
        status: true,
        users: { select: { id: true, email: true, name: true, is_premium: true } },
        subscription_plans: { select: { id: true, name: true } }
      }
    });

    return rows.map(({ users, subscription_plans, ...rest }) => ({ ...rest, user: users, plan: subscription_plans }));
  } catch (error) {
    logger.error('[MidnightJob] Failed to fetch expired subscriptions:', error);
    return [];
  }
};

const markRenewalReminderSent = async (subscriptionId) => {
  const timestamp = new Date();
  try {
    await prisma.user_subscriptions.update({
      where: { id: subscriptionId },
      data: {
        renewal_reminder_sent_at: timestamp,
        updated_at: timestamp
      }
    });
  } catch (error) {
    logger.error('Failed to mark renewal reminder sent:', error, { subscriptionId });
    throw new Error('Unable to update renewal reminder flag');
  }
};

const markExpiryReminderSent = async (subscriptionId) => {
  const timestamp = new Date();
  try {
    await prisma.user_subscriptions.update({
      where: { id: subscriptionId },
      data: {
        expiry_reminder_sent_at: timestamp,
        updated_at: timestamp
      }
    });
  } catch (error) {
    logger.error('Failed to mark expiry reminder sent:', error, { subscriptionId });
    throw new Error('Unable to update expiry reminder flag');
  }
};

const markSubscriptionExpired = async (subscriptionId) => {
  const timestamp = new Date();
  try {
    // Status guard prevents race condition: only the first job run that finds
    // status = active/canceled wins; concurrent runs silently skip.
    const result = await prisma.user_subscriptions.updateMany({
      where: {
        id: subscriptionId,
        status: { in: ['active', 'canceled'] }
      },
      data: {
        status: 'expired',
        auto_renew: false,
        updated_at: timestamp
      }
    });

    // count === 0 means the guarded status filter matched nothing — caller should
    // treat this as "already handled" (mirrors the old .maybeSingle() null result).
    if (result.count === 0) {
      return null;
    }

    return await prisma.user_subscriptions.findUnique({ where: { id: subscriptionId } });
  } catch (error) {
    logger.error('Failed to mark subscription expired:', error, { subscriptionId });
    throw new Error('Unable to expire subscription');
  }
};

const getPendingSubscriptionByOrder = async (orderId) => {
  try {
    return await prisma.user_subscriptions.findFirst({
      where: { razorpay_order_id: orderId, status: 'pending' }
    });
  } catch (error) {
    logger.error('Failed to fetch pending subscription by order:', error, { orderId });
    return null;
  }
};

const getLatestSubscriptionForUser = async (userId) => {
  try {
    return await prisma.user_subscriptions.findFirst({
      where: { user_id: userId, status: { in: ['active', 'pending'] } },
      orderBy: { created_at: 'desc' }
    });
  } catch (error) {
    logger.error('Failed to fetch latest subscription:', error, { userId });
    return null;
  }
};

const updateSubscriptionAutoRenew = async (subscriptionId, autoRenew) => {
  try {
    return await prisma.user_subscriptions.update({
      where: { id: subscriptionId },
      data: {
        auto_renew: autoRenew,
        updated_at: new Date()
      }
    });
  } catch (error) {
    logger.error('Failed to update subscription auto renew:', error, { subscriptionId });
    throw new Error('Unable to update subscription');
  }
};

const updateUserPremiumState = async ({ userId, planId, expiresAt, autoRenew }) => {
  try {
    await prisma.users.update({
      where: { id: userId },
      data: {
        is_premium: true,
        subscription_plan_id: planId,
        subscription_expires_at: expiresAt,
        subscription_auto_renew: autoRenew
      }
    });
  } catch (error) {
    logger.error('Failed to update user premium state:', error, { userId });
    throw new Error('Unable to update user profile');
  }
};

const revokePremiumIfNeeded = async (userId) => {
  // Do NOT revoke if the user has another active subscription still running
  const now = new Date();
  let activeSubscription = null;
  try {
    activeSubscription = await prisma.user_subscriptions.findFirst({
      where: {
        user_id: userId,
        status: { in: ['active', 'canceled'] },
        expires_at: { not: null, gte: now }
      },
      select: { id: true, expires_at: true }
    });
  } catch (error) {
    logger.error('Failed to check for an active subscription in revokePremiumIfNeeded:', error, { userId });
  }

  if (activeSubscription) {
    logger.info('revokePremiumIfNeeded: user still has active subscription, skipping revoke', {
      userId, subscriptionId: activeSubscription.id, expiresAt: activeSubscription.expires_at
    });
    return;
  }

  try {
    await prisma.users.update({
      where: { id: userId },
      data: {
        is_premium: false,
        subscription_plan_id: null,
        subscription_expires_at: null,
        subscription_auto_renew: false
      }
    });
  } catch (error) {
    logger.error('Failed to revoke premium access:', error, { userId });
    throw new Error('Unable to revert premium status');
  }
};

const updateUserAutoRenewFlag = async (userId, autoRenew) => {
  try {
    await prisma.users.update({
      where: { id: userId },
      data: { subscription_auto_renew: autoRenew }
    });
  } catch (error) {
    logger.error('Failed to update user auto renew flag:', error, { userId });
    throw new Error('Unable to update user preferences');
  }
};

const cancelSubscription = async (subscriptionId, userId) => {
  const timestamp = new Date();

  try {
    // Existence check — mirrors the old .single() error-on-no-match guard.
    await prisma.user_subscriptions.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { id: true }
    });
  } catch (error) {
    logger.error('Failed to fetch subscription for cancellation:', error, { subscriptionId });
    throw new Error('Unable to cancel subscription');
  }

  let updated;
  try {
    updated = await prisma.user_subscriptions.update({
      where: { id: subscriptionId },
      data: {
        status: 'canceled',
        auto_renew: false,
        updated_at: timestamp
      }
    });
  } catch (error) {
    logger.error('Failed to cancel subscription:', error, { subscriptionId });
    throw new Error('Unable to cancel subscription');
  }

  // Only disable auto-renew on the user record — keep is_premium true until expires_at.
  // Best-effort: never let a failure here block the cancellation response.
  try {
    await prisma.users.update({
      where: { id: userId },
      data: { subscription_auto_renew: false }
    });
  } catch (error) {
    logger.error('Failed to sync user auto_renew flag during cancellation:', error, { subscriptionId, userId });
  }

  // Premium access remains active until the expiry date.
  // The scheduled job (subscriptionJobs) will call revokePremiumIfNeeded when expires_at passes.

  return updated;
};

const getUserLatestSubscriptionWithPlan = async (userId) => {
  try {
    const row = await prisma.user_subscriptions.findFirst({
      where: { user_id: userId, status: { in: ['active', 'canceled', 'pending'] } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        status: true,
        expires_at: true,
        auto_renew: true,
        subscription_plans: { select: { id: true, name: true } }
      }
    });

    if (!row) return null;

    const { subscription_plans, ...rest } = row;
    return { ...rest, plan: subscription_plans };
  } catch (error) {
    logger.error('Failed to fetch user subscription with plan:', error, { userId });
    return null;
  }
};

module.exports = {
  getUserLatestSubscriptionWithPlan,
  listPlans,
  getPlanById,
  createPlan,
  updatePlan,
  togglePlan,
  listPromocodes,
  createPromocode,
  updatePromocode,
  getPromocodeByCode,
  incrementPromocodeUsage,
  createPendingSubscription,
  markSubscriptionActive,
  getPendingSubscriptionByOrder,
  getLatestSubscriptionForUser,
  updateSubscriptionAutoRenew,
  getPromocodeById,
  updateUserPremiumState,
  revokePremiumIfNeeded,
  updateUserAutoRenewFlag,
  setPromocodePlanLinks,
  listSubscriptionTransactions,
  getSubscriptionsForRenewalReminder,
  getSubscriptionsForExpiryReminder,
  markRenewalReminderSent,
  markExpiryReminderSent,
  getSubscriptionsToExpire,
  getMidnightExpiredSubscriptions,
  markSubscriptionExpired,
  cancelSubscription
};
