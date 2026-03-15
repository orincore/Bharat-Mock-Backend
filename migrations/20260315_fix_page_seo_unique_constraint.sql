-- Add missing unique constraint on page_seo.subcategory_id
-- Required for upsert ON CONFLICT (subcategory_id) to work
ALTER TABLE page_seo
  ADD CONSTRAINT page_seo_subcategory_id_key UNIQUE (subcategory_id);
