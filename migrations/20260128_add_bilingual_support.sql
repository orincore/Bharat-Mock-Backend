-- Migration: Add bilingual (English/Hindi) support to exam sections, questions, and options
-- Created: 2026-01-28

-- Add Hindi language fields to exam_sections
ALTER TABLE exam_sections 
ADD COLUMN IF NOT EXISTS name_hi TEXT;

COMMENT ON COLUMN exam_sections.name_hi IS 'Section name in Hindi';

-- Add Hindi language fields to questions
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS text_hi TEXT,
ADD COLUMN IF NOT EXISTS explanation_hi TEXT;

COMMENT ON COLUMN questions.text_hi IS 'Question text in Hindi';
COMMENT ON COLUMN questions.explanation_hi IS 'Question explanation in Hindi';

-- Add Hindi language fields to question_options
ALTER TABLE question_options 
ADD COLUMN IF NOT EXISTS option_text_hi TEXT;

COMMENT ON COLUMN question_options.option_text_hi IS 'Option text in Hindi';

-- Add language support flag to exams table
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS supports_hindi BOOLEAN DEFAULT false;

COMMENT ON COLUMN exams.supports_hindi IS 'Whether this exam has Hindi translations available';

-- Create index for Hindi-enabled exams
CREATE INDEX IF NOT EXISTS idx_exams_supports_hindi ON exams(supports_hindi) WHERE supports_hindi = true;
