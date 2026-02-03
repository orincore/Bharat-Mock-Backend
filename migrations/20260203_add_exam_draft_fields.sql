BEGIN;

CREATE TABLE IF NOT EXISTS exam_draft_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_key TEXT NOT NULL,
    exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    field_path TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS exam_draft_fields_draft_field_unique
    ON exam_draft_fields (draft_key, field_path);
CREATE INDEX IF NOT EXISTS exam_draft_fields_exam_idx
    ON exam_draft_fields (exam_id);
CREATE INDEX IF NOT EXISTS exam_draft_fields_updated_by_idx
    ON exam_draft_fields (updated_by);

CREATE TRIGGER update_exam_draft_fields_updated_at
    BEFORE UPDATE ON exam_draft_fields
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
