-- Migration: Add category_id support to page content tables
-- This allows the existing block editor system to work for category pages
-- (in addition to subcategory pages which already use subcategory_id)

-- 1. Add category_id to page_sections
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES exam_categories(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_page_sections_category ON page_sections(category_id);

-- Drop the existing unique constraint on (subcategory_id, section_key) since category pages won't have subcategory_id
ALTER TABLE page_sections DROP CONSTRAINT IF EXISTS page_sections_subcategory_id_section_key_key;

-- Make subcategory_id nullable (it was NOT NULL before)
ALTER TABLE page_sections ALTER COLUMN subcategory_id DROP NOT NULL;

-- 2. Add category_id to page_content_blocks
ALTER TABLE page_content_blocks ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES exam_categories(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_page_blocks_category ON page_content_blocks(category_id);

-- 3. Add category_id to page_media
ALTER TABLE page_media ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES exam_categories(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_page_media_category ON page_media(category_id);

-- 4. Add category_id to page_revisions
ALTER TABLE page_revisions ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES exam_categories(id) ON DELETE CASCADE;
ALTER TABLE page_revisions ALTER COLUMN subcategory_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_page_revisions_category ON page_revisions(category_id);

-- 5. Add category_id to page_seo
ALTER TABLE page_seo ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES exam_categories(id) ON DELETE CASCADE;
ALTER TABLE page_seo DROP CONSTRAINT IF EXISTS page_seo_subcategory_id_key;
-- Re-create unique constraints that allow either subcategory_id or category_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_seo_subcategory_unique ON page_seo(subcategory_id) WHERE subcategory_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_seo_category_unique ON page_seo(category_id) WHERE category_id IS NOT NULL;

-- 6. Create category_custom_tabs table (parallel to subcategory_custom_tabs)
CREATE TABLE IF NOT EXISTS category_custom_tabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  tab_key VARCHAR(200) NOT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_category_custom_tabs_category ON category_custom_tabs(category_id);
CREATE INDEX IF NOT EXISTS idx_category_custom_tabs_order ON category_custom_tabs(display_order);

CREATE TRIGGER update_category_custom_tabs_updated_at BEFORE UPDATE ON category_custom_tabs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Add custom_tab_id reference for category tabs in page_sections
-- (The existing custom_tab_id column references subcategory_custom_tabs;
--  we add a separate column for category custom tabs)
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS category_custom_tab_id UUID REFERENCES category_custom_tabs(id) ON DELETE SET NULL;

COMMENT ON TABLE category_custom_tabs IS 'Custom tabs for category pages, parallel to subcategory_custom_tabs';
