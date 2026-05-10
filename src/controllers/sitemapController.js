const supabase = require('../config/database');
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
      blogsResult,
      testSeriesResult,
      categoriesResult,
      subcategoriesResult,
      examsResult,
      pageContentResult
    ] = await Promise.all([
      // Blogs - only published
      supabase
        .from('blogs')
        .select('slug, updated_at')
        .eq('is_published', true)
        .order('updated_at', { ascending: false })
        .limit(1000),

      // Test series - only published
      supabase
        .from('test_series')
        .select('slug, updated_at')
        .eq('is_published', true)
        .order('updated_at', { ascending: false })
        .limit(1000),

      // Categories
      supabase
        .from('exam_categories')
        .select('slug, updated_at')
        .or('is_active.eq.true,is_active.is.null')
        .order('updated_at', { ascending: false })
        .limit(500),

      // Subcategories with category slug for URL construction
      supabase
        .from('exam_subcategories')
        .select('id, slug, updated_at, exam_categories!inner(slug)')
        .or('is_active.eq.true,is_active.is.null')
        .order('updated_at', { ascending: false })
        .limit(1000),

      // Exams with PDF URLs - only fetch necessary fields
      supabase
        .from('exams')
        .select('url_path, updated_at, pdf_url_en, pdf_url_hi, title')
        .eq('is_published', true)
        .is('deleted_at', null)
        .not('url_path', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(5000),

      // Custom tabs for subcategories
      supabase
        .from('subcategory_custom_tabs')
        .select('subcategory_id, title, tab_key, updated_at')
        .order('display_order', { ascending: true })
    ]);

    // Check for errors
    const results = [
      { name: 'blogs', result: blogsResult },
      { name: 'testSeries', result: testSeriesResult },
      { name: 'categories', result: categoriesResult },
      { name: 'subcategories', result: subcategoriesResult },
      { name: 'exams', result: examsResult },
      { name: 'customTabs', result: pageContentResult }
    ];

    for (const { name, result } of results) {
      if (result.error) {
        logger.error(`Sitemap ${name} query error:`, result.error);
      }
    }

    // Process subcategories - map to include category slug
    const subcategories = (subcategoriesResult.data || []).map(sub => ({
      id: sub.id,
      slug: sub.slug,
      category_slug: sub.exam_categories?.slug,
      updated_at: sub.updated_at
    }));

    // Build custom tabs map by subcategory_id
    const customTabsMap = new Map();
    for (const tab of (pageContentResult.data || [])) {
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
    const staticTabSlugs = ['mock-tests', 'previous-papers'];

    for (const sub of subcategories) {
      const lastMod = sub.updated_at || now;

      // Add static tabs
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
