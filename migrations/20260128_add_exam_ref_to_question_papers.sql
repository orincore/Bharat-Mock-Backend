-- Migration: Add exam_id reference to subcategory_question_papers
-- Created: 2026-01-28
-- Purpose: Allow linking existing exams as previous year question papers

-- Add exam_id column to reference exams table
ALTER TABLE subcategory_question_papers
ADD COLUMN IF NOT EXISTS exam_id UUID REFERENCES exams(id) ON DELETE SET NULL;

-- Add title column for custom titles when not using exam reference
ALTER TABLE subcategory_question_papers
ADD COLUMN IF NOT EXISTS title VARCHAR(400);

-- Add paper_type column for categorization (e.g., "Tier 1", "Tier 2", "Mains", "Prelims")
ALTER TABLE subcategory_question_papers
ADD COLUMN IF NOT EXISTS paper_type VARCHAR(100);

-- Add file_url for direct file links
ALTER TABLE subcategory_question_papers
ADD COLUMN IF NOT EXISTS file_url VARCHAR(1000);

-- Add is_active flag
ALTER TABLE subcategory_question_papers
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Create index for exam_id lookups
CREATE INDEX IF NOT EXISTS idx_subcategory_question_papers_exam ON subcategory_question_papers(exam_id);

-- Update existing records to set is_active to true if null
UPDATE subcategory_question_papers SET is_active = true WHERE is_active IS NULL;

-- Make year nullable since we can derive it from exam metadata
ALTER TABLE subcategory_question_papers
ALTER COLUMN year DROP NOT NULL;

-- Make download_url nullable since exam might provide attempt URL instead
ALTER TABLE subcategory_question_papers
ALTER COLUMN download_url DROP NOT NULL;
