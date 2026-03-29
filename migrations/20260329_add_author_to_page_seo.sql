-- Add author_name column to page_seo for category and subcategory pages
ALTER TABLE page_seo ADD COLUMN IF NOT EXISTS author_name VARCHAR(255);
