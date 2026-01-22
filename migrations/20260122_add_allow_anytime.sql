-- Migration: Add allow_anytime flag to exams
-- Date: 2026-01-22

ALTER TABLE exams
ADD COLUMN IF NOT EXISTS allow_anytime BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN exams.allow_anytime IS 'If true, users can attempt the exam anytime regardless of status or schedule';
