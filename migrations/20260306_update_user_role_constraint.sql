-- Migration: Update users.role check constraint to support new roles
-- Date: 2026-03-06

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'admin', 'editor', 'author'));
