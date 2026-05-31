-- Migration: Create exam translation cache tables
-- Created: 2026-05-31
-- Purpose: Cache Google-translated question/option/section text per language.
--          Avoids re-calling the Translation API for the same content.
--          Redis (TTL 30 days) sits in front of these tables for fast reads.

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS question_translations (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id     UUID        NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    lang            VARCHAR(10) NOT NULL,
    text_translated TEXT        NOT NULL,
    translated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (question_id, lang)
);

COMMENT ON TABLE question_translations IS 'Auto-translated question text cached from Google Translation API';

CREATE TABLE IF NOT EXISTS option_translations (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    option_id       UUID        NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
    lang            VARCHAR(10) NOT NULL,
    text_translated TEXT        NOT NULL,
    translated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (option_id, lang)
);

COMMENT ON TABLE option_translations IS 'Auto-translated option text cached from Google Translation API';

CREATE TABLE IF NOT EXISTS section_translations (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id       UUID         NOT NULL REFERENCES exam_sections(id) ON DELETE CASCADE,
    lang             VARCHAR(10)  NOT NULL,
    name_translated  VARCHAR(500) NOT NULL,
    translated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (section_id, lang)
);

COMMENT ON TABLE section_translations IS 'Auto-translated section names cached from Google Translation API';

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_question_translations_lookup
    ON question_translations (question_id, lang);

CREATE INDEX IF NOT EXISTS idx_option_translations_lookup
    ON option_translations (option_id, lang);

CREATE INDEX IF NOT EXISTS idx_section_translations_lookup
    ON section_translations (section_id, lang);

-- Index to fetch all translated questions for an exam efficiently
CREATE INDEX IF NOT EXISTS idx_question_translations_exam
    ON question_translations (question_id);

-- ============================================================
-- Auto-invalidation triggers
-- When source English text changes, delete stale translations.
-- Next API request will re-translate and save fresh copies.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_invalidate_question_translation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.text IS DISTINCT FROM NEW.text THEN
        DELETE FROM question_translations WHERE question_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_question_translation ON questions;
CREATE TRIGGER trg_invalidate_question_translation
    AFTER UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION fn_invalidate_question_translation();

CREATE OR REPLACE FUNCTION fn_invalidate_option_translation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.option_text IS DISTINCT FROM NEW.option_text THEN
        DELETE FROM option_translations WHERE option_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_option_translation ON question_options;
CREATE TRIGGER trg_invalidate_option_translation
    AFTER UPDATE ON question_options
    FOR EACH ROW EXECUTE FUNCTION fn_invalidate_option_translation();

CREATE OR REPLACE FUNCTION fn_invalidate_section_translation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.name IS DISTINCT FROM NEW.name THEN
        DELETE FROM section_translations WHERE section_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_section_translation ON exam_sections;
CREATE TRIGGER trg_invalidate_section_translation
    AFTER UPDATE ON exam_sections
    FOR EACH ROW EXECUTE FUNCTION fn_invalidate_section_translation();

-- ============================================================
-- View: fetch all translations for an exam in one query
-- Usage: SELECT * FROM v_exam_translations
--        WHERE exam_id = $1 AND lang = $2
-- ============================================================

CREATE OR REPLACE VIEW v_exam_translations AS
SELECT
    q.exam_id,
    qt.lang,
    q.id                    AS question_id,
    qt.text_translated      AS question_text_translated,
    qo.id                   AS option_id,
    ot.text_translated      AS option_text_translated,
    es.id                   AS section_id,
    st.name_translated      AS section_name_translated
FROM questions q
JOIN question_translations qt
    ON qt.question_id = q.id
LEFT JOIN question_options qo
    ON qo.question_id = q.id
LEFT JOIN option_translations ot
    ON ot.option_id = qo.id AND ot.lang = qt.lang
LEFT JOIN exam_sections es
    ON es.id = q.section_id
LEFT JOIN section_translations st
    ON st.section_id = es.id AND st.lang = qt.lang;

-- ============================================================
-- Verify
-- ============================================================

DO $$
BEGIN
    ASSERT (
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name IN (
            'question_translations',
            'option_translations',
            'section_translations'
        )
    ) = 3, 'Migration failed: not all 3 tables were created';

    RAISE NOTICE 'Migration 20260531_create_exam_translations OK';
END;
$$;
