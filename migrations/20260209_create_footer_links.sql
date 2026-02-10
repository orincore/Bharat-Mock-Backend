-- Migration: Create footer_links table for dynamic footer sections
-- Date: 2026-02-09

CREATE TABLE IF NOT EXISTS footer_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section VARCHAR(80) NOT NULL DEFAULT 'general',
    section_order INTEGER DEFAULT 0,
    label VARCHAR(80) NOT NULL,
    href TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    open_in_new_tab BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_footer_links_section
    ON footer_links(section, section_order, display_order);

CREATE INDEX IF NOT EXISTS idx_footer_links_active
    ON footer_links(is_active) WHERE deleted_at IS NULL;

COMMENT ON TABLE footer_links IS 'Footer navigation entries grouped by section';
COMMENT ON COLUMN footer_links.section IS 'UI section/group label (e.g., Popular Exams)';
COMMENT ON COLUMN footer_links.section_order IS 'Ordering for footer sections';

-- Seed defaults matching current footer layout
INSERT INTO footer_links (section, section_order, label, href, display_order)
VALUES
    ('Popular Exams', 0, 'JEE Main', '/exams?category=engineering', 0),
    ('Popular Exams', 0, 'NEET', '/exams?category=medical', 1),
    ('Popular Exams', 0, 'CAT', '/exams?category=management', 2),
    ('Popular Exams', 0, 'GATE', '/exams?category=engineering', 3),
    ('Popular Exams', 0, 'UPSC', '/exams?category=civil-services', 4),
    ('Resources', 1, 'Articles', '/blogs', 0),
    ('Resources', 1, 'Courses', '/courses', 1),
    ('Resources', 1, 'Study Material', '/blogs', 2),
    ('Resources', 1, 'Previous Papers', '/exams', 3),
    ('Company', 2, 'About Us', '/about', 0),
    ('Company', 2, 'Contact', '/contact', 1),
    ('Company', 2, 'Careers', '/careers', 2),
    ('Company', 2, 'Privacy Policy', '/privacy', 3),
    ('Company', 2, 'Terms of Service', '/terms', 4)
ON CONFLICT DO NOTHING;
