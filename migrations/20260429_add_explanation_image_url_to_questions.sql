-- Migration: Add explanation image URL support for question explanations
-- Created: 2026-04-29

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS explanation_image_url TEXT;

COMMENT ON COLUMN questions.explanation_image_url IS 'Stored URL for explanation image uploaded via admin exam editor';
