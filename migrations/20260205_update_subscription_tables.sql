BEGIN;

ALTER TABLE subscription_plans
    ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'INR',
    ADD COLUMN IF NOT EXISTS razorpay_plan_id TEXT;

ALTER TABLE user_subscriptions
    ALTER COLUMN started_at DROP NOT NULL,
    ALTER COLUMN expires_at DROP NOT NULL;

COMMIT;
