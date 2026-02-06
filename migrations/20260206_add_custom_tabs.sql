-- Migration: add custom tabs for subcategory page content
-- Created: 2026-02-06
-- Adds subcategory_custom_tabs table and associates page sections with tabs

CREATE TABLE IF NOT EXISTS subcategory_custom_tabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  tab_key VARCHAR(200) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  UNIQUE (subcategory_id, tab_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_tabs_subcategory ON subcategory_custom_tabs(subcategory_id);

ALTER TABLE page_sections
  ADD COLUMN IF NOT EXISTS custom_tab_id UUID REFERENCES subcategory_custom_tabs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_page_sections_custom_tab ON page_sections(custom_tab_id);
