-- Migration: Add structured_data column to blogs
-- Date: 2026-06-15
--
-- The blog editor lets admins paste custom JSON-LD schema(s) for a post, but the
-- column didn't exist, so the value was silently dropped on save and never returned
-- to the public page. Stored as TEXT (not JSONB) because the field accepts a JSON
-- object, a JSON array, several concatenated objects, OR pasted
-- <script type="application/ld+json"> tags — the public page parses any of these.

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS structured_data TEXT;
