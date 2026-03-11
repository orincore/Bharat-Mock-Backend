BEGIN;

ALTER TABLE subscription_plans
  RENAME COLUMN price_cents TO normal_price_cents;

ALTER TABLE subscription_plans
  ADD COLUMN sale_price_cents INTEGER CHECK (sale_price_cents >= 0);

UPDATE subscription_plans
SET sale_price_cents = normal_price_cents
WHERE sale_price_cents IS NULL;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_sale_price_check
  CHECK (sale_price_cents IS NULL OR sale_price_cents <= normal_price_cents);

ALTER TABLE subscription_plans
  ALTER COLUMN normal_price_cents SET DEFAULT 0;

COMMIT;
