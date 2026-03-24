-- Migration: Add is_current_affair flag to exams
-- When true on a short_quiz exam, it is automatically linked to the current affairs page

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS is_current_affair BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_exams_is_current_affair ON exams(is_current_affair);

COMMENT ON COLUMN exams.is_current_affair IS 'When true on a short_quiz, the exam is auto-linked to the current affairs page';
