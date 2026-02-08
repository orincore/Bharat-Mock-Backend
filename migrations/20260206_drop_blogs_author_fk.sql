-- Allow blogs to be created without a matching auth.users entry
ALTER TABLE blogs DROP CONSTRAINT IF EXISTS blogs_author_id_fkey;
ALTER TABLE blogs ALTER COLUMN author_id DROP NOT NULL;
