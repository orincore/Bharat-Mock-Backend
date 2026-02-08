-- Removes legacy purchase-centric fields from exams
ALTER TABLE exams
  DROP COLUMN IF EXISTS description;

ALTER TABLE exams
  DROP COLUMN IF EXISTS price;
