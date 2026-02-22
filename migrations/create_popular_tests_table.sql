-- Create table for managing popular tests on exam page
CREATE TABLE IF NOT EXISTS page_popular_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_identifier VARCHAR(100) NOT NULL,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(page_identifier, exam_id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_page_popular_tests_page ON page_popular_tests(page_identifier);
CREATE INDEX IF NOT EXISTS idx_page_popular_tests_order ON page_popular_tests(page_identifier, display_order);
CREATE INDEX IF NOT EXISTS idx_page_popular_tests_active ON page_popular_tests(page_identifier, is_active);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_page_popular_tests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_page_popular_tests_updated_at
  BEFORE UPDATE ON page_popular_tests
  FOR EACH ROW
  EXECUTE FUNCTION update_page_popular_tests_updated_at();

-- Insert comment for documentation
COMMENT ON TABLE page_popular_tests IS 'Stores popular/featured tests for different pages (e.g., exam page)';
COMMENT ON COLUMN page_popular_tests.page_identifier IS 'Identifier for the page (e.g., "exam_page", "home_page")';
COMMENT ON COLUMN page_popular_tests.display_order IS 'Order in which tests should be displayed (lower numbers first)';
