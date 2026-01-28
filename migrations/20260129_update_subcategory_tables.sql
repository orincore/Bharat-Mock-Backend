-- Migration: Align subcategory tables with controller requirements
-- Created: 2026-01-26
-- Description: Adds missing columns used by API controllers to prevent runtime errors

-- 1) Subcategory updates table expects description, update_type, update_date
ALTER TABLE subcategory_updates
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS update_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS update_date TIMESTAMP;

-- Backfill new columns from legacy fields when available
UPDATE subcategory_updates
SET
  update_type = COALESCE(update_type, tag),
  update_date = COALESCE(update_date, published_at),
  description = COALESCE(description, '')
WHERE update_type IS NULL OR update_date IS NULL OR description IS NULL;

-- 2) Subcategory exam stats table expects stat_* columns plus ordering metadata
ALTER TABLE subcategory_exam_stats
  ADD COLUMN IF NOT EXISTS stat_label VARCHAR(150),
  ADD COLUMN IF NOT EXISTS stat_value VARCHAR(150),
  ADD COLUMN IF NOT EXISTS stat_description TEXT,
  ADD COLUMN IF NOT EXISTS icon VARCHAR(100),
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Backfill stat_label/stat_value from legacy metric columns
UPDATE subcategory_exam_stats
SET
  stat_label = COALESCE(stat_label, metric),
  stat_value = COALESCE(stat_value, metric_value::text),
  stat_description = COALESCE(stat_description, extra::text)
WHERE stat_label IS NULL OR stat_value IS NULL OR stat_description IS NULL;

CREATE INDEX IF NOT EXISTS idx_subcategory_exam_stats_order ON subcategory_exam_stats(display_order);
CREATE INDEX IF NOT EXISTS idx_subcategory_exam_stats_active ON subcategory_exam_stats(is_active);
