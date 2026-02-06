-- Migration: Create homepage_hero table for editable homepage hero section
-- Created: 2026-02-05

CREATE TABLE IF NOT EXISTS homepage_hero (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug TEXT UNIQUE NOT NULL,
    title VARCHAR(255),
    subtitle TEXT,
    description TEXT,
    cta_primary_text VARCHAR(120),
    cta_primary_url TEXT,
    cta_secondary_text VARCHAR(120),
    cta_secondary_url TEXT,
    media_layout VARCHAR(50) DEFAULT 'single',
    background_video_url TEXT,
    media_items JSONB DEFAULT '[]'::jsonb,
    meta_title VARCHAR(300),
    meta_description TEXT,
    meta_keywords TEXT,
    og_title VARCHAR(300),
    og_description TEXT,
    og_image_url TEXT,
    canonical_url TEXT,
    robots_meta VARCHAR(50) DEFAULT 'index,follow',
    is_published BOOLEAN DEFAULT TRUE,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_homepage_hero_slug ON homepage_hero(slug);

CREATE OR REPLACE FUNCTION update_homepage_hero_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS trg_homepage_hero_updated_at ON homepage_hero;
CREATE TRIGGER trg_homepage_hero_updated_at
BEFORE UPDATE ON homepage_hero
FOR EACH ROW
EXECUTE FUNCTION update_homepage_hero_updated_at();

INSERT INTO homepage_hero (slug, title, description, media_items)
VALUES (
    'default',
    'Your Personal Government Exam Guide',
    'Start your journey with us. Your tests, exams, quizzes, and the latest government exam updates in one place.',
    '[]'
)
ON CONFLICT (slug) DO NOTHING;
