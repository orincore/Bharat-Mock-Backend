-- Create refund policy content table
CREATE TABLE IF NOT EXISTS refund_policy_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    last_updated DATE NOT NULL,
    intro_body TEXT,
    contact_email VARCHAR(255),
    contact_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create refund policy sections table
CREATE TABLE IF NOT EXISTS refund_policy_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create refund policy points table
CREATE TABLE IF NOT EXISTS refund_policy_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id UUID NOT NULL REFERENCES refund_policy_sections(id) ON DELETE CASCADE,
    heading VARCHAR(500),
    body TEXT,
    list_items JSONB,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_refund_policy_sections_display_order ON refund_policy_sections(display_order);
CREATE INDEX IF NOT EXISTS idx_refund_policy_sections_is_active ON refund_policy_sections(is_active);
CREATE INDEX IF NOT EXISTS idx_refund_policy_points_section_id ON refund_policy_points(section_id);
CREATE INDEX IF NOT EXISTS idx_refund_policy_points_display_order ON refund_policy_points(display_order);
CREATE INDEX IF NOT EXISTS idx_refund_policy_points_is_active ON refund_policy_points(is_active);