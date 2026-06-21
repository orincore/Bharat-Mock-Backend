-- 20260621_drop_dob_and_interested_categories.sql
-- Onboarding no longer collects date of birth or interested categories.
-- Remove the now-unused column and table. IF EXISTS keeps this idempotent.

-- Drop the interested-categories join table (cascades its indexes & FK constraints).
DROP TABLE IF EXISTS user_interested_categories CASCADE;

-- Drop the date_of_birth column from users.
ALTER TABLE users DROP COLUMN IF EXISTS date_of_birth;
