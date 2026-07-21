require('dotenv').config();
const prisma = require('./src/config/prisma');
const timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('DB timeout '+ms+'ms')), ms));
(async () => {
  await Promise.race([prisma.$queryRaw`SELECT 1`, timeout(8000)]);
  console.log('DB reachable');
  const exams = await Promise.race([
    prisma.exams.findMany({
      where: { OR: [{ title: { contains: 'SSC JE', mode: 'insensitive' } }, { total_questions: 200 }], deleted_at: null },
      select: { id: true, title: true, total_questions: true }, take: 15,
    }),
    timeout(15000),
  ]);
  for (const e of exams) {
    const actual = await prisma.questions.count({ where: { exam_id: e.id, deleted_at: null } });
    console.log(`claims=${e.total_questions} actual=${actual}  ${e.title}`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
