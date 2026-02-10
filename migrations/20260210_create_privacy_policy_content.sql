-- Migration: Create privacy policy dynamic tables
-- Date: 2026-02-10

CREATE TABLE IF NOT EXISTS privacy_policy_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    last_updated DATE NOT NULL,
    intro_body TEXT,
    contact_email VARCHAR(160),
    contact_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS privacy_policy_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS privacy_policy_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID REFERENCES privacy_policy_sections(id) ON DELETE CASCADE,
    heading VARCHAR(200),
    body TEXT,
    list_items JSONB,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_policy_sections_display
    ON privacy_policy_sections(display_order)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_privacy_policy_points_section
    ON privacy_policy_points(section_id, display_order)
    WHERE is_active = TRUE;

INSERT INTO privacy_policy_content (
    title,
    last_updated,
    intro_body,
    contact_email,
    contact_url
) VALUES (
    'Privacy Policy',
    '2026-02-09',
    'This Privacy Policy describes Our policies and procedures on the collection, use and disclosure of Your information when You use the Service and tells You about Your privacy rights and how the law protects You. We use Your Personal Data to provide and improve the Service. By using the Service, You agree to the collection and use of information in accordance with this Privacy Policy.',
    'info@bharatmock.com',
    'https://bharatmock.com/'
) ON CONFLICT DO NOTHING;

WITH section_seed AS (
    SELECT * FROM (
        VALUES
            ('Interpretation and Definitions', 'The words whose initial letters are capitalized have meanings defined under the following conditions. The following definitions shall have the same meaning regardless of whether they appear in singular or in plural.'),
            ('Definitions', 'For the purposes of this Privacy Policy, the following terms apply.'),
            ('Collecting and Using Your Personal Data', 'Overview of the categories of data we collect and how we use tracking technologies.'),
            ('Use of Your Personal Data', 'How Bharat Mock relies on Personal Data to provide and improve the Service.'),
            ('Retention of Your Personal Data', 'Retention schedules for different categories of information and how long we hold it.'),
            ('Transfer of Your Personal Data', 'How cross-border transfers and safeguards are handled.'),
            ('Delete Your Personal Data', 'Options for deleting or requesting deletion of your data.'),
            ('Disclosure of Your Personal Data', 'Circumstances where we may disclose information to third parties.'),
            ('Security of Your Personal Data', 'Steps we take to secure your information and related limitations.'),
            ('Children''s Privacy', 'Our practices for individuals under the age of 16 and how to contact us about inadvertent collection.'),
            ('Links to Other Websites', 'Responsibilities regarding third-party sites we link to.'),
            ('Changes to this Privacy Policy', 'How we communicate updates to this statement.'),
            ('Contact Us', 'How to reach Bharat Mock for privacy-related questions.')
    ) AS s(title, description)
)
INSERT INTO privacy_policy_sections (title, description, display_order)
SELECT title, description, ROW_NUMBER() OVER (ORDER BY title)
FROM section_seed
ON CONFLICT DO NOTHING;

WITH points AS (
    SELECT s.id AS section_id, p.display_order, p.heading, p.body, p.list_items
    FROM privacy_policy_sections s
    JOIN (
        VALUES
            ('Interpretation and Definitions', 0, 'Interpretation', 'The words whose initial letters are capitalized have meanings defined under the following conditions.', NULL),
            ('Interpretation and Definitions', 1, 'Usage', 'The following definitions shall have the same meaning regardless of whether they appear in singular or in plural.', NULL),
            ('Definitions', 0, 'Defined Terms', NULL, jsonb_build_array(
                jsonb_build_object('term', 'Account', 'text', 'A unique account created for You to access our Service or parts of our Service.'),
                jsonb_build_object('term', 'Affiliate', 'text', 'An entity that controls, is controlled by, or is under common control with a party.'),
                jsonb_build_object('term', 'Company', 'text', 'Bharat Mock is referred to as the Company, We, Us or Our within this Privacy Policy.'),
                jsonb_build_object('term', 'Cookies', 'text', 'Small files placed on Your device containing details of Your browsing history.'),
                jsonb_build_object('term', 'Country', 'text', 'Maharashtra, India.'),
                jsonb_build_object('term', 'Device', 'text', 'Any device that can access the Service such as a computer, cell phone or digital tablet.'),
                jsonb_build_object('term', 'Personal Data', 'text', 'Any information that relates to an identified or identifiable individual.'),
                jsonb_build_object('term', 'Service', 'text', 'The Bharat Mock website and related offerings.'),
                jsonb_build_object('term', 'Service Provider', 'text', 'Any natural or legal person who processes data on behalf of the Company.'),
                jsonb_build_object('term', 'Usage Data', 'text', 'Data collected automatically such as IP address, browser type, and diagnostics.'),
                jsonb_build_object('term', 'Website', 'text', 'https://bharatmock.com'),
                jsonb_build_object('term', 'You', 'text', 'The individual or legal entity accessing or using the Service.')
            )),
            ('Collecting and Using Your Personal Data', 0, 'Personal Data', 'While using our Service, we may ask for information that can contact or identify you, including email, name, phone number, address, and Usage Data.', NULL),
            ('Collecting and Using Your Personal Data', 1, 'Usage Data', 'Usage Data is collected automatically, including device information, IP address, browser type, and diagnostics.', NULL),
            ('Collecting and Using Your Personal Data', 2, 'Tracking Technologies and Cookies', 'We use cookies, beacons, tags, and scripts to monitor Service activity and store preferences.', NULL),
            ('Use of Your Personal Data', 0, 'Primary Purposes', NULL, jsonb_build_array(
                'Provide and maintain the Service, including monitoring usage.',
                'Manage user accounts and deliver contractual services.',
                'Contact you regarding updates and service notifications.',
                'Provide marketing communications for similar offerings unless you opt out.',
                'Manage requests, business transfers, analytics, and improvements.'
            )),
            ('Retention of Your Personal Data', 0, 'Retention Schedule', 'We retain Personal Data only as long as necessary for the purposes described, applying shorter periods where feasible.', NULL),
            ('Retention of Your Personal Data', 1, 'Specific Periods', NULL, jsonb_build_array(
                'User accounts: retained for the duration of the relationship plus up to 24 months.',
                'Support tickets and chat transcripts: up to 24 months for quality and dispute resolution.',
                'Analytics cookies and device identifiers: up to 24 months for trend analysis.',
                'Server logs: up to 24 months for security monitoring.',
                'Longer retention may apply for legal obligations, claims, explicit user requests, or technical limitations.'
            )),
            ('Transfer of Your Personal Data', 0, 'International Transfers', 'Data may be processed outside of your jurisdiction. We implement appropriate safeguards where required by law and ensure adequate protection measures.', NULL),
            ('Delete Your Personal Data', 0, 'Deletion Rights', 'You can request deletion of Personal Data, update or amend information through account settings, or contact us for access and corrections.', NULL),
            ('Delete Your Personal Data', 1, 'Limitations', 'We may retain data where legally required or where we have a lawful basis, including security, compliance, or dispute resolution.', NULL),
            ('Disclosure of Your Personal Data', 0, 'Business Transactions', 'Data may be transferred during mergers, acquisitions, or asset sales with notice provided.', NULL),
            ('Disclosure of Your Personal Data', 1, 'Law Enforcement & Legal Requirements', 'We may disclose data to comply with legal obligations, protect rights, investigate wrongdoing, or ensure safety.', NULL),
            ('Security of Your Personal Data', 0, 'Security Measures', 'No method of transmission or storage is 100% secure, but we employ commercially reasonable safeguards to protect data.', NULL),
            ('Children''s Privacy', 0, 'Under 16 Policy', 'We do not knowingly collect data from individuals under 16. Parents or guardians can contact us for removal of such information.', NULL),
            ('Links to Other Websites', 0, 'Third-Party Links', 'We are not responsible for the content or privacy practices of third-party websites we link to.', NULL),
            ('Changes to this Privacy Policy', 0, 'Policy Updates', 'We may update this Privacy Policy and will notify you via email and/or prominent notices. Continued use constitutes acceptance.', NULL),
            ('Contact Us', 0, 'Contact Methods', NULL, jsonb_build_array(
                'By email: info@bharatmock.com',
                'By website: https://bharatmock.com/'
            ))
    ) AS p(section_title, display_order, heading, body, list_items)
    ON s.title = p.section_title
)
INSERT INTO privacy_policy_points (section_id, heading, body, list_items, display_order)
SELECT section_id, heading, body, list_items, display_order
FROM points
ON CONFLICT DO NOTHING;
