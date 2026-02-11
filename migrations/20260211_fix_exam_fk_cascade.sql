-- Fix: exams.category_id and exams.subcategory_id FK constraints lack ON DELETE SET NULL
-- This prevents deleting categories/subcategories that have linked exams.
-- We use SET NULL so exams are preserved but unlinked when a category/subcategory is removed.

-- 1. Drop existing FK constraints on exams.category_id and exams.subcategory_id
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_category_id_fkey;
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_subcategory_id_fkey;

-- 2. Re-add with ON DELETE SET NULL
ALTER TABLE exams
  ADD CONSTRAINT exams_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES exam_categories(id) ON DELETE SET NULL;

ALTER TABLE exams
  ADD CONSTRAINT exams_subcategory_id_fkey
  FOREIGN KEY (subcategory_id) REFERENCES exam_subcategories(id) ON DELETE SET NULL;
