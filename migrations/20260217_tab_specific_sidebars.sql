-- Migration: Add tab-specific sidebar support
-- This allows each tab (overview, mock-tests, previous-papers, custom tabs) to have its own sidebar sections
-- Date: 2026-02-17

-- Add sidebar_tab_id column to page_sections to associate sidebars with specific tabs
-- NULL means the sidebar is shared across all tabs (backward compatible)
-- Non-NULL means the sidebar is specific to that tab

-- For subcategory pages
ALTER TABLE page_sections 
ADD COLUMN IF NOT EXISTS sidebar_tab_id VARCHAR(100);

COMMENT ON COLUMN page_sections.sidebar_tab_id IS 'Associates sidebar sections with specific tabs. NULL = shared across all tabs, "overview" = overview tab only, "mock-tests" = mock tests tab only, "previous-papers" = previous papers tab only, or a custom_tab_id for custom tabs';

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_page_sections_sidebar_tab ON page_sections(sidebar_tab_id) WHERE is_sidebar = true;

-- For category pages (parallel structure)
-- The category pages use category_custom_tab_id, so we add a similar column
ALTER TABLE page_sections
ADD COLUMN IF NOT EXISTS category_sidebar_tab_id VARCHAR(100);

COMMENT ON COLUMN page_sections.category_sidebar_tab_id IS 'Associates sidebar sections with specific tabs on category pages. NULL = shared across all tabs, or matches a tab identifier';

CREATE INDEX IF NOT EXISTS idx_page_sections_category_sidebar_tab ON page_sections(category_sidebar_tab_id) WHERE is_sidebar = true;

-- Migration notes:
-- 1. Existing sidebar sections (is_sidebar = true) will have sidebar_tab_id = NULL by default
--    This means they will continue to show on all tabs (backward compatible)
-- 2. To make a sidebar tab-specific, set sidebar_tab_id to:
--    - 'overview' for overview tab
--    - 'mock-tests' for mock tests tab
--    - 'previous-papers' for previous papers tab
--    - A custom_tab_id (UUID) for custom tabs
-- 3. The frontend will filter sidebars based on the active tab
-- 4. The admin editor will allow selecting which tab(s) a sidebar belongs to
