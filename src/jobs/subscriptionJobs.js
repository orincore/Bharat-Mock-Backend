const cron = require('node-cron');
const logger = require('../config/logger');
const {
  getSubscriptionsForRenewalReminder,
  getSubscriptionsForExpiryReminder,
  markRenewalReminderSent,
  markExpiryReminderSent,
  getSubscriptionsToExpire,
  markSubscriptionExpired,
  revokePremiumIfNeeded
} = require('../services/subscriptionService');
const {
  sendRenewalReminderEmail,
  sendExpiryReminderEmail,
  sendSubscriptionExpiredEmail
} = require('../utils/emailService');

const DEFAULT_WINDOW_HOURS = parseInt(process.env.SUBSCRIPTION_REMINDER_WINDOW_HOURS, 10) || 72;
const TIMEZONE = process.env.CRON_TIMEZONE || 'Asia/Kolkata';
const RENEWAL_CRON = process.env.SUBSCRIPTION_RENEWAL_CRON || '0 * * * *';
const EXPIRY_REMINDER_CRON = process.env.SUBSCRIPTION_EXPIRY_REMINDER_CRON || '15 * * * *';
const EXPIRATION_CRON = process.env.SUBSCRIPTION_EXPIRATION_CRON || '30 * * * *';

const processRenewalReminders = async () => {
  try {
    const subscriptions = await getSubscriptionsForRenewalReminder(DEFAULT_WINDOW_HOURS);
    if (!subscriptions.length) return;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await sendRenewalReminderEmail(subscription.user.email, subscription.user.name, {
            planName: subscription.plan.name,
            renewDate: subscription.expires_at,
            amount: subscription.amount_cents,
            currency: subscription.currency_code
          });
          await markRenewalReminderSent(subscription.id);
          logger.info('Sent renewal reminder', { subscriptionId: subscription.id });
        } catch (error) {
          logger.error('Failed to send renewal reminder', error, { subscriptionId: subscription.id });
        }
      })
    );
  } catch (error) {
    logger.error('Renewal reminder job failed', error);
  }
};

const processExpiryReminders = async () => {
  try {
    const subscriptions = await getSubscriptionsForExpiryReminder(DEFAULT_WINDOW_HOURS);
    if (!subscriptions.length) return;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await sendExpiryReminderEmail(subscription.user.email, subscription.user.name, {
            planName: subscription.plan.name,
            expiryDate: subscription.expires_at
          });
          await markExpiryReminderSent(subscription.id);
          logger.info('Sent expiry reminder', { subscriptionId: subscription.id });
        } catch (error) {
          logger.error('Failed to send expiry reminder', error, { subscriptionId: subscription.id });
        }
      })
    );
  } catch (error) {
    logger.error('Expiry reminder job failed', error);
  }
};

const processSubscriptionExpirations = async () => {
  try {
    const subscriptions = await getSubscriptionsToExpire();
    if (!subscriptions.length) return;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await markSubscriptionExpired(subscription.id);
          await revokePremiumIfNeeded(subscription.user_id);
          await sendSubscriptionExpiredEmail(subscription.user.email, subscription.user.name, {
            planName: subscription.plan.name,
            expiredAt: subscription.expires_at
          });
          logger.info('Expired subscription processed', { subscriptionId: subscription.id });
        } catch (error) {
          logger.error('Failed to process subscription expiration', error, { subscriptionId: subscription.id });
        }
      })
    );
  } catch (error) {
    logger.error('Subscription expiration job failed', error);
  }
};

const registerJob = (expression, handler, label) => {
  const task = cron.schedule(
    expression,
    () => handler().catch((error) => logger.error(`${label} execution failed`, error)),
    {
      timezone: TIMEZONE
    }
  );
  logger.info(`${label} scheduled`, { cron: expression, timezone: TIMEZONE });
  return task;
};

const startSubscriptionJobs = () => {
  if ((process.env.DISABLE_SUBSCRIPTION_JOBS || '').toLowerCase() === 'true') {
    logger.info('Subscription background jobs are disabled via environment flag');
    return;
  }

  registerJob(RENEWAL_CRON, processRenewalReminders, 'Subscription renewal reminder job');
  registerJob(EXPIRY_REMINDER_CRON, processExpiryReminders, 'Subscription expiry reminder job');
  registerJob(EXPIRATION_CRON, processSubscriptionExpirations, 'Subscription expiration job');
};

module.exports = {
  startSubscriptionJobs,
  processRenewalReminders,
  processExpiryReminders,
  processSubscriptionExpirations
};
