-- Migration: Create disclaimer dynamic tables
-- Date: 2026-02-10

CREATE TABLE IF NOT EXISTS disclaimer_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    last_updated DATE NOT NULL,
    intro_body TEXT,
    contact_email VARCHAR(160),
    contact_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disclaimer_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disclaimer_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID REFERENCES disclaimer_sections(id) ON DELETE CASCADE,
    heading VARCHAR(200),
    body TEXT,
    list_items JSONB,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disclaimer_sections_display
    ON disclaimer_sections(display_order)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_disclaimer_points_section
    ON disclaimer_points(section_id, display_order)
    WHERE is_active = TRUE;

INSERT INTO disclaimer_content (
    title,
    last_updated,
    intro_body,
    contact_email,
    contact_url
) VALUES (
    'Disclaimer',
    '2026-02-09',
    'This Disclaimer governs your use of Bharat Mock and outlines the limitations of liability, accuracy of information, and fair use of the Service.',
    'info@bharatmock.com',
    'https://bharatmock.com/'
) ON CONFLICT DO NOTHING;

WITH section_seed AS (
    SELECT * FROM (
        VALUES
            ('Interpretation and Definitions', 'Understanding how capitalized words and defined terms should be read throughout this Disclaimer.'),
            ('Disclaimer', 'Core limitations of liability and accuracy of information shared through the Service.'),
            ('External Links Disclaimer', 'How third-party links are handled and the accuracy of their content.'),
            ('Errors and Omissions Disclaimer', 'Accuracy commitments and possible gaps in the provided information.'),
            ('Fair Use Disclaimer', 'Use of copyrighted material under applicable fair use provisions.'),
            ('Views Expressed Disclaimer', 'Clarifies that opinions belong to individual authors, not Bharat Mock.'),
            ('No Responsibility Disclaimer', 'Outlines that the Company does not render professional services via the Service.'),
            ('Use at Your Own Risk Disclaimer', 'Highlights that all information is provided as-is without warranties.'),
            ('Contact Us', 'How to reach Bharat Mock for questions about this Disclaimer.')
    ) AS s(title, description)
)
INSERT INTO disclaimer_sections (title, description, display_order)
SELECT title, description, ROW_NUMBER() OVER (ORDER BY title)
FROM section_seed
ON CONFLICT DO NOTHING;

WITH points AS (
    SELECT s.id AS section_id, p.display_order, p.heading, p.body, p.list_items
    FROM disclaimer_sections s
    JOIN (
        VALUES
            ('Interpretation and Definitions', 0, 'Interpretation', 'The words whose initial letters are capitalized have meanings defined under the following conditions. These definitions apply uniformly whether the terms appear in singular or plural.', NULL),
            ('Interpretation and Definitions', 1, 'Definitions', NULL, jsonb_build_array(
                jsonb_build_object('term', 'Company', 'text', 'Bharat Mock, referred to as the Company, We, Us or Our within this Disclaimer.'),
                jsonb_build_object('term', 'Service', 'text', 'The Bharat Mock website.'),
                jsonb_build_object('term', 'You', 'text', 'The individual or legal entity accessing or using the Service.'),
                jsonb_build_object('term', 'Website', 'text', 'https://bharatmock.com/')
            )),
            ('Disclaimer', 0, 'General Information', 'The information contained on the Service is for general information purposes only. The Company assumes no responsibility for errors or omissions in the contents of the Service.', NULL),
            ('Disclaimer', 1, 'Limitation of Liability', 'In no event shall the Company be liable for any special, direct, indirect, consequential, or incidental damages arising out of or in connection with the use of the Service or its contents.', NULL),
            ('Disclaimer', 2, 'Content Updates', 'The Company reserves the right to add, remove, or modify content at any time without prior notice and does not warrant that the Service is free of harmful components.', NULL),
            ('External Links Disclaimer', 0, 'Third-Party Websites', 'The Service may contain links to external websites that are not provided or maintained by the Company. We do not guarantee the accuracy, relevance, timeliness, or completeness of any information on these external sites.', NULL),
            ('Errors and Omissions Disclaimer', 0, 'General Guidance', 'The information provided is for general guidance only. Despite efforts to keep content current and accurate, errors may occur and laws may change over time.', NULL),
            ('Errors and Omissions Disclaimer', 1, 'No Guarantees', 'The Company is not responsible for any errors or omissions, nor for results obtained from the use of this information.', NULL),
            ('Fair Use Disclaimer', 0, 'Use of Copyrighted Material', 'The Company may use copyrighted material for criticism, commentary, news reporting, teaching, scholarship, or research in line with fair use provisions.', NULL),
            ('Fair Use Disclaimer', 1, 'Permission Requirement', 'If you wish to use copyrighted material from the Service for purposes beyond fair use, you must obtain permission from the copyright owner.', NULL),
            ('Views Expressed Disclaimer', 0, 'Opinions', 'Views and opinions expressed on the Service belong to their authors and do not necessarily reflect the official policy of the Company.', NULL),
            ('Views Expressed Disclaimer', 1, 'User-Generated Content', 'If the Service allows user content, such content is the sole responsibility of the user. The Company reserves the right to remove user-generated content for any reason.', NULL),
            ('No Responsibility Disclaimer', 0, 'Professional Advice', 'The information on the Service is provided with the understanding that the Company is not engaged in rendering legal, accounting, tax, or other professional services.', NULL),
            ('No Responsibility Disclaimer', 1, 'Damages', 'Neither the Company nor its suppliers shall be liable for any special, incidental, indirect, or consequential damages arising from your use of the Service.', NULL),
            ('Use at Your Own Risk Disclaimer', 0, 'Information Provided "As Is"', 'All information in the Service is provided "as is" without warranty of completeness, accuracy, timeliness, or results, and without any implied warranties of performance, merchantability, or fitness.', NULL),
            ('Use at Your Own Risk Disclaimer', 1, 'Reliance on Information', 'The Company is not liable for decisions made based on information provided by the Service, even if advised of the possibility of such damages.', NULL),
            ('Contact Us', 0, 'Reach Out', NULL, jsonb_build_array(
                'By email: info@bharatmock.com',
                'By website: https://bharatmock.com/'
            ))
    ) AS p(section_title, display_order, heading, body, list_items)
    ON s.title = p.section_title
)
INSERT INTO disclaimer_points (section_id, heading, body, list_items, display_order)
SELECT section_id, heading, body, list_items, display_order
FROM points
ON CONFLICT DO NOTHING;
