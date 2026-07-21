// Loads the full exam payload (exam + sections + questions + options + passages)
// used to render a question-paper PDF. Shared by the public download endpoint
// (published exams only) and the admin generator (any exam).

async function fetchExamPdfData(prisma, examId, { publishedOnly = true } = {}) {
  const where = { id: examId, deleted_at: null };
  if (publishedOnly) where.is_published = true;

  const exam = await prisma.exams.findFirst({
    where,
    include: {
      exam_categories: { select: { name: true, slug: true } },
      exam_subcategories: { select: { name: true, slug: true } },
      exam_difficulties: { select: { name: true } },
    },
  });
  if (!exam) return null;

  const [sections, questions] = await Promise.all([
    prisma.exam_sections.findMany({
      where: { exam_id: examId },
      orderBy: { section_order: 'asc' },
    }),
    prisma.questions.findMany({
      where: { exam_id: examId, deleted_at: null },
      include: { question_options: true, passages: true },
      // question_number can be null on older rows; order_by is a stable fallback.
      orderBy: [{ question_number: 'asc' }, { question_order: 'asc' }],
    }),
  ]);

  const questionsNormalized = questions.map(({ passages: passage, question_options, ...q }) => ({
    ...q,
    passage: passage || null,
    options: (question_options || []).sort(
      (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
    ),
  }));

  return { exam, sections, questions: questionsNormalized };
}

module.exports = { fetchExamPdfData };
