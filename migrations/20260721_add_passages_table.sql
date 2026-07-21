-- Comprehension passages: a shared paragraph (rich HTML, images embedded inline)
-- that multiple questions can reference, rendered as a dedicated reading pane
-- alongside its linked questions in the exam attempt UI, review page and PDF export.

CREATE TABLE IF NOT EXISTS passages (
  id          UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  exam_id     UUID REFERENCES exams(id) ON DELETE CASCADE,
  title       VARCHAR(255),
  content     TEXT NOT NULL,
  content_hi  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_passages_exam_id ON passages(exam_id) WHERE deleted_at IS NULL;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS passage_id UUID REFERENCES passages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questions_passage_id ON questions(passage_id) WHERE deleted_at IS NULL;
