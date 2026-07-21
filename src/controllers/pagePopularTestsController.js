const prisma = require('../config/prisma');
const { redisCache, CACHE_TTL, buildCacheKey } = require('../utils/redisCache');

const examWithCategorySelect = {
  id: true, title: true, slug: true, duration: true, total_questions: true, total_marks: true,
  thumbnail_url: true, logo_url: true, image_url: true, difficulty: true,
  category_id: true, subcategory_id: true, exam_type: true, is_premium: true, is_free: true,
  status: true, allow_anytime: true, start_date: true, end_date: true, supports_hindi: true,
  url_path: true, attempts: true,
  exam_categories: { select: { logo_url: true, icon: true } },
};

const adminExamWithCategorySelect = {
  id: true, title: true, slug: true, duration: true, total_questions: true, thumbnail_url: true,
  logo_url: true, image_url: true, difficulty: true, category: true, subcategory: true,
  exam_type: true, is_premium: true, is_free: true, status: true, total_marks: true,
  supports_hindi: true, url_path: true, attempts: true,
  exam_categories: { select: { logo_url: true, icon: true } },
};

const buildErrorResponse = (message, statusCode = 500) => ({ success: false, message, statusCode });

// Any write to a page's popular tests must bust that page's own cache AND, when the
// page is the homepage, the homepage aggregate (homepage:data) that powers the
// "Popular Government Exams" section. Without this the homepage stays stale up to 30 min.
const invalidatePopularTestsCache = async (pageIdentifier) => {
  const ops = [];
  if (pageIdentifier) ops.push(redisCache.del(buildCacheKey('popular_tests', pageIdentifier)));
  if (pageIdentifier === 'homepage') ops.push(redisCache.del(buildCacheKey('homepage', 'data')));
  if (ops.length) await Promise.all(ops);
  console.log(`[Cache] Invalidated popular_tests:${pageIdentifier}${pageIdentifier === 'homepage' ? ' + homepage:data' : ''}`);
};

// Resolve which page a popular-test row belongs to (remove/toggle only receive the row id)
const getPageIdentifierForTest = async (id) => {
  const data = await prisma.page_popular_tests.findUnique({
    where: { id },
    select: { page_identifier: true },
  });
  return data?.page_identifier || null;
};

const getPopularTests = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;

    const cacheKey = buildCacheKey('popular_tests', pageIdentifier);
    const cachedResponse = await redisCache.get(cacheKey);
    if (cachedResponse) return res.json(cachedResponse);

    let data;
    try {
      data = await prisma.page_popular_tests.findMany({
        where: { page_identifier: pageIdentifier, is_active: true },
        select: { id: true, display_order: true, exams: { select: examWithCategorySelect } },
        orderBy: { display_order: 'asc' },
      });
    } catch (error) {
      console.error('Error fetching popular tests:', error);
      return res.status(500).json(buildErrorResponse('Failed to fetch popular tests'));
    }

    if (!data || data.length === 0) {
      const response = { success: true, data: [], message: 'No popular tests found for this page' };
      await redisCache.set(cacheKey, response, CACHE_TTL.POPULAR_TESTS / 2);
      return res.json(response);
    }

    const validData = data.filter(item => item.exams);
    const response = { success: true, data: validData, total: validData.length };
    await redisCache.set(cacheKey, response, CACHE_TTL.POPULAR_TESTS);
    res.json(response);
  } catch (err) {
    console.error('Error in getPopularTests:', err);
    res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const getPopularTestsAdmin = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;

    let data;
    try {
      data = await prisma.page_popular_tests.findMany({
        where: { page_identifier: pageIdentifier },
        select: {
          id: true, page_identifier: true, exam_id: true, display_order: true, is_active: true,
          created_at: true, updated_at: true,
          exams: { select: adminExamWithCategorySelect },
        },
        orderBy: { display_order: 'asc' },
      });
    } catch (error) {
      console.error('Error fetching popular tests (admin):', error);
      return res.status(500).json(buildErrorResponse('Failed to fetch popular tests'));
    }

    const formattedData = data.map(item => ({
      id: item.id,
      pageIdentifier: item.page_identifier,
      examId: item.exam_id,
      displayOrder: item.display_order,
      isActive: item.is_active,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      exam: item.exams,
    }));

    return res.status(200).json({ success: true, data: formattedData });
  } catch (err) {
    console.error('Error in getPopularTestsAdmin:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const addPopularTest = async (req, res) => {
  try {
    const { pageIdentifier, examId } = req.body;

    if (!pageIdentifier || !examId) {
      return res.status(400).json(buildErrorResponse('Page identifier and exam ID are required', 400));
    }

    let existingTests;
    try {
      existingTests = await prisma.page_popular_tests.findMany({
        where: { page_identifier: pageIdentifier },
        select: { display_order: true },
        orderBy: { display_order: 'desc' },
        take: 1,
      });
    } catch (fetchError) {
      console.error('Error fetching existing tests:', fetchError);
      return res.status(500).json(buildErrorResponse('Failed to add popular test'));
    }

    const nextOrder = existingTests.length > 0 ? existingTests[0].display_order + 1 : 0;

    let data;
    try {
      data = await prisma.page_popular_tests.create({
        data: { page_identifier: pageIdentifier, exam_id: examId, display_order: nextOrder, is_active: true },
        select: {
          id: true, page_identifier: true, exam_id: true, display_order: true, is_active: true,
          created_at: true, updated_at: true,
          exams: { select: adminExamWithCategorySelect },
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json(buildErrorResponse('This exam is already in the popular tests list', 409));
      }
      console.error('Error adding popular test:', error);
      return res.status(500).json(buildErrorResponse('Failed to add popular test'));
    }

    await invalidatePopularTestsCache(pageIdentifier);

    return res.status(201).json({
      success: true,
      message: 'Popular test added successfully',
      data: {
        id: data.id,
        pageIdentifier: data.page_identifier,
        examId: data.exam_id,
        displayOrder: data.display_order,
        isActive: data.is_active,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        exam: data.exams,
      },
    });
  } catch (err) {
    console.error('Error in addPopularTest:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const removePopularTest = async (req, res) => {
  try {
    const { id } = req.params;
    // Capture the page before deleting so we know which cache(s) to bust
    const pageIdentifier = await getPageIdentifierForTest(id);
    try {
      await prisma.page_popular_tests.delete({ where: { id } });
    } catch (error) {
      console.error('Error removing popular test:', error);
      return res.status(500).json(buildErrorResponse('Failed to remove popular test'));
    }

    await invalidatePopularTestsCache(pageIdentifier);

    return res.status(200).json({ success: true, message: 'Popular test removed successfully' });
  } catch (err) {
    console.error('Error in removePopularTest:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const reorderPopularTests = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json(buildErrorResponse('Ordered IDs array is required', 400));
    }

    try {
      await prisma.$transaction(
        orderedIds.map((id, index) => prisma.page_popular_tests.updateMany({
          where: { id, page_identifier: pageIdentifier },
          data: { display_order: index },
        }))
      );
    } catch (error) {
      console.error('Error reordering popular tests');
      return res.status(500).json(buildErrorResponse('Failed to reorder popular tests'));
    }

    await invalidatePopularTestsCache(pageIdentifier);

    return res.status(200).json({ success: true, message: 'Popular tests reordered successfully' });
  } catch (err) {
    console.error('Error in reorderPopularTests:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const togglePopularTestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json(buildErrorResponse('isActive must be a boolean', 400));
    }

    let data;
    try {
      data = await prisma.page_popular_tests.update({ where: { id }, data: { is_active: isActive } });
    } catch (error) {
      console.error('Error toggling popular test status:', error);
      return res.status(500).json(buildErrorResponse('Failed to update popular test status'));
    }

    await invalidatePopularTestsCache(data?.page_identifier);

    return res.status(200).json({
      success: true,
      message: 'Popular test status updated successfully',
      data: { id: data.id, isActive: data.is_active },
    });
  } catch (err) {
    console.error('Error in togglePopularTestStatus:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

module.exports = {
  getPopularTests,
  getPopularTestsAdmin,
  addPopularTest,
  removePopularTest,
  reorderPopularTests,
  togglePopularTestStatus,
};
