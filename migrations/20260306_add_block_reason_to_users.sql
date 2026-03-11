-- Migration: Add block_reason to users
-- Date: 2026-03-06
-- Adds a reason field for blocked accounts

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS block_reason TEXT;
