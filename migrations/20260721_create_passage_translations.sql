-- Migration: Create passage translation cache table
-- Created: 2026-07-21
-- Purpose: Cache Google-translated comprehension-passage text per language, the
--          same way question/option/section text is cached by
--          20260531_create_exam_translations.sql. Passages were the one piece of
--          attempt-page content with no translation path at all, so a Hindi
--          learner saw a translated question above an English reading passage.
--          Redis (TTL 30 days) sits in front of this table for fast reads.

-- ============================================================
-- Table
-- ============================================================

CREATE TABLE IF NOT EXISTS passage_translations (
    -- Schema-qualified to match passages/questions: uuid-ossp lives in `extensions`
    -- and is not on the default search_path for this role.
    id               UUID         PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    passage_id       UUID         NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    lang             VARCHAR(10)  NOT NULL,
    title_translated VARCHAR(500),
    content_translated TEXT       NOT NULL,
    translated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (passage_id, lang)
);

COMMENT ON TABLE passage_translations IS 'Auto-translated comprehension passage title/content cached from Google Translation API';

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_passage_translations_lookup
    ON passage_translations (passage_id, lang);

-- ============================================================
-- Auto-invalidation trigger
-- When the source English passage changes, drop its stale translations.
-- The next request re-translates and saves fresh copies.
-- Mirrors fn_invalidate_question_translation et al.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_invalidate_passage_translation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.content IS DISTINCT FROM NEW.content
       OR OLD.title IS DISTINCT FROM NEW.title THEN
        DELETE FROM passage_translations WHERE passage_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_passage_translation ON passages;
CREATE TRIGGER trg_invalidate_passage_translation
    AFTER UPDATE ON passages
    FOR EACH ROW EXECUTE FUNCTION fn_invalidate_passage_translation();

-- ============================================================
-- Verify
-- ============================================================

DO $$
BEGIN
    ASSERT (
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name = 'passage_translations'
    ) = 1, 'Migration failed: passage_translations was not created';

    RAISE NOTICE 'Migration 20260721_create_passage_translations OK';
END;
$$;
