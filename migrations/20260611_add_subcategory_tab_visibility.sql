-- Adds admin-controlled visibility flags for the reserved Mock Tests / Previous Papers
-- tabs on public subcategory pages. Both default to visible (true) so existing
-- subcategories keep their current behaviour.
ALTER TABLE exam_subcategories
  ADD COLUMN IF NOT EXISTS show_mock_tests_tab BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_previous_papers_tab BOOLEAN NOT NULL DEFAULT true;
