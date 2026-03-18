-- Widen page_sections columns that were too narrow (varchar 100 → 500)
ALTER TABLE page_sections
  ALTER COLUMN section_key TYPE VARCHAR(500),
  ALTER COLUMN title TYPE VARCHAR(500),
  ALTER COLUMN subtitle TYPE VARCHAR(500),
  ALTER COLUMN icon TYPE VARCHAR(500);
