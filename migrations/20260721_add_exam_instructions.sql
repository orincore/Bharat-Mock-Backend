-- Migration: Per-exam candidate instructions
-- Created: 2026-07-21
-- Purpose: Let an admin override the instructions shown on the exam attempt
--          screen and printed on the generated question-paper PDF. NULL/empty
--          means "use the built-in default instructions", so every existing exam
--          keeps its current behaviour with no backfill required.

ALTER TABLE exams ADD COLUMN IF NOT EXISTS instructions TEXT;

COMMENT ON COLUMN exams.instructions IS
  'Optional rich-text candidate instructions. NULL or empty = render the default instruction set.';

-- ============================================================
-- Verify
-- ============================================================

DO $$
BEGIN
    ASSERT (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'exams' AND column_name = 'instructions'
    ) = 1, 'Migration failed: exams.instructions was not created';

    RAISE NOTICE 'Migration 20260721_add_exam_instructions OK';
END;
$$;
