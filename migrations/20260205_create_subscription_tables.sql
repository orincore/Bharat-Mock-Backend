BEGIN;

CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    currency_code TEXT NOT NULL DEFAULT 'INR',
    razorpay_plan_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    features TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX subscription_plans_name_idx ON subscription_plans(LOWER(name));

CREATE TABLE promocodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
    discount_value INTEGER NOT NULL CHECK (discount_value > 0),
    max_redemptions INTEGER CHECK (max_redemptions >= 0),
    redemptions_count INTEGER NOT NULL DEFAULT 0,
    min_amount_cents INTEGER CHECK (min_amount_cents >= 0),
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    auto_renew_only BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE promocode_plan_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    promocode_id UUID NOT NULL REFERENCES promocodes(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX promocode_plan_unique ON promocode_plan_links (promocode_id, plan_id);

CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
    promocode_id UUID REFERENCES promocodes(id) ON DELETE SET NULL,
    razorpay_subscription_id TEXT,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'canceled', 'pending')), 
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency_code TEXT NOT NULL DEFAULT 'INR',
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    cancel_requested_at TIMESTAMPTZ,
    renewal_reminder_sent_at TIMESTAMPTZ,
    expiry_reminder_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_subscriptions_user_idx ON user_subscriptions(user_id);
CREATE INDEX user_subscriptions_status_idx ON user_subscriptions(status);
CREATE INDEX user_subscriptions_expires_idx ON user_subscriptions(expires_at);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS subscription_plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_auto_renew BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TRIGGER update_subscription_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_promocodes_updated_at
    BEFORE UPDATE ON promocodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
