-- Drop existing testimonials table and recreate for admin-only testimonials
-- Admin curates testimonials with name, profile photo, review, and exam reference

DROP TABLE IF EXISTS testimonials CASCADE;

-- Create new testimonials table (admin-managed only)
CREATE TABLE testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  profile_photo_url TEXT,
  review TEXT NOT NULL,
  exam VARCHAR(255),
  highlight BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX idx_testimonials_published_highlight
  ON testimonials (is_published DESC, highlight DESC, display_order ASC, created_at DESC);

CREATE INDEX idx_testimonials_display_order
  ON testimonials (display_order ASC, created_at DESC);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_testimonials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_testimonials_updated_at
  BEFORE UPDATE ON testimonials
  FOR EACH ROW
  EXECUTE FUNCTION update_testimonials_updated_at();

-- Comments
COMMENT ON TABLE testimonials IS 'Admin-curated testimonials with profile photos stored in Cloudflare R2';
COMMENT ON COLUMN testimonials.name IS 'Name of the person giving testimonial';
COMMENT ON COLUMN testimonials.profile_photo_url IS 'URL to profile photo stored in Cloudflare R2';
COMMENT ON COLUMN testimonials.review IS 'Testimonial content/review text';
COMMENT ON COLUMN testimonials.exam IS 'Exam attempted or related to testimonial';
COMMENT ON COLUMN testimonials.highlight IS 'If true, testimonial is featured/promoted';
COMMENT ON COLUMN testimonials.is_published IS 'Controls public visibility';
COMMENT ON COLUMN testimonials.display_order IS 'Manual ordering for testimonials (lower = higher priority)';
