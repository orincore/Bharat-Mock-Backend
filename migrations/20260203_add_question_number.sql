BEGIN;

ALTER TABLE questions
ADD COLUMN IF NOT EXISTS question_number INTEGER;

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY section_id
      ORDER BY
        COALESCE(question_order, 0),
        created_at
    ) AS rn
  FROM questions
)
UPDATE questions q
SET question_number = numbered.rn
FROM numbered
WHERE q.id = numbered.id;

ALTER TABLE questions
ALTER COLUMN question_number SET NOT NULL,
ALTER COLUMN question_number SET DEFAULT 1;

CREATE OR REPLACE FUNCTION sync_question_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.question_number IS NULL THEN
    NEW.question_number := COALESCE(
      (SELECT COALESCE(MAX(question_number), 0) + 1 FROM questions WHERE section_id = NEW.section_id),
      1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_question_number ON questions;

CREATE TRIGGER set_question_number
BEFORE INSERT ON questions
FOR EACH ROW
EXECUTE FUNCTION sync_question_number();

COMMIT;
