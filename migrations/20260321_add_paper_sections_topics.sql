-- Migration: Add Sections and Topics for Previous Year Papers
-- Date: 2026-03-21
-- Description: Add sections and topics to organize previous year papers directly

BEGIN;

-- Create paper_sections table (e.g., "Tier I", "Tier II", "Prelims", "Mains")
CREATE TABLE IF NOT EXISTS paper_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create paper_topics table (e.g., "2024", "2023", "2022", "General Studies", "Aptitude")
CREATE TABLE IF NOT EXISTS paper_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID REFERENCES paper_sections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add section and topic columns to exams table for previous year papers
ALTER TABLE exams
ADD COLUMN IF NOT EXISTS paper_section_id UUID REFERENCES paper_sections(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS paper_topic_id UUID REFERENCES paper_topics(id) ON DELETE SET NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_paper_sections_order ON paper_sections(display_order);
CREATE INDEX IF NOT EXISTS idx_paper_topics_section ON paper_topics(section_id);
CREATE INDEX IF NOT EXISTS idx_paper_topics_order ON paper_topics(display_order);
CREATE INDEX IF NOT EXISTS idx_exams_paper_section ON exams(paper_section_id);
CREATE INDEX IF NOT EXISTS idx_exams_paper_topic ON exams(paper_topic_id);

COMMENT ON TABLE paper_sections IS 'Sections for organizing previous year papers (e.g., Tier I, Tier II)';
COMMENT ON TABLE paper_topics IS 'Topics within sections for previous year papers (e.g., years, subjects)';

COMMIT;
