-- Migration: Create subscription page content tables
-- Description: Allows admin to edit all content on the subscription landing page

-- Table for subscription page sections (hero, features, benefits, testimonials, etc.)
CREATE TABLE IF NOT EXISTS subscription_page_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key VARCHAR(100) UNIQUE NOT NULL,
  section_type VARCHAR(50) NOT NULL, -- 'hero', 'features', 'benefits', 'testimonials', 'faq', 'pricing_intro', 'cta'
  title TEXT,
  subtitle TEXT,
  description TEXT,
  background_color VARCHAR(50),
  text_color VARCHAR(50),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for subscription page content blocks (individual items within sections)
CREATE TABLE IF NOT EXISTS subscription_page_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID REFERENCES subscription_page_sections(id) ON DELETE CASCADE,
  block_type VARCHAR(50) NOT NULL, -- 'feature_item', 'benefit_item', 'testimonial', 'faq_item', 'stat', 'image', 'text'
  title TEXT,
  content TEXT,
  icon VARCHAR(100),
  image_url TEXT,
  link_url TEXT,
  link_text TEXT,
  display_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for subscription page SEO and meta content
CREATE TABLE IF NOT EXISTS subscription_page_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_title VARCHAR(255),
  meta_description TEXT,
  meta_keywords TEXT,
  og_title VARCHAR(255),
  og_description TEXT,
  og_image TEXT,
  canonical_url TEXT,
  structured_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_subscription_sections_type ON subscription_page_sections(section_type);
CREATE INDEX IF NOT EXISTS idx_subscription_sections_active ON subscription_page_sections(is_active);
CREATE INDEX IF NOT EXISTS idx_subscription_sections_order ON subscription_page_sections(display_order);
CREATE INDEX IF NOT EXISTS idx_subscription_blocks_section ON subscription_page_blocks(section_id);
CREATE INDEX IF NOT EXISTS idx_subscription_blocks_order ON subscription_page_blocks(display_order);

-- Insert default subscription page content
INSERT INTO subscription_page_meta (meta_title, meta_description, meta_keywords)
VALUES (
  'Bharat Mock Premium - Unlock Your Exam Success',
  'Get unlimited access to premium mock tests, personalized analytics, and expert-curated content. Choose your plan and start preparing smarter today.',
  'bharat mock premium, online test preparation, mock tests, exam preparation, subscription plans'
) ON CONFLICT DO NOTHING;

-- Insert default hero section
INSERT INTO subscription_page_sections (section_key, section_type, title, subtitle, description, display_order, settings)
VALUES (
  'hero',
  'hero',
  'Level up with Bharat Mock Premium',
  'Premium Learning',
  'Unlock advanced analytics, unlimited practice tests, and exclusive exam resources curated by experts. Pick a plan and start preparing smarter today.',
  1,
  '{"badge_text": "Premium Learning", "show_badge": true}'
) ON CONFLICT (section_key) DO NOTHING;

-- Insert default features section
INSERT INTO subscription_page_sections (section_key, section_type, title, subtitle, display_order)
VALUES (
  'features',
  'features',
  'Why go Premium?',
  'Every plan unlocks these pro-only benefits.',
  2
) ON CONFLICT (section_key) DO NOTHING;

-- Insert default feature items
DO $$
DECLARE
  features_section_id UUID;
BEGIN
  SELECT id INTO features_section_id FROM subscription_page_sections WHERE section_key = 'features';
  
  IF features_section_id IS NOT NULL THEN
    INSERT INTO subscription_page_blocks (section_id, block_type, title, content, icon, display_order)
    VALUES 
      (features_section_id, 'feature_item', 'Unlimited Mock Tests', 'Access unlimited premium mock tests across all exam categories', 'Sparkles', 1),
      (features_section_id, 'feature_item', 'Personalized Analytics', 'Track your performance with detailed analytics and insights', 'Sparkles', 2),
      (features_section_id, 'feature_item', 'Priority Support', 'Get priority support and early access to new content', 'Sparkles', 3),
      (features_section_id, 'feature_item', 'Detailed Explanations', 'Learn from comprehensive answer explanations and review mode', 'Sparkles', 4)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_subscription_page_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_sections_updated_at
  BEFORE UPDATE ON subscription_page_sections
  FOR EACH ROW
  EXECUTE FUNCTION update_subscription_page_updated_at();

CREATE TRIGGER subscription_blocks_updated_at
  BEFORE UPDATE ON subscription_page_blocks
  FOR EACH ROW
  EXECUTE FUNCTION update_subscription_page_updated_at();

CREATE TRIGGER subscription_meta_updated_at
  BEFORE UPDATE ON subscription_page_meta
  FOR EACH ROW
  EXECUTE FUNCTION update_subscription_page_updated_at();
