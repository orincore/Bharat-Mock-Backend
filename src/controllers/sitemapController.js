const prisma = require('../config/prisma');
const logger = require('../config/logger');

/**
 * Optimized sitemap data endpoint
 * Returns all data needed for sitemap.xml in a single efficient query
 * Reduces N+1 API calls to a single backend endpoint
 */
const getSitemapData = async (req, res) => {
  try {
    const now = new Date().toISOString();

    // Fetch all data in parallel using optimized queries
    const [
      blogsRows,
      testSeriesRows,
      categoriesRows,
      subcategoriesRows,
      examsRows,
      customTabsRows
    ] = await Promise.all([
      // Blogs - only published
      prisma.blogs.findMany({
        where: { is_published: true },
        select: { slug: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
        take: 1000,
      }),

      // Test series - only published
      prisma.test_series.findMany({
        where: { is_published: true },
        select: { slug: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
        take: 1000,
      }),

      // Categories
      prisma.exam_categories.findMany({
        where: { OR: [{ is_active: true }, { is_active: null }] },
        select: { slug: true, updated_at: true },
        orderBy: { updated_at: 'desc' },
        take: 500,
      }),

      // Subcategories with category slug for URL construction (category_id not-null
      // reproduces supabase's `exam_categories!inner(slug)` required-join semantics)
      prisma.exam_subcategories.findMany({
        where: {
          OR: [{ is_active: true }, { is_active: null }],
          category_id: { not: null },
        },
        select: {
          id: true, slug: true, updated_at: true, show_mock_tests_tab: true, show_previous_papers_tab: true,
          exam_categories: { select: { slug: true } },
        },
        orderBy: { updated_at: 'desc' },
        take: 1000,
      }),

      // Exams with PDF URLs - only fetch necessary fields
      prisma.exams.findMany({
        where: {
          is_published: true,
          deleted_at: null,
          url_path: { not: null },
        },
        select: { url_path: true, updated_at: true, pdf_url_en: true, pdf_url_hi: true, title: true },
        orderBy: { updated_at: 'desc' },
        take: 5000,
      }),

      // Custom tabs for subcategories
      prisma.subcategory_custom_tabs.findMany({
        select: { subcategory_id: true, title: true, tab_key: true, updated_at: true },
        orderBy: { display_order: 'asc' },
      }),
    ]);

    const blogsResult = { data: blogsRows };
    const testSeriesResult = { data: testSeriesRows };
    const categoriesResult = { data: categoriesRows };
    const examsResult = { data: examsRows };

    // Process subcategories - map to include category slug
    const subcategories = subcategoriesRows.map(sub => ({
      id: sub.id,
      slug: sub.slug,
      category_slug: sub.exam_categories?.slug,
      updated_at: sub.updated_at,
      show_mock_tests_tab: sub.show_mock_tests_tab,
      show_previous_papers_tab: sub.show_previous_papers_tab
    }));

    // Build custom tabs map by subcategory_id
    const customTabsMap = new Map();
    for (const tab of customTabsRows) {
      if (!customTabsMap.has(tab.subcategory_id)) {
        customTabsMap.set(tab.subcategory_id, []);
      }
      customTabsMap.get(tab.subcategory_id).push({
        title: tab.title,
        tab_key: tab.tab_key,
        updated_at: tab.updated_at
      });
    }

    // Sanitize tab slug helper
    const sanitizeTabSlug = (value) => {
      if (!value) return '';
      return value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/--+/g, '-');
    };

    // Generate subcategory tab URLs
    const subcategoryTabUrls = [];

    for (const sub of subcategories) {
      const lastMod = sub.updated_at || now;

      // Add reserved tabs only when the admin hasn't hidden them
      const staticTabSlugs = [
        ...(sub.show_mock_tests_tab !== false ? ['mock-tests'] : []),
        ...(sub.show_previous_papers_tab !== false ? ['previous-papers'] : [])
      ];
      for (const tabSlug of staticTabSlugs) {
        subcategoryTabUrls.push({
          url: `/${sub.slug}/${tabSlug}`,
          lastModified: lastMod,
          changeFrequency: 'weekly',
          priority: 0.65
        });
      }

      // Add custom tabs
      const tabs = customTabsMap.get(sub.id) || [];
      for (const tab of tabs) {
        const tabSlug = sanitizeTabSlug(tab.tab_key || tab.title);
        if (!tabSlug || tabSlug === 'overview') continue;
        subcategoryTabUrls.push({
          url: `/${sub.slug}/${tabSlug}`,
          lastModified: tab.updated_at || lastMod,
          changeFrequency: 'weekly',
          priority: 0.65
        });
      }
    }

    // Generate PDF URLs from exams
    const pdfUrls = [];
    for (const exam of (examsResult.data || [])) {
      const lastMod = exam.updated_at || now;

      if (exam.pdf_url_en) {
        pdfUrls.push({
          url: exam.pdf_url_en,
          lastModified: lastMod,
          changeFrequency: 'monthly',
          priority: 0.5
        });
      }
      if (exam.pdf_url_hi) {
        pdfUrls.push({
          url: exam.pdf_url_hi,
          lastModified: lastMod,
          changeFrequency: 'monthly',
          priority: 0.5
        });
      }
    }

    // Build response
    const response = {
      success: true,
      data: {
        // Static pages (frontend handles these, but included for reference)
        staticPages: [],

        // Dynamic content
        blogs: (blogsResult.data || []).map(b => ({
          url: `/blogs/${b.slug}`,
          lastModified: b.updated_at || now,
          changeFrequency: 'weekly',
          priority: 0.7
        })),

        testSeries: (testSeriesResult.data || []).map(ts => ({
          url: `/test-series/${ts.slug}`,
          lastModified: ts.updated_at || now,
          changeFrequency: 'weekly',
          priority: 0.8
        })),

        categories: (categoriesResult.data || []).map(c => ({
          url: `/${c.slug}`,
          lastModified: c.updated_at || now,
          changeFrequency: 'weekly',
          priority: 0.8
        })),

        subcategories: subcategories.map(s => ({
          url: `/${s.slug}`,
          lastModified: s.updated_at || now,
          changeFrequency: 'weekly',
          priority: 0.7
        })),

        exams: (examsResult.data || [])
          .filter(e => e.url_path && e.url_path.startsWith('/'))
          .map(e => ({
            url: e.url_path,
            lastModified: e.updated_at || now,
            changeFrequency: 'weekly',
            priority: 0.6
          })),

        subcategoryTabs: subcategoryTabUrls,
        pdfs: pdfUrls
      },
      meta: {
        generatedAt: now,
        counts: {
          blogs: (blogsResult.data || []).length,
          testSeries: (testSeriesResult.data || []).length,
          categories: (categoriesResult.data || []).length,
          subcategories: subcategories.length,
          exams: (examsResult.data || []).length,
          subcategoryTabs: subcategoryTabUrls.length,
          pdfs: pdfUrls.length
        }
      }
    };

    res.json(response);
  } catch (error) {
    logger.error('Sitemap data generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate sitemap data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getSitemapData
};
