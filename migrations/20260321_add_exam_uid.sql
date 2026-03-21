-- Migration: Add unique exam_uid column (format: BHMK123456J)
-- Date: 2026-03-21

BEGIN;

-- Add exam_uid column
ALTER TABLE exams ADD COLUMN IF NOT EXISTS exam_uid VARCHAR(12) UNIQUE;

-- Create index for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_exam_uid ON exams(exam_uid) WHERE exam_uid IS NOT NULL;

-- Function to generate a unique exam UID in BHMK######X format
CREATE OR REPLACE FUNCTION generate_exam_uid() RETURNS VARCHAR(12) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result VARCHAR(12);
  num_part TEXT;
  letter_part TEXT;
  attempts INT := 0;
BEGIN
  LOOP
    -- Generate 6 random digits
    num_part := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    -- Generate 1 random uppercase letter (excluding I, O, 0, 1 for clarity)
    letter_part := SUBSTR(chars, FLOOR(RANDOM() * LENGTH(chars) + 1)::INT, 1);
    result := 'BHMK' || num_part || letter_part;
    
    -- Check uniqueness
    IF NOT EXISTS (SELECT 1 FROM exams WHERE exam_uid = result) THEN
      RETURN result;
    END IF;
    
    attempts := attempts + 1;
    IF attempts > 100 THEN
      RAISE EXCEPTION 'Could not generate unique exam_uid after 100 attempts';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill all existing exams that don't have a uid yet
DO $$
DECLARE
  exam_record RECORD;
BEGIN
  FOR exam_record IN SELECT id FROM exams WHERE exam_uid IS NULL ORDER BY created_at LOOP
    UPDATE exams SET exam_uid = generate_exam_uid() WHERE id = exam_record.id;
  END LOOP;
END;
$$;

COMMIT;
