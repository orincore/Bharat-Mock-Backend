-- Migration: Align subcategory_overviews columns with new controller fields
-- Created: 2026-01-27
-- Adds the latest hero + metadata columns that the API expects. Keeps legacy columns for backward compatibility so
-- data is not lost, but new nullable columns are used going forward.

ALTER TABLE subcategory_overviews
  ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS cta_primary_text VARCHAR(150),
  ADD COLUMN IF NOT EXISTS cta_primary_url TEXT,
  ADD COLUMN IF NOT EXISTS cta_secondary_text VARCHAR(150),
  ADD COLUMN IF NOT EXISTS cta_secondary_url TEXT,
  ADD COLUMN IF NOT EXISTS stats_json JSONB,
  ADD COLUMN IF NOT EXISTS meta_title VARCHAR(300),
  ADD COLUMN IF NOT EXISTS meta_description TEXT,
  ADD COLUMN IF NOT EXISTS meta_keywords TEXT;

-- Backfill stats_json using legacy `stats` column if present and new field empty
UPDATE subcategory_overviews
SET stats_json = COALESCE(stats_json, stats)
WHERE stats_json IS NULL AND stats IS NOT NULL;
