-- Migration: Page Content Management System (WordPress-like Block Editor)
-- Created: 2026-01-30
-- Description: Complete CMS for creating dynamic pages with block-based content editor

-- Page Content Blocks Table (Core block system)
CREATE TABLE IF NOT EXISTS page_content_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  block_type VARCHAR(50) NOT NULL CHECK (block_type IN (
    'heading', 'paragraph', 'list', 'table', 'image', 'chart', 
    'quote', 'code', 'divider', 'button', 'accordion', 'tabs',
    'card', 'alert', 'video', 'embed', 'html', 'columns', 'spacer'
  )),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  display_order INTEGER DEFAULT 0,
  parent_block_id UUID REFERENCES page_content_blocks(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_page_blocks_subcategory ON page_content_blocks(subcategory_id);
CREATE INDEX idx_page_blocks_type ON page_content_blocks(block_type);
CREATE INDEX idx_page_blocks_order ON page_content_blocks(display_order);
CREATE INDEX idx_page_blocks_parent ON page_content_blocks(parent_block_id);

-- Page Sections Table (Grouping blocks into sections)
CREATE TABLE IF NOT EXISTS page_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  section_key VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL,
  subtitle VARCHAR(500),
  icon VARCHAR(100),
  background_color VARCHAR(50),
  text_color VARCHAR(50),
  display_order INTEGER DEFAULT 0,
  is_collapsible BOOLEAN DEFAULT false,
  is_expanded BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  UNIQUE(subcategory_id, section_key)
);

CREATE INDEX idx_page_sections_subcategory ON page_sections(subcategory_id);
CREATE INDEX idx_page_sections_order ON page_sections(display_order);

-- Link blocks to sections
ALTER TABLE page_content_blocks ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES page_sections(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_page_blocks_section ON page_content_blocks(section_id);

-- Page Media Library
CREATE TABLE IF NOT EXISTS page_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  alt_text VARCHAR(500),
  caption TEXT,
  width INTEGER,
  height INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_page_media_subcategory ON page_media(subcategory_id);
CREATE INDEX idx_page_media_type ON page_media(file_type);

-- Page Templates (Predefined layouts)
CREATE TABLE IF NOT EXISTS page_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL UNIQUE,
  description TEXT,
  template_data JSONB NOT NULL,
  preview_image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Page Revisions (Version control)
CREATE TABLE IF NOT EXISTS page_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  content_snapshot JSONB NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_page_revisions_subcategory ON page_revisions(subcategory_id);
CREATE INDEX idx_page_revisions_number ON page_revisions(revision_number DESC);

-- Page SEO Settings
CREATE TABLE IF NOT EXISTS page_seo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID UNIQUE NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  meta_title VARCHAR(300),
  meta_description TEXT,
  meta_keywords TEXT,
  og_title VARCHAR(300),
  og_description TEXT,
  og_image_url TEXT,
  canonical_url TEXT,
  robots_meta VARCHAR(100),
  structured_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Page Analytics
CREATE TABLE IF NOT EXISTS page_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  view_date DATE NOT NULL,
  page_views INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  avg_time_on_page INTEGER DEFAULT 0,
  bounce_rate DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subcategory_id, view_date)
);

CREATE INDEX idx_page_analytics_subcategory ON page_analytics(subcategory_id);
CREATE INDEX idx_page_analytics_date ON page_analytics(view_date DESC);

-- Update triggers
CREATE TRIGGER update_page_content_blocks_updated_at BEFORE UPDATE ON page_content_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_page_sections_updated_at BEFORE UPDATE ON page_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_page_templates_updated_at BEFORE UPDATE ON page_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_page_seo_updated_at BEFORE UPDATE ON page_seo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_page_analytics_updated_at BEFORE UPDATE ON page_analytics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE page_content_blocks IS 'WordPress-like block system for page content';
COMMENT ON TABLE page_sections IS 'Sections to group blocks together';
COMMENT ON TABLE page_media IS 'Media library for images, videos, and files';
COMMENT ON TABLE page_templates IS 'Predefined page templates';
COMMENT ON TABLE page_revisions IS 'Version control for page content';
COMMENT ON TABLE page_seo IS 'SEO metadata for pages';
COMMENT ON TABLE page_analytics IS 'Page view analytics';

-- Sample block content structures (for reference):
/*
HEADING BLOCK:
{
  "text": "SSC CGL 2024 Notification",
  "level": 1,
  "alignment": "left",
  "color": "#000000"
}

PARAGRAPH BLOCK:
{
  "text": "The Staff Selection Commission...",
  "alignment": "left",
  "fontSize": "16px"
}

LIST BLOCK:
{
  "type": "unordered",
  "items": ["Item 1", "Item 2", "Item 3"]
}

TABLE BLOCK:
{
  "headers": ["Event", "Date", "Status"],
  "rows": [
    ["Application Start", "01-01-2024", "Completed"],
    ["Application End", "31-01-2024", "Upcoming"]
  ],
  "hasHeader": true,
  "striped": true
}

IMAGE BLOCK:
{
  "url": "https://...",
  "alt": "SSC CGL Logo",
  "caption": "Official logo",
  "width": "100%",
  "alignment": "center"
}

CHART BLOCK:
{
  "chartType": "bar",
  "data": {
    "labels": ["2020", "2021", "2022"],
    "datasets": [{
      "label": "Applicants",
      "data": [100000, 120000, 150000]
    }]
  },
  "options": {}
}

ACCORDION BLOCK:
{
  "items": [
    {
      "title": "What is SSC CGL?",
      "content": "SSC CGL is..."
    }
  ]
}

BUTTON BLOCK:
{
  "text": "Apply Now",
  "url": "/apply",
  "variant": "primary",
  "size": "large"
}
*/
