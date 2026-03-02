-- Migration: Add Test Series functionality
-- Date: 2026-03-02
-- Description: Add test series, sections, topics, and exam date fields

BEGIN;

-- Create test_series table
CREATE TABLE IF NOT EXISTS test_series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    slug VARCHAR(255) UNIQUE,
    category_id UUID REFERENCES exam_categories(id),
    subcategory_id UUID REFERENCES exam_subcategories(id),
    difficulty_id UUID REFERENCES exam_difficulties(id),
    total_tests INTEGER DEFAULT 0,
    total_attempts INTEGER DEFAULT 0,
    logo_url TEXT,
    thumbnail_url TEXT,
    is_published BOOLEAN DEFAULT FALSE,
    is_free BOOLEAN DEFAULT TRUE,
    price DECIMAL(10,2) DEFAULT 0.00,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create test_series_sections table (for organizing exams within a test series)
CREATE TABLE IF NOT EXISTS test_series_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_series_id UUID REFERENCES test_series(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create test_series_topics table (for further categorization within sections)
CREATE TABLE IF NOT EXISTS test_series_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID REFERENCES test_series_sections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add test series related fields to exams table
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS is_test_series BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS test_series_id UUID REFERENCES test_series(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS test_series_section_id UUID REFERENCES test_series_sections(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS test_series_topic_id UUID REFERENCES test_series_topics(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS exam_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_test_series_category ON test_series(category_id);
CREATE INDEX IF NOT EXISTS idx_test_series_subcategory ON test_series(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_test_series_difficulty ON test_series(difficulty_id);
CREATE INDEX IF NOT EXISTS idx_test_series_slug ON test_series(slug);
CREATE INDEX IF NOT EXISTS idx_test_series_published ON test_series(is_published);

CREATE INDEX IF NOT EXISTS idx_test_series_sections_series ON test_series_sections(test_series_id);
CREATE INDEX IF NOT EXISTS idx_test_series_sections_order ON test_series_sections(display_order);

CREATE INDEX IF NOT EXISTS idx_test_series_topics_section ON test_series_topics(section_id);
CREATE INDEX IF NOT EXISTS idx_test_series_topics_order ON test_series_topics(display_order);

CREATE INDEX IF NOT EXISTS idx_exams_test_series ON exams(test_series_id);
CREATE INDEX IF NOT EXISTS idx_exams_test_series_section ON exams(test_series_section_id);
CREATE INDEX IF NOT EXISTS idx_exams_test_series_topic ON exams(test_series_topic_id);
CREATE INDEX IF NOT EXISTS idx_exams_exam_date ON exams(exam_date);
CREATE INDEX IF NOT EXISTS idx_exams_is_test_series ON exams(is_test_series);

-- Add comments for documentation
COMMENT ON TABLE test_series IS 'Test series that group multiple exams together';
COMMENT ON TABLE test_series_sections IS 'Sections within a test series (e.g., Full Test, Sectional Test, Previous Year Paper)';
COMMENT ON TABLE test_series_topics IS 'Topics within sections for further categorization';
COMMENT ON COLUMN exams.is_test_series IS 'Flag to indicate if exam is part of a test series';
COMMENT ON COLUMN exams.test_series_id IS 'Reference to parent test series';
COMMENT ON COLUMN exams.test_series_section_id IS 'Reference to section within test series';
COMMENT ON COLUMN exams.test_series_topic_id IS 'Reference to topic within section';
COMMENT ON COLUMN exams.exam_date IS 'Scheduled date for the exam (for sorting and display)';

COMMIT;
