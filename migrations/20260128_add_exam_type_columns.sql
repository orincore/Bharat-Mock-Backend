-- Migration: Add exam_type and show_in_mock_tests columns to exams table
-- Created: 2026-01-28

-- Add exam_type column with enum values
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS exam_type VARCHAR(50) DEFAULT 'mock_test' CHECK (exam_type IN ('past_paper', 'mock_test', 'short_quiz'));

-- Add show_in_mock_tests column for past papers that should also appear in mock tests
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS show_in_mock_tests BOOLEAN DEFAULT false;

-- Create index for filtering by exam_type
CREATE INDEX IF NOT EXISTS idx_exams_exam_type ON exams(exam_type);

-- Create composite index for filtering by exam_type and show_in_mock_tests
CREATE INDEX IF NOT EXISTS idx_exams_type_show_mock ON exams(exam_type, show_in_mock_tests);

-- Update existing exams to have default exam_type
UPDATE exams SET exam_type = 'mock_test' WHERE exam_type IS NULL;

-- Add comment
COMMENT ON COLUMN exams.exam_type IS 'Type of exam: past_paper, mock_test, or short_quiz';
COMMENT ON COLUMN exams.show_in_mock_tests IS 'For past_paper type: whether to also display in mock tests section';
