-- Migration: Add exam categories, subcategories, difficulties, and slug support
-- Date: 2026-01-22

CREATE TABLE IF NOT EXISTS exam_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    logo_url TEXT,
    icon VARCHAR(100),
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_subcategories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES exam_categories(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(160) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(category_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_exam_subcategories_category ON exam_subcategories(category_id);

CREATE TABLE IF NOT EXISTS exam_difficulties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    level_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_difficulty_check;
ALTER TABLE exams ALTER COLUMN difficulty TYPE VARCHAR(50);

ALTER TABLE exams
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES exam_categories(id),
ADD COLUMN IF NOT EXISTS subcategory_id UUID REFERENCES exam_subcategories(id),
ADD COLUMN IF NOT EXISTS difficulty_id UUID REFERENCES exam_difficulties(id),
ADD COLUMN IF NOT EXISTS slug VARCHAR(255),
ADD COLUMN IF NOT EXISTS url_path TEXT,
ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_slug ON exams(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exams_category_id ON exams(category_id);
CREATE INDEX IF NOT EXISTS idx_exams_subcategory_id ON exams(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_exams_difficulty_id ON exams(difficulty_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_url_path ON exams(url_path) WHERE url_path IS NOT NULL;

COMMENT ON TABLE exam_categories IS 'Top level categories for exams (e.g., Engineering, Medical)';
COMMENT ON TABLE exam_subcategories IS 'Sub categories under each exam category';
COMMENT ON TABLE exam_difficulties IS 'Custom difficulty levels such as Tier I, Tier II';
COMMENT ON COLUMN exams.slug IS 'Custom endpoint/slug for exam URLs';
COMMENT ON COLUMN exams.url_path IS 'Full path in format /category/sub-category/exam-slug';
