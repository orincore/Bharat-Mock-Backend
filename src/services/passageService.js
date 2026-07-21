const prisma = require('../config/prisma');
const logger = require('../config/logger');

const passageSelect = {
  id: true,
  exam_id: true,
  title: true,
  content: true,
  content_hi: true,
  created_at: true,
  updated_at: true,
};

const listPassagesForExam = async (examId) => {
  return prisma.passages.findMany({
    where: { exam_id: examId, deleted_at: null },
    select: { ...passageSelect, _count: { select: { questions: true } } },
    orderBy: { created_at: 'asc' },
  });
};

const getPassageById = async (id) => {
  return prisma.passages.findFirst({
    where: { id, deleted_at: null },
    select: passageSelect,
  });
};

const createPassage = async ({ examId, title, content, contentHi }) => {
  return prisma.passages.create({
    data: {
      exam_id: examId,
      title: title || null,
      content,
      content_hi: contentHi || null,
    },
    select: passageSelect,
  });
};

const updatePassage = async (id, { title, content, contentHi }) => {
  const data = { updated_at: new Date() };
  if (title !== undefined) data.title = title || null;
  if (content !== undefined) data.content = content;
  if (contentHi !== undefined) data.content_hi = contentHi || null;

  return prisma.passages.update({
    where: { id },
    data,
    select: passageSelect,
  });
};

// Soft-delete the passage and unlink any questions still pointing at it — the FK's
// ON DELETE SET NULL only fires on a hard delete, which we never do here.
const deletePassage = async (id) => {
  await prisma.$transaction([
    prisma.questions.updateMany({ where: { passage_id: id }, data: { passage_id: null } }),
    prisma.passages.update({ where: { id }, data: { deleted_at: new Date() } }),
  ]);
};

module.exports = {
  listPassagesForExam,
  getPassageById,
  createPassage,
  updatePassage,
  deletePassage,
};
