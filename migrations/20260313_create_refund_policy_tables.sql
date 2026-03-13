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

-- Insert default refund policy content
INSERT INTO refund_policy_content (title, last_updated, intro_body, contact_email, contact_url)
VALUES (
    'Refund Policy',
    '2026-02-09',
    'Thank you for purchasing from Bharat Mock. If, for any reason, you are not completely satisfied with your purchase, please review our Refund Policy. This policy applies to all purchases made on our website.',
    'info@bharatmock.com',
    'https://bharatmock.com/'
) ON CONFLICT DO NOTHING;

-- Insert default refund policy sections and points
DO $$
DECLARE
    interpretation_section_id UUID;
    eligibility_section_id UUID;
    non_refundable_section_id UUID;
    process_section_id UUID;
    contact_section_id UUID;
BEGIN
    -- Insert sections one by one to get their IDs
    INSERT INTO refund_policy_sections (title, description, display_order, is_active)
    VALUES ('Interpretation and Definitions', 'Key terms and their meanings for this refund policy', 0, true)
    RETURNING id INTO interpretation_section_id;

    INSERT INTO refund_policy_sections (title, description, display_order, is_active)
    VALUES ('Refund Eligibility', 'Conditions under which refunds may be granted', 1, true)
    RETURNING id INTO eligibility_section_id;

    INSERT INTO refund_policy_sections (title, description, display_order, is_active)
    VALUES ('Non-Refundable Cases', 'Situations where refunds will not be provided', 2, true)
    RETURNING id INTO non_refundable_section_id;

    INSERT INTO refund_policy_sections (title, description, display_order, is_active)
    VALUES ('Refund Process', 'How to request and process refunds', 3, true)
    RETURNING id INTO process_section_id;

    INSERT INTO refund_policy_sections (title, description, display_order, is_active)
    VALUES ('Contact Us', 'How to reach us for refund-related queries', 4, true)
    RETURNING id INTO contact_section_id;

    -- Insert points for Interpretation and Definitions
    INSERT INTO refund_policy_points (section_id, heading, body, list_items, display_order, is_active)
    VALUES 
        (interpretation_section_id, 'Interpretation', 'The words whose initial letters are capitalized have meanings defined under the following conditions. These definitions shall have the same meaning whether they appear in singular or plural.', '[]'::jsonb, 0, true),
        (interpretation_section_id, 'Definitions', 'For the purposes of this Refund Policy:', '[
            {"term": "Company", "text": "(referred to as \"the Company\", \"We\", \"Us\", or \"Our\") refers to Bharat Mock."},
            {"term": "Service", "text": "refers to the Website and online educational platform."},
            {"term": "Website", "text": "refers to Bharat Mock, accessible from https://bharatmock.com/"},
            {"term": "Orders", "text": "mean a request by You to purchase any course, test series, subscription, or digital content from Us."},
            {"term": "Digital Products", "text": "refer to online mock tests, courses, subscriptions, or any educational material provided through the website."},
            {"term": "You", "text": "means the individual accessing or using the Service, or the company, or other legal entity on behalf of which such individual is accessing or using the Service."}
        ]'::jsonb, 1, true);

    -- Insert points for Refund Eligibility
    INSERT INTO refund_policy_points (section_id, heading, body, list_items, display_order, is_active)
    VALUES 
        (eligibility_section_id, 'Since Bharat Mock provides digital educational content, refunds are subject to the following conditions:', '', '[
            "You may request a refund within 7 days from the date of purchase.",
            "Refund requests must be made by contacting us through the email provided below.",
            "Refund will only be granted if the request is genuine and within the allowed time period."
        ]'::jsonb, 0, true),
        (eligibility_section_id, 'We reserve the right to refuse a refund if:', '', '[
            "The request is made after 7 days from purchase.",
            "The course / test series / subscription has been significantly used.",
            "The purchase was made during a discount, offer, or promotional sale (unless required by law).",
            "The account shows suspicious or abusive activity."
        ]'::jsonb, 1, true);

    -- Insert points for Non-Refundable Cases
    INSERT INTO refund_policy_points (section_id, heading, body, list_items, display_order, is_active)
    VALUES 
        (non_refundable_section_id, 'Refunds will NOT be provided in the following situations:', '', '[
            "After 7 days from purchase",
            "For discounted or promotional purchases",
            "For partially used subscriptions or test series",
            "For technical issues not caused by our platform",
            "If the user violates our Terms of Service"
        ]'::jsonb, 0, true);

    -- Insert points for Refund Process
    INSERT INTO refund_policy_points (section_id, heading, body, list_items, display_order, is_active)
    VALUES 
        (process_section_id, 'To request a refund, you must send a clear request including:', '', '[
            "Your registered email ID",
            "Order details",
            "Reason for refund"
        ]'::jsonb, 0, true),
        (process_section_id, 'You can request a refund by:', '', '[
            "Email: info@bharatmock.com",
            "Website: https://bharatmock.com/"
        ]'::jsonb, 1, true),
        (process_section_id, 'Processing', 'If approved, the refund will be processed within 7–14 business days using the original payment method.', '[]'::jsonb, 2, true);

    -- Insert points for Contact Us
    INSERT INTO refund_policy_points (section_id, heading, body, list_items, display_order, is_active)
    VALUES 
        (contact_section_id, 'If you have any questions about our Refund Policy, you can contact us:', '', '[
            "Email: info@bharatmock.com",
            "Website: https://bharatmock.com/"
        ]'::jsonb, 0, true);
END $$;