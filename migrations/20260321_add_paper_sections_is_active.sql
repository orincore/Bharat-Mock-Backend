-- Migration: Add is_active to paper_sections and paper_topics
-- Date: 2026-03-21

BEGIN;

ALTER TABLE paper_sections ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE paper_topics ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Update existing rows to be active
UPDATE paper_sections SET is_active = TRUE WHERE is_active IS NULL;
UPDATE paper_topics SET is_active = TRUE WHERE is_active IS NULL;

COMMIT;
