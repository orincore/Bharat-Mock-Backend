const supabase = require('../config/database');
const { redisCache, buildCacheKey } = require('../utils/redisCache');
const logger = require('../config/logger');

const TX_TTL = 2592000; // 30 days in seconds

const cacheKey = (examId, lang) => buildCacheKey('exam_translations', examId, lang);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchFromDb(examId, lang) {
  // 1. Get all question IDs + section IDs for this exam
  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, section_id')
    .eq('exam_id', examId)
    .is('deleted_at', null);

  if (qErr || !questions?.length) return null;

  const questionIds = questions.map(q => q.id);
  const sectionIds = [...new Set(questions.map(q => q.section_id).filter(Boolean))];

  // 2. Fetch all three translation tables in parallel
  const [qtRes, otRes, stRes] = await Promise.all([
    supabase
      .from('question_translations')
      .select('question_id, text_translated')
      .eq('lang', lang)
      .in('question_id', questionIds),

    supabase
      .from('option_translations')
      .select('option_id, text_translated, question_options!inner(question_id)')
      .eq('lang', lang)
      .in('question_options.question_id', questionIds),

    sectionIds.length
      ? supabase
          .from('section_translations')
          .select('section_id, name_translated')
          .eq('lang', lang)
          .in('section_id', sectionIds)
      : Promise.resolve({ data: [] }),
  ]);

  if (!qtRes.data?.length) return null; // No translations saved yet

  // 3. Build question → options map
  const optionsByQuestion = {};
  for (const row of otRes.data || []) {
    const qId = row.question_options?.question_id;
    if (!qId) continue;
    if (!optionsByQuestion[qId]) optionsByQuestion[qId] = [];
    optionsByQuestion[qId].push({ id: row.option_id, text_translated: row.text_translated });
  }

  // 4. Assemble response shape
  const translatedQuestions = qtRes.data.map(row => ({
    id: row.question_id,
    text_translated: row.text_translated,
    options: optionsByQuestion[row.question_id] || [],
  }));

  const translatedSections = (stRes.data || []).map(row => ({
    id: row.section_id,
    name_translated: row.name_translated,
  }));

  return { questions: translatedQuestions, sections: translatedSections };
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
  const { lang, questions = [], sections = [] } = req.body;

  if (!examId || !lang || lang === 'en') {
    return res.status(400).json({ success: false, error: 'examId and lang (non-english) are required' });
  }
  if (!questions.length && !sections.length) {
    return res.status(400).json({ success: false, error: 'Nothing to save' });
  }

  try {
    const now = new Date().toISOString();

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

    // Upsert all three in parallel
    const ops = [];
    if (questionRows.length) {
      ops.push(
        supabase.from('question_translations')
          .upsert(questionRows, { onConflict: 'question_id,lang' })
      );
    }
    if (optionRows.length) {
      ops.push(
        supabase.from('option_translations')
          .upsert(optionRows, { onConflict: 'option_id,lang' })
      );
    }
    if (sectionRows.length) {
      ops.push(
        supabase.from('section_translations')
          .upsert(sectionRows, { onConflict: 'section_id,lang' })
      );
    }

    const results = await Promise.all(ops);
    for (const { error } of results) {
      if (error) throw new Error(error.message);
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
      saved: { questions: questionRows.length, options: optionRows.length, sections: sectionRows.length },
    });
  } catch (err) {
    logger.error('[examTranslations] POST error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = { getExamTranslations, saveExamTranslations };
