-- Migration: Add syllabus column to exams table
-- Date: 2026-01-22

ALTER TABLE exams
ADD COLUMN IF NOT EXISTS syllabus JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN exams.syllabus IS 'Array of syllabus topics stored as JSON';
