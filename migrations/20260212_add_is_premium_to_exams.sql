-- Add is_premium column to exams table
ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;

-- Index for filtering premium exams
CREATE INDEX IF NOT EXISTS idx_exams_is_premium ON exams (is_premium);
