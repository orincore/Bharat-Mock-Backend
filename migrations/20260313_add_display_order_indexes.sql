-- Migration: Add display_order indexes and ensure proper ordering
-- Date: 2026-03-13
-- Description: Add indexes for display_order columns and ensure all tables have proper ordering support

-- Add display_order column to test_series_sections if it doesn't exist
ALTER TABLE test_series_sections 
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Add display_order column to test_series_topics if it doesn't exist
ALTER TABLE test_series_topics 
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Add display_order column to exams if it doesn't exist
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Update existing records to have proper display_order values
-- For test_series_sections
UPDATE test_series_sections 
SET display_order = subquery.row_number - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY test_series_id ORDER BY created_at) as row_number
  FROM test_series_sections
) AS subquery
WHERE test_series_sections.id = subquery.id
AND test_series_sections.display_order = 0;

-- For test_series_topics
UPDATE test_series_topics 
SET display_order = subquery.row_number - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY section_id ORDER BY created_at) as row_number
  FROM test_series_topics
) AS subquery
WHERE test_series_topics.id = subquery.id
AND test_series_topics.display_order = 0;

-- For exams
UPDATE exams 
SET display_order = subquery.row_number - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY test_series_id ORDER BY created_at) as row_number
  FROM exams
  WHERE test_series_id IS NOT NULL
) AS subquery
WHERE exams.id = subquery.id
AND exams.display_order = 0;

-- Create indexes for better performance on ordering queries
CREATE INDEX IF NOT EXISTS idx_test_series_sections_display_order 
ON test_series_sections(test_series_id, display_order);

CREATE INDEX IF NOT EXISTS idx_test_series_topics_display_order 
ON test_series_topics(section_id, display_order);

CREATE INDEX IF NOT EXISTS idx_exams_display_order 
ON exams(test_series_id, display_order) 
WHERE test_series_id IS NOT NULL;

-- Add constraints to ensure display_order is not null
ALTER TABLE test_series_sections 
ALTER COLUMN display_order SET NOT NULL;

ALTER TABLE test_series_topics 
ALTER COLUMN display_order SET NOT NULL;

ALTER TABLE exams 
ALTER COLUMN display_order SET NOT NULL;

-- Create a function to automatically set display_order for new records
CREATE OR REPLACE FUNCTION set_display_order_for_test_series_sections()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.display_order IS NULL OR NEW.display_order = 0 THEN
    SELECT COALESCE(MAX(display_order), -1) + 1 
    INTO NEW.display_order 
    FROM test_series_sections 
    WHERE test_series_id = NEW.test_series_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_display_order_for_test_series_topics()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.display_order IS NULL OR NEW.display_order = 0 THEN
    SELECT COALESCE(MAX(display_order), -1) + 1 
    INTO NEW.display_order 
    FROM test_series_topics 
    WHERE section_id = NEW.section_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_display_order_for_exams()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.test_series_id IS NOT NULL AND (NEW.display_order IS NULL OR NEW.display_order = 0) THEN
    SELECT COALESCE(MAX(display_order), -1) + 1 
    INTO NEW.display_order 
    FROM exams 
    WHERE test_series_id = NEW.test_series_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically set display_order
DROP TRIGGER IF EXISTS trigger_set_display_order_sections ON test_series_sections;
CREATE TRIGGER trigger_set_display_order_sections
  BEFORE INSERT ON test_series_sections
  FOR EACH ROW
  EXECUTE FUNCTION set_display_order_for_test_series_sections();

DROP TRIGGER IF EXISTS trigger_set_display_order_topics ON test_series_topics;
CREATE TRIGGER trigger_set_display_order_topics
  BEFORE INSERT ON test_series_topics
  FOR EACH ROW
  EXECUTE FUNCTION set_display_order_for_test_series_topics();

DROP TRIGGER IF EXISTS trigger_set_display_order_exams ON exams;
CREATE TRIGGER trigger_set_display_order_exams
  BEFORE INSERT ON exams
  FOR EACH ROW
  EXECUTE FUNCTION set_display_order_for_exams();

-- Add comments for documentation
COMMENT ON COLUMN test_series_sections.display_order IS 'Display order within the test series (0-based)';
COMMENT ON COLUMN test_series_topics.display_order IS 'Display order within the section (0-based)';
COMMENT ON COLUMN exams.display_order IS 'Display order within the test series (0-based)';