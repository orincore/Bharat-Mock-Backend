-- Migration: Add subcategory content management tables
-- Created: 2026-01-26
-- Scope: Enables fully editable SSC subcategory landing pages (overview, updates, highlights, stats, tables, question papers, FAQs, resources)

CREATE TABLE IF NOT EXISTS subcategory_overviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  hero_title VARCHAR(300) NOT NULL,
  hero_subtitle VARCHAR(600),
  hero_description TEXT,
  primary_cta_label VARCHAR(120),
  primary_cta_url VARCHAR(1000),
  secondary_cta_label VARCHAR(120),
  secondary_cta_url VARCHAR(1000),
  stats JSONB DEFAULT '[]', -- array of { label, value }
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subcategory_overview_unique ON subcategory_overviews(subcategory_id);

CREATE TABLE IF NOT EXISTS subcategory_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  title VARCHAR(400) NOT NULL,
  tag VARCHAR(50),
  link_url VARCHAR(1000),
  published_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_updates_subcategory ON subcategory_updates(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_subcategory_updates_order ON subcategory_updates(display_order);

CREATE TABLE IF NOT EXISTS subcategory_highlights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  value VARCHAR(400) NOT NULL,
  icon VARCHAR(100),
  accent_color VARCHAR(50),
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_highlights_subcategory ON subcategory_highlights(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_subcategory_highlights_order ON subcategory_highlights(display_order);

CREATE TABLE IF NOT EXISTS subcategory_exam_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  metric VARCHAR(100) NOT NULL,
  metric_year VARCHAR(10) NOT NULL,
  metric_value NUMERIC,
  extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_exam_stats_subcategory ON subcategory_exam_stats(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_subcategory_exam_stats_metric ON subcategory_exam_stats(metric);

CREATE TABLE IF NOT EXISTS subcategory_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  slug VARCHAR(120) NOT NULL,
  title VARCHAR(300) NOT NULL,
  subtitle VARCHAR(400),
  content TEXT,
  media_url VARCHAR(1000),
  layout_type VARCHAR(80) DEFAULT 'default',
  button_label VARCHAR(120),
  button_url VARCHAR(1000),
  custom_data JSONB DEFAULT '{}'::jsonb,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_sections_subcategory ON subcategory_sections(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_subcategory_sections_slug ON subcategory_sections(subcategory_id, slug);

CREATE TABLE IF NOT EXISTS subcategory_tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  slug VARCHAR(120) NOT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  column_headers JSONB NOT NULL DEFAULT '[]', -- array of column labels
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subcategory_tables_slug ON subcategory_tables(subcategory_id, slug);

CREATE TABLE IF NOT EXISTS subcategory_table_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id UUID NOT NULL REFERENCES subcategory_tables(id) ON DELETE CASCADE,
  row_data JSONB NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subcategory_table_rows_table ON subcategory_table_rows(table_id);

CREATE TABLE IF NOT EXISTS subcategory_question_papers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  year VARCHAR(10) NOT NULL,
  shift VARCHAR(50),
  language VARCHAR(50),
  download_url VARCHAR(1000) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_question_papers_subcategory ON subcategory_question_papers(subcategory_id);

CREATE TABLE IF NOT EXISTS subcategory_faqs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_faqs_subcategory ON subcategory_faqs(subcategory_id);

CREATE TABLE IF NOT EXISTS subcategory_resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcategory_id UUID NOT NULL REFERENCES exam_subcategories(id) ON DELETE CASCADE,
  label VARCHAR(200) NOT NULL,
  description TEXT,
  link_url VARCHAR(1000) NOT NULL,
  icon VARCHAR(80),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subcategory_resources_subcategory ON subcategory_resources(subcategory_id);

-- Trigger to keep updated_at fresh
CREATE TRIGGER update_subcategory_overviews_updated_at BEFORE UPDATE ON subcategory_overviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_updates_updated_at BEFORE UPDATE ON subcategory_updates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_highlights_updated_at BEFORE UPDATE ON subcategory_highlights
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_exam_stats_updated_at BEFORE UPDATE ON subcategory_exam_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_sections_updated_at BEFORE UPDATE ON subcategory_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_tables_updated_at BEFORE UPDATE ON subcategory_tables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_table_rows_updated_at BEFORE UPDATE ON subcategory_table_rows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_question_papers_updated_at BEFORE UPDATE ON subcategory_question_papers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_faqs_updated_at BEFORE UPDATE ON subcategory_faqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcategory_resources_updated_at BEFORE UPDATE ON subcategory_resources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
