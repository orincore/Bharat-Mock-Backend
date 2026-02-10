-- Migration: Create contact_info + contact_social_links for dynamic contact details
-- Date: 2026-02-09

CREATE TABLE IF NOT EXISTS contact_info (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    headline VARCHAR(120) NOT NULL,
    subheading VARCHAR(180),
    description TEXT,
    support_email VARCHAR(160) NOT NULL,
    support_phone VARCHAR(40) NOT NULL,
    whatsapp_number VARCHAR(40),
    address_line1 VARCHAR(160) NOT NULL,
    address_line2 VARCHAR(160),
    city VARCHAR(80),
    state VARCHAR(80),
    postal_code VARCHAR(20),
    country VARCHAR(80),
    support_hours VARCHAR(160),
    map_embed_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_social_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform VARCHAR(40) NOT NULL,
    label VARCHAR(80) NOT NULL,
    url TEXT NOT NULL,
    icon VARCHAR(40),
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    contact_id UUID REFERENCES contact_info(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_social_links_contact
    ON contact_social_links(contact_id, display_order)
    WHERE is_active = TRUE;

INSERT INTO contact_info (
    headline,
    subheading,
    description,
    support_email,
    support_phone,
    whatsapp_number,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    support_hours,
    map_embed_url
) VALUES (
    'Let''s talk about your exam prep',
    'We''re here Monday to Saturday for guidance',
    'Bharat Mock''s learner success team responds within 12 working hours. Reach us through phone, WhatsApp, or drop by our studio office in Bangalore.',
    'support@bharatmock.com',
    '+91 1800-123-4567',
    '+91 90000 12345',
    '91Springboard, Koramangala 4th Block',
    'No. 33, NGH Layout, Industrial Area',
    'Bengaluru',
    'Karnataka',
    '560095',
    'India',
    'Mon - Sat · 9:00 AM to 8:00 PM IST',
    'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3890.3142!2d77.621!3d12.934!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bae15d6318ed5f7%3A0x123456789abcdef!2sBharat%20Mock%20HQ!5e0!3m2!1sen!2sin!4v1700000000000'
) ON CONFLICT DO NOTHING;

INSERT INTO contact_social_links (platform, label, url, icon, display_order, contact_id)
SELECT platform, label, url, icon, display_order, info.id
FROM (
    VALUES
        ('facebook', 'Facebook Community', 'https://facebook.com/bharatmock', 'Facebook', 0),
        ('twitter', 'Twitter Updates', 'https://twitter.com/bharatmock', 'Twitter', 1),
        ('instagram', 'Instagram Stories', 'https://instagram.com/bharatmock', 'Instagram', 2),
        ('linkedin', 'LinkedIn', 'https://linkedin.com/company/bharatmock', 'Linkedin', 3)
) AS seed(platform, label, url, icon, display_order)
CROSS JOIN LATERAL (
    SELECT id FROM contact_info LIMIT 1
) AS info
ON CONFLICT DO NOTHING;
