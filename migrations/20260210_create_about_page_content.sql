-- Migration: Create About page dynamic content tables
-- Date: 2026-02-10

CREATE TABLE IF NOT EXISTS about_page_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hero_heading VARCHAR(160) NOT NULL,
    hero_subheading VARCHAR(220),
    hero_description TEXT,
    hero_badge VARCHAR(120),
    mission_heading VARCHAR(160),
    mission_body TEXT,
    story_heading VARCHAR(160),
    story_body TEXT,
    impact_heading VARCHAR(160),
    impact_body TEXT,
    offerings_heading VARCHAR(160),
    offerings_body TEXT,
    cta_label VARCHAR(120),
    cta_href VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS about_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(120) NOT NULL,
    description TEXT,
    icon VARCHAR(60) DEFAULT 'star',
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS about_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label VARCHAR(120) NOT NULL,
    value VARCHAR(60) NOT NULL,
    helper_text VARCHAR(160),
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS about_offerings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(120) NOT NULL,
    description TEXT,
    icon VARCHAR(60) DEFAULT 'sparkles',
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_about_values_display
    ON about_values(display_order)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_about_stats_display
    ON about_stats(display_order)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_about_offerings_display
    ON about_offerings(display_order)
    WHERE is_active = TRUE;

INSERT INTO about_page_content (
    hero_heading,
    hero_subheading,
    hero_description,
    hero_badge,
    mission_heading,
    mission_body,
    story_heading,
    story_body,
    impact_heading,
    impact_body,
    offerings_heading,
    offerings_body,
    cta_label,
    cta_href
) VALUES (
    'India''s exam prep partner for ambitious students',
    'Bharat Mock is building an equitable learning runway for every aspirant.',
    'From metro cities to tier-3 towns, we deliver premium mock exams, analytics, and mentorship so that talent is limited only by imagination—not geography.',
    'Trusted by 1.2M+ learners',
    'Mission-first, student-obsessed',
    'Democratize quality preparation through immersive mock exams, local-language support, and data-backed guidance that keeps students confident through every milestone.',
    'From a small Discord group to a nationwide platform',
    'We launched in 2020 with a community of 50 aspirants. Today, Bharat Mock powers learning journeys for students targeting JEE, NEET, UPSC, SSC, Banking, and more. Our team blends educators, engineers, and designers who obsess over every exam-day detail.',
    'Impact that compounds every season',
    'Learners clock 6M+ practice hours on the platform annually, saving an average of ₹18,000 compared to offline coaching while accessing richer analytics and continuous mentorship.',
    'What makes us different',
    'Beyond question banks, we deliver structured programs—mock marathons, crash rooms, and doubt clinics—that mimic the adrenaline of the real exam hall.',
    'Meet our leadership',
    '/contact'
) ON CONFLICT DO NOTHING;

INSERT INTO about_values (title, description, icon, display_order)
VALUES
    ('Student Obsession', 'Every product decision begins with learner interviews, not vanity metrics.', 'users', 0),
    ('Academic Rigor', 'Question banks are authored and reviewed by toppers, teachers, and psychometricians.', 'book-open', 1),
    ('Rapid Iteration', 'Weekly product sprints let us ship faster than legacy coaching players.', 'zap', 2),
    ('Inclusive Access', 'Scholarships, Hindi-first content, and low-bandwidth modes keep prep accessible.', 'heart-handshake', 3)
ON CONFLICT DO NOTHING;

INSERT INTO about_stats (label, value, helper_text, display_order)
VALUES
    ('Active Learners', '1.2M+', 'across 28 states', 0),
    ('Mock Tests Delivered', '7.5M', 'and counting since 2020', 1),
    ('Scholarship Grants', '₹3.4 Cr', 'awarded to deserving aspirants', 2),
    ('Partner Institutes', '250+', 'co-creating programs and bootcamps', 3)
ON CONFLICT DO NOTHING;

INSERT INTO about_offerings (title, description, icon, display_order)
VALUES
    ('Adaptive Mock Rooms', 'Timed simulations with AI invigilation keep practice authentic and disciplined.', 'clock', 0),
    ('Personalized Analytics', 'Gap analysis, percentile charts, and confidence meters unlock smarter revision.', 'bar-chart-3', 1),
    ('Mentor Hotline', 'Certified mentors answer strategy questions via chat, voice notes, or weekly AMAs.', 'message-circle', 2),
    ('College & Career Navigator', 'One-click guidance on cut-offs, application timelines, and financial planning.', 'map', 3)
ON CONFLICT DO NOTHING;
