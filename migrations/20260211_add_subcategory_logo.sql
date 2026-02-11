-- Migration: Add logo_url column to exam_subcategories
-- Created: 2026-02-11
-- Description: Allows subcategories to have their own logo for display on homepage

ALTER TABLE exam_subcategories
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN exam_subcategories.logo_url IS 'URL to subcategory logo image stored in R2/CDN';
