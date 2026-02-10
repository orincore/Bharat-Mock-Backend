-- Migration: Create navigation_links table for configurable header
-- Date: 2026-02-09

CREATE TABLE IF NOT EXISTS navigation_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX IF NOT EXISTS idx_navigation_links_display_order
    ON navigation_links(display_order, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_navigation_links_active
    ON navigation_links(is_active) WHERE deleted_at IS NULL;

COMMENT ON TABLE navigation_links IS 'Primary navigation items for the public site header';
COMMENT ON COLUMN navigation_links.href IS 'Absolute or relative URL to navigate to';

-- Seed default links to preserve existing header experience
INSERT INTO navigation_links (label, href, display_order)
VALUES
    ('Home', '/', 0),
    ('Live Tests', '/live-tests', 1),
    ('Exams', '/exams', 2),
    ('Courses', '/courses', 3),
    ('Blogs', '/blogs', 4)
ON CONFLICT DO NOTHING;
