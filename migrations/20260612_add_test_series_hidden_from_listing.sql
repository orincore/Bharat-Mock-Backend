-- Adds an admin-controlled flag to hide a test series (e.g. the quizzes container
-- series) from the public /mock-test-series listing. The series itself stays
-- published so its detail page and quiz exams keep working; it is only excluded
-- from listings that request exclude_hidden=true. Defaults to visible (false).
ALTER TABLE test_series
  ADD COLUMN IF NOT EXISTS hidden_from_listing BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN test_series.hidden_from_listing IS 'When true, the series is excluded from public test-series listings (e.g. /mock-test-series) but remains accessible directly.';

-- Hide the quizzes container series from /mock-test-series right away.
-- It only exists to group short_quiz exams for the /quizzes page.
UPDATE test_series
SET hidden_from_listing = true
WHERE slug = 'test-series-quizzes';
