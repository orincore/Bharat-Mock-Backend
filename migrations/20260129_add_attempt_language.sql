-- Migration: Add language tracking to exam attempts
-- Created: 2026-01-29

ALTER TABLE exam_attempts
ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi'));

COMMENT ON COLUMN exam_attempts.language IS 'Language selected by the learner for this attempt';
