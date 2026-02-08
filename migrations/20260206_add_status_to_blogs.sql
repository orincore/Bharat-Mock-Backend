-- Add status column to blogs for draft/publish workflow
ALTER TABLE blogs
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft';

-- Backfill existing rows
UPDATE blogs
SET status = CASE WHEN is_published THEN 'published' ELSE 'draft' END
WHERE status IS NULL OR status = '';

-- Ensure published_at consistency
UPDATE blogs
SET published_at = created_at
WHERE status = 'published' AND published_at IS NULL;
