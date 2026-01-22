-- Migration: Ensure sections table exists with correct name
-- Date: 2026-01-22

-- Check if exam_sections exists, if not create sections table
-- The schema uses exam_sections but code references sections
-- Create sections table as alias/view or ensure both work

-- Option 1: Create sections table if it doesn't exist (matching code expectations)
CREATE TABLE IF NOT EXISTS sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    total_questions INTEGER NOT NULL,
    marks_per_question DECIMAL(5,2) NOT NULL,
    duration INTEGER,
    section_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_sections_exam_id ON sections(exam_id);
CREATE INDEX IF NOT EXISTS idx_sections_order ON sections(exam_id, section_order);

-- Add comments
COMMENT ON TABLE sections IS 'Exam sections for organizing questions';
COMMENT ON COLUMN sections.exam_id IS 'Reference to parent exam';
COMMENT ON COLUMN sections.section_order IS 'Display order of section in exam';
