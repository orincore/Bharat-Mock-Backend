-- Migration: Add display_order and is_active columns to exam_subcategories
-- Created: 2026-01-26
-- Description: Ensures taxonomy controller queries can select ordering/active flags

ALTER TABLE exam_subcategories
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_exam_subcategories_active
  ON exam_subcategories(is_active);

CREATE INDEX IF NOT EXISTS idx_exam_subcategories_display_order
  ON exam_subcategories(display_order);

-- Backfill null values for existing rows
UPDATE exam_subcategories
SET display_order = COALESCE(display_order, 0),
    is_active = COALESCE(is_active, true)
WHERE display_order IS NULL OR is_active IS NULL;
