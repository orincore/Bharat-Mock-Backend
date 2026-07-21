const prisma = require('../config/prisma');
const { redisCache, buildCacheKey } = require('../utils/redisCache');
const logger = require('../config/logger');

const TX_TTL = 2592000; // 30 days in seconds

const cacheKey = (examId, lang) => buildCacheKey('exam_translations', examId, lang);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchFromDb(examId, lang) {
  // 1. Get all question IDs + section IDs for this exam
  const questions = await prisma.questions.findMany({
    where: { exam_id: examId, deleted_at: null },
    select: { id: true, section_id: true, passage_id: true },
  });

  if (!questions.length) return null;

  const questionIds = questions.map(q => q.id);
  const sectionIds = [...new Set(questions.map(q => q.section_id).filter(Boolean))];
  const passageIds = [...new Set(questions.map(q => q.passage_id).filter(Boolean))];

  // 2. Fetch all four translation tables in parallel
  const [translatedQuestionRows, translatedOptionRows, translatedSectionRows, translatedPassageRows] = await Promise.all([
    prisma.question_translations.findMany({
      where: { lang, question_id: { in: questionIds } },
      select: { question_id: true, text_translated: true },
    }),

    prisma.option_translations.findMany({
      where: { lang, question_options: { question_id: { in: questionIds } } },
      select: { option_id: true, text_translated: true, question_options: { select: { question_id: true } } },
    }),

    sectionIds.length
      ? prisma.section_translations.findMany({
          where: { lang, section_id: { in: sectionIds } },
          select: { section_id: true, name_translated: true },
        })
      : Promise.resolve([]),

    passageIds.length
      ? prisma.passage_translations.findMany({
          where: { lang, passage_id: { in: passageIds } },
          select: { passage_id: true, title_translated: true, content_translated: true },
        })
      : Promise.resolve([]),
  ]);

  if (!translatedQuestionRows.length) return null; // No translations saved yet

  // 3. Build question → options map
  const optionsByQuestion = {};
  for (const row of translatedOptionRows) {
    const qId = row.question_options?.question_id;
    if (!qId) continue;
    if (!optionsByQuestion[qId]) optionsByQuestion[qId] = [];
    optionsByQuestion[qId].push({ id: row.option_id, text_translated: row.text_translated });
  }

  // 4. Assemble response shape
  const translatedQuestions = translatedQuestionRows.map(row => ({
    id: row.question_id,
    text_translated: row.text_translated,
    options: optionsByQuestion[row.question_id] || [],
  }));

  const translatedSections = translatedSectionRows.map(row => ({
    id: row.section_id,
    name_translated: row.name_translated,
  }));

  const translatedPassages = translatedPassageRows.map(row => ({
    id: row.passage_id,
    title_translated: row.title_translated || null,
    content_translated: row.content_translated,
  }));

  return { questions: translatedQuestions, sections: translatedSections, passages: translatedPassages };
}

// ---------------------------------------------------------------------------
// GET /api/v1/exam-translations/:examId?lang=hi
// ---------------------------------------------------------------------------
const getExamTranslations = async (req, res) => {
  const { examId } = req.params;
  const lang = (req.query.lang || 'hi').toLowerCase();

  if (!examId || !lang || lang === 'en') {
    return res.status(400).json({ success: false, error: 'examId and lang (non-english) are required' });
  }

  try {
    // 1. Redis check
    const key = cacheKey(examId, lang);
    const cached = await redisCache.get(key);
    if (cached) {
      logger.info(`[Cache] HIT exam_translations:${examId}:${lang}`);
      return res.json({ success: true, cached: true, data: cached });
    }

    // 2. DB check
    const data = await fetchFromDb(examId, lang);
    if (!data) {
      return res.status(404).json({ success: false, error: 'No translations found' });
    }

    // 3. Warm Redis
    await redisCache.set(key, data, TX_TTL);
    logger.info(`[Cache] SET exam_translations:${examId}:${lang} (TTL ${TX_TTL}s)`);

    return res.json({ success: true, cached: false, data });
  } catch (err) {
    logger.error('[examTranslations] GET error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/v1/exam-translations/:examId
// Body: { lang, questions: [{id, text_translated, options:[{id,text_translated}]}], sections:[{id,name_translated}] }
// ---------------------------------------------------------------------------
const saveExamTranslations = async (req, res) => {
  const { examId } = req.params;
  const { lang, questions = [], sections = [], passages = [] } = req.body;

  if (!examId || !lang || lang === 'en') {
    return res.status(400).json({ success: false, error: 'examId and lang (non-english) are required' });
  }
  if (!questions.length && !sections.length && !passages.length) {
    return res.status(400).json({ success: false, error: 'Nothing to save' });
  }

  try {
    const now = new Date();

    // Build upsert payloads
    const questionRows = questions
      .filter(q => q.id && q.text_translated)
      .map(q => ({ question_id: q.id, lang, text_translated: q.text_translated, translated_at: now }));

    const optionRows = questions.flatMap(q =>
      (q.options || [])
        .filter(o => o.id && o.text_translated)
        .map(o => ({ option_id: o.id, lang, text_translated: o.text_translated, translated_at: now }))
    );

    const sectionRows = sections
      .filter(s => s.id && s.name_translated)
      .map(s => ({ section_id: s.id, lang, name_translated: s.name_translated, translated_at: now }));

    const passageRows = passages
      .filter(p => p.id && p.content_translated)
      .map(p => ({
        passage_id: p.id,
        lang,
        title_translated: p.title_translated || null,
        content_translated: p.content_translated,
        translated_at: now,
      }));

    // Upsert all rows across all three tables in a single transaction so a partial
    // failure doesn't leave translations half-saved (matches the old bulk-upsert's
    // all-or-nothing behavior).
    const ops = [
      ...questionRows.map(row => prisma.question_translations.upsert({
        where: { question_id_lang: { question_id: row.question_id, lang: row.lang } },
        create: row,
        update: { text_translated: row.text_translated, translated_at: row.translated_at },
      })),
      ...optionRows.map(row => prisma.option_translations.upsert({
        where: { option_id_lang: { option_id: row.option_id, lang: row.lang } },
        create: row,
        update: { text_translated: row.text_translated, translated_at: row.translated_at },
      })),
      ...sectionRows.map(row => prisma.section_translations.upsert({
        where: { section_id_lang: { section_id: row.section_id, lang: row.lang } },
        create: row,
        update: { name_translated: row.name_translated, translated_at: row.translated_at },
      })),
      ...passageRows.map(row => prisma.passage_translations.upsert({
        where: { passage_id_lang: { passage_id: row.passage_id, lang: row.lang } },
        create: row,
        update: {
          title_translated: row.title_translated,
          content_translated: row.content_translated,
          translated_at: row.translated_at,
        },
      })),
    ];

    if (ops.length) {
      await prisma.$transaction(ops);
    }

    // Invalidate + rewrite Redis so next GET is instant
    const key = cacheKey(examId, lang);
    await redisCache.del(key);
    const fresh = await fetchFromDb(examId, lang);
    if (fresh) {
      await redisCache.set(key, fresh, TX_TTL);
      logger.info(`[Cache] REWRITE exam_translations:${examId}:${lang}`);
    }

    return res.status(201).json({
      success: true,
      saved: {
        questions: questionRows.length,
        options: optionRows.length,
        sections: sectionRows.length,
        passages: passageRows.length,
      },
    });
  } catch (err) {
    logger.error('[examTranslations] POST error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = { getExamTranslations, saveExamTranslations };
