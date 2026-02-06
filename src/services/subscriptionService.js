const supabase = require('../config/database');
const logger = require('../config/logger');

const normalizePlan = (plan) => {
  if (!plan) return null;
  return {
    ...plan,
    price_cents: Number(plan.price_cents),
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
  let query = supabase
    .from('subscription_plans')
    .select('*')
    .order('price_cents');

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('Failed to fetch subscription plans:', error);
    throw new Error('Unable to load subscription plans');
  }
  return data.map(normalizePlan);
};

const getPlanById = async (planId) => {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', planId)
    .single();

  if (error) {
    logger.error('Failed to load plan by id:', error, { planId });
    return null;
  }
  return normalizePlan(data);
};

const createPlan = async (payload) => {
  const { data, error } = await supabase
    .from('subscription_plans')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to create plan:', error);
    throw new Error('Unable to create plan');
  }
  return normalizePlan(data);
};

const updatePlan = async (planId, payload) => {
  const { data, error } = await supabase
    .from('subscription_plans')
    .update(payload)
    .eq('id', planId)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to update plan:', error, { planId });
    throw new Error('Unable to update plan');
  }
  return normalizePlan(data);
};

const togglePlan = async (planId, isActive) => updatePlan(planId, { is_active: isActive });

const listPromocodes = async () => {
  const { data, error } = await supabase
    .from('promocodes')
    .select('*, promocode_plan_links (plan_id)')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to list promocodes:', error);
    throw new Error('Unable to list promocodes');
  }
  return data.map(normalizePromocode);
};

const listSubscriptionTransactions = async ({ status, planId, search, limit = 50 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  let query = supabase
    .from('user_subscriptions')
    .select(`
      *,
      user:users ( id, name, email ),
      plan:subscription_plans ( id, name, price_cents, currency_code ),
      promocode:promocodes ( id, code, discount_type, discount_value )
    `)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  if (planId) {
    query = query.eq('plan_id', planId);
  }

  if (search) {
    const sanitized = search.replace(/[,]/g, '');
    query = query.or(`razorpay_order_id.ilike.%${sanitized}%,razorpay_payment_id.ilike.%${sanitized}%`);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('Failed to list subscription transactions:', error);
    throw new Error('Unable to fetch subscription transactions');
  }
  return data || [];
};

const setPromocodePlanLinks = async (promocodeId, planIds = []) => {
  const { error: deleteError } = await supabase
    .from('promocode_plan_links')
    .delete()
    .eq('promocode_id', promocodeId);

  if (deleteError) {
    logger.error('Failed to clear promocode links:', deleteError, { promocodeId });
    throw new Error('Unable to update promocode plan links');
  }

  if (!Array.isArray(planIds) || planIds.length === 0) {
    return;
  }

  const rows = planIds.map(planId => ({ promocode_id: promocodeId, plan_id: planId }));
  const { error: insertError } = await supabase.from('promocode_plan_links').insert(rows);

  if (insertError) {
    logger.error('Failed to insert promocode links:', insertError, { promocodeId, planIds });
    throw new Error('Unable to save promocode plan links');
  }
};

const createPromocode = async (payload, planIds = []) => {
  const { data, error } = await supabase
    .from('promocodes')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to create promocode:', error);
    throw new Error('Unable to create promocode');
  }

  await setPromocodePlanLinks(data.id, planIds);

  return getPromocodeById(data.id);
};

const updatePromocode = async (promocodeId, payload, planIds = null) => {
  const { data, error } = await supabase
    .from('promocodes')
    .update(payload)
    .eq('id', promocodeId)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to update promocode:', error, { promocodeId });
    throw new Error('Unable to update promocode');
  }

  if (Array.isArray(planIds)) {
    await setPromocodePlanLinks(promocodeId, planIds);
  }

  return getPromocodeById(promocodeId);
};

const getPromocodeById = async (id) => {
  const { data, error } = await supabase
    .from('promocodes')
    .select('*, promocode_plan_links (plan_id)')
    .eq('id', id)
    .single();

  if (error) {
    logger.warn('Promocode lookup by id failed', { id, error });
    return null;
  }
  return normalizePromocode(data);
};

const getPromocodeByCode = async (code) => {
  const { data, error } = await supabase
    .from('promocodes')
    .select('*, promocode_plan_links (plan_id)')
    .ilike('code', code)
    .single();

  if (error) {
    logger.warn('Promocode lookup failed', { code, error });
    return null;
  }
  return normalizePromocode(data);
};

const incrementPromocodeUsage = async (promocodeId) => {
  if (!promocodeId) return;
  const { data, error } = await supabase
    .from('promocodes')
    .select('redemptions_count')
    .eq('id', promocodeId)
    .single();

  if (error || !data) {
    logger.error('Failed to fetch promocode for increment:', error, { promocodeId });
    return;
  }

  const { error: updateError } = await supabase
    .from('promocodes')
    .update({ redemptions_count: (data.redemptions_count || 0) + 1 })
    .eq('id', promocodeId);

  if (updateError) {
    logger.error('Failed to increment promocode usage:', updateError, { promocodeId });
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
  const { data, error } = await supabase
    .from('user_subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      promocode_id: promocodeId,
      auto_renew: autoRenew,
      status: 'pending',
      razorpay_order_id: razorpayOrderId,
      amount_cents: amountCents,
      currency_code: currencyCode,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to create pending subscription:', error);
    throw new Error('Unable to create subscription record');
  }

  return { ...data, amount_cents: amountCents };
};

const markSubscriptionActive = async ({ subscriptionId, paymentId, startDate, endDate }) => {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .update({
      status: 'active',
      razorpay_payment_id: paymentId,
      started_at: startDate,
      expires_at: endDate,
      updated_at: new Date().toISOString()
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to activate subscription:', error, { subscriptionId });
    throw new Error('Unable to activate subscription');
  }
  return data;
};

const getSubscriptionsForRenewalReminder = async (windowHours = 72) => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('user_subscriptions')
    .select(`
      id,
      user_id,
      plan_id,
      expires_at,
      amount_cents,
      currency_code,
      auto_renew,
      status,
      renewal_reminder_sent_at,
      user:users!inner ( id, email, name ),
      plan:subscription_plans!inner ( id, name, price_cents, duration_days )
    `)
    .eq('status', 'active')
    .eq('auto_renew', true)
    .is('renewal_reminder_sent_at', null)
    .not('expires_at', 'is', null)
    .gte('expires_at', now.toISOString())
    .lte('expires_at', windowEnd.toISOString());

  if (error) {
    logger.error('Failed to fetch subscriptions for renewal reminder:', error);
    return [];
  }
  return data || [];
};

const getSubscriptionsForExpiryReminder = async (windowHours = 72) => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('user_subscriptions')
    .select(`
      id,
      user_id,
      plan_id,
      expires_at,
      amount_cents,
      currency_code,
      auto_renew,
      status,
      expiry_reminder_sent_at,
      user:users!inner ( id, email, name ),
      plan:subscription_plans!inner ( id, name, price_cents, duration_days )
    `)
    .eq('status', 'active')
    .eq('auto_renew', false)
    .is('expiry_reminder_sent_at', null)
    .not('expires_at', 'is', null)
    .gte('expires_at', now.toISOString())
    .lte('expires_at', windowEnd.toISOString());

  if (error) {
    logger.error('Failed to fetch subscriptions for expiry reminder:', error);
    return [];
  }
  return data || [];
};

const getSubscriptionsToExpire = async () => {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select(`
      id,
      user_id,
      plan_id,
      expires_at,
      auto_renew,
      status,
      user:users!inner ( id, email, name ),
      plan:subscription_plans!inner ( id, name )
    `)
    .eq('status', 'active')
    .not('expires_at', 'is', null)
    .lte('expires_at', nowIso);

  if (error) {
    logger.error('Failed to fetch subscriptions to expire:', error);
    return [];
  }
  return data || [];
};

const markRenewalReminderSent = async (subscriptionId) => {
  const timestamp = new Date().toISOString();
  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      renewal_reminder_sent_at: timestamp,
      updated_at: timestamp
    })
    .eq('id', subscriptionId);

  if (error) {
    logger.error('Failed to mark renewal reminder sent:', error, { subscriptionId });
    throw new Error('Unable to update renewal reminder flag');
  }
};

const markExpiryReminderSent = async (subscriptionId) => {
  const timestamp = new Date().toISOString();
  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      expiry_reminder_sent_at: timestamp,
      updated_at: timestamp
    })
    .eq('id', subscriptionId);

  if (error) {
    logger.error('Failed to mark expiry reminder sent:', error, { subscriptionId });
    throw new Error('Unable to update expiry reminder flag');
  }
};

const markSubscriptionExpired = async (subscriptionId) => {
  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from('user_subscriptions')
    .update({
      status: 'expired',
      auto_renew: false,
      updated_at: timestamp
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to mark subscription expired:', error, { subscriptionId });
    throw new Error('Unable to expire subscription');
  }
  return data;
};

const getPendingSubscriptionByOrder = async (orderId) => {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('razorpay_order_id', orderId)
    .eq('status', 'pending')
    .single();

  if (error) {
    logger.error('Failed to fetch pending subscription by order:', error, { orderId });
    return null;
  }
  return data;
};

const getLatestSubscriptionForUser = async (userId) => {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('Failed to fetch latest subscription:', error, { userId });
    return null;
  }
  return data;
};

const updateSubscriptionAutoRenew = async (subscriptionId, autoRenew) => {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .update({
      auto_renew: autoRenew,
      updated_at: new Date().toISOString()
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to update subscription auto renew:', error, { subscriptionId });
    throw new Error('Unable to update subscription');
  }
  return data;
};

const updateUserPremiumState = async ({ userId, planId, expiresAt, autoRenew }) => {
  const { error } = await supabase
    .from('users')
    .update({
      is_premium: true,
      subscription_plan_id: planId,
      subscription_expires_at: expiresAt,
      subscription_auto_renew: autoRenew
    })
    .eq('id', userId);

  if (error) {
    logger.error('Failed to update user premium state:', error, { userId });
    throw new Error('Unable to update user profile');
  }
};

const revokePremiumIfNeeded = async (userId) => {
  const { error } = await supabase
    .from('users')
    .update({
      is_premium: false,
      subscription_plan_id: null,
      subscription_expires_at: null,
      subscription_auto_renew: false
    })
    .eq('id', userId);

  if (error) {
    logger.error('Failed to revoke premium access:', error, { userId });
    throw new Error('Unable to revert premium status');
  }
};

const updateUserAutoRenewFlag = async (userId, autoRenew) => {
  const { error } = await supabase
    .from('users')
    .update({ subscription_auto_renew: autoRenew })
    .eq('id', userId);

  if (error) {
    logger.error('Failed to update user auto renew flag:', error, { userId });
    throw new Error('Unable to update user preferences');
  }
};

const cancelSubscription = async (subscriptionId, userId) => {
  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from('user_subscriptions')
    .update({
      status: 'canceled',
      auto_renew: false,
      updated_at: timestamp
    })
    .eq('id', subscriptionId)
    .select('*')
    .single();

  if (error) {
    logger.error('Failed to cancel subscription:', error, { subscriptionId });
    throw new Error('Unable to cancel subscription');
  }

  await revokePremiumIfNeeded(userId);
  return data;
};

module.exports = {
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
  markSubscriptionExpired,
  cancelSubscription
};
