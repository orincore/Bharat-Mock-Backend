-- Relax created_by / updated_by constraints to allow system drafts
ALTER TABLE blogs DROP CONSTRAINT IF EXISTS blogs_created_by_fkey;
ALTER TABLE blogs DROP CONSTRAINT IF EXISTS blogs_updated_by_fkey;
