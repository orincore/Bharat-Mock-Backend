-- Migration: Add category custom sections
-- Created: 2026-01-26

CREATE TABLE IF NOT EXISTS category_custom_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  subtitle VARCHAR(400),
  content TEXT,
  media_url VARCHAR(1000),
  layout_type VARCHAR(50) DEFAULT 'default',
  icon VARCHAR(100),
  button_label VARCHAR(100),
  button_url VARCHAR(1000),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_category_custom_sections_category ON category_custom_sections(category_id);
CREATE INDEX idx_category_custom_sections_order ON category_custom_sections(display_order);

CREATE TRIGGER update_category_custom_sections_updated_at BEFORE UPDATE ON category_custom_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
