-- Migration: Add logo_url, icon, display_order, and is_active to exam_categories
-- Date: 2026-01-23

-- Add new columns to exam_categories if they don't exist
ALTER TABLE exam_categories 
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS icon VARCHAR(100),
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Create index for display_order
CREATE INDEX IF NOT EXISTS idx_exam_categories_display_order ON exam_categories(display_order);
CREATE INDEX IF NOT EXISTS idx_exam_categories_is_active ON exam_categories(is_active);

-- Add trigger for updated_at if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'update_exam_categories_updated_at'
    ) THEN
        CREATE TRIGGER update_exam_categories_updated_at 
        BEFORE UPDATE ON exam_categories 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END
$$;

COMMENT ON COLUMN exam_categories.logo_url IS 'URL to category logo image stored in R2/CDN';
COMMENT ON COLUMN exam_categories.icon IS 'Icon identifier for UI rendering (e.g., lucide icon name)';
COMMENT ON COLUMN exam_categories.display_order IS 'Order in which categories should be displayed (lower = first)';
COMMENT ON COLUMN exam_categories.is_active IS 'Whether the category is active and visible to users';
