-- Testimonials table for user-submitted feedback displayed on /exams page
CREATE TABLE IF NOT EXISTS testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(150),
  content TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  highlight BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_testimonials_published_rating
  ON testimonials (is_published DESC, highlight DESC, rating DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_testimonials_user
  ON testimonials (user_id);

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

COMMENT ON TABLE testimonials IS 'Stores user testimonials with ratings for display on exams page';
COMMENT ON COLUMN testimonials.highlight IS 'If true, testimonial can be pinned/promoted in listings';
COMMENT ON COLUMN testimonials.is_published IS 'Controls public visibility of a testimonial';
