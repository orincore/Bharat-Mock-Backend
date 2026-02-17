-- Migration: Add subcategory tab configuration
-- Created: 2026-02-15
-- Allows configuring all tabs (including special tabs like Mock Tests, Previous Papers) with custom labels and order

CREATE TABLE IF NOT EXISTS subcategory_tab_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  tab_type VARCHAR(50) NOT NULL CHECK (tab_type IN ('overview', 'mock-tests', 'question-papers', 'custom')),
  tab_label VARCHAR(255) NOT NULL,
  tab_key VARCHAR(200) NOT NULL,
  custom_tab_id UUID REFERENCES subcategory_custom_tabs(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  UNIQUE (subcategory_id, tab_key)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_tab_config_subcategory ON subcategory_tab_config(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_subcategory_tab_config_order ON subcategory_tab_config(display_order);
CREATE INDEX IF NOT EXISTS idx_subcategory_tab_config_type ON subcategory_tab_config(tab_type);

CREATE TRIGGER update_subcategory_tab_config_updated_at 
  BEFORE UPDATE ON subcategory_tab_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE subcategory_tab_config IS 'Configurable tabs for subcategory pages including special tabs (mock tests, previous papers) and custom tabs';
COMMENT ON COLUMN subcategory_tab_config.tab_type IS 'Type of tab: overview, mock-tests, question-papers, or custom';
COMMENT ON COLUMN subcategory_tab_config.tab_label IS 'Display label for the tab (editable)';
COMMENT ON COLUMN subcategory_tab_config.tab_key IS 'URL-friendly key for the tab';
COMMENT ON COLUMN subcategory_tab_config.custom_tab_id IS 'Reference to custom tab if tab_type is custom';
