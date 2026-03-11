-- Migration: Add PDF fields to exams table
-- Description: Add columns for storing English and Hindi PDF URLs for exam papers
-- Date: 2026-03-06

-- Add PDF URL columns to exams table
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS pdf_url_en TEXT,
ADD COLUMN IF NOT EXISTS pdf_url_hi TEXT;

-- Add comments for documentation
COMMENT ON COLUMN exams.pdf_url_en IS 'URL to the English version of the exam PDF';
COMMENT ON COLUMN exams.pdf_url_hi IS 'URL to the Hindi version of the exam PDF';

-- Create index for faster queries when filtering by PDF availability
CREATE INDEX IF NOT EXISTS idx_exams_pdf_en ON exams(pdf_url_en) WHERE pdf_url_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exams_pdf_hi ON exams(pdf_url_hi) WHERE pdf_url_hi IS NOT NULL;
