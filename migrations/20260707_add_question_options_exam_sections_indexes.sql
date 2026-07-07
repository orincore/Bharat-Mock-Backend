-- Fixes 5-15 minute exam save/update times for exams with 75+ questions.
--
-- updateExamWithContent / bulkCreateExamWithContent delete-and-reinsert all questions,
-- options, and sections on every save. Two of the columns used in those queries had
-- no index at all, forcing a full table scan across ALL exams' options/sections every
-- time a single exam was saved:
--   - question_options.question_id  (used by: DELETE ... WHERE question_id IN (...))
--   - exam_sections.exam_id         (used by: DELETE/SELECT ... WHERE exam_id = ...)
--
-- These get worse over time as the overall question_options/exam_sections tables grow
-- across the whole platform, independent of how many questions any single exam has.

CREATE INDEX IF NOT EXISTS idx_question_options_question_id ON question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_exam_sections_exam_id ON exam_sections(exam_id);

ANALYZE question_options;
ANALYZE exam_sections;
