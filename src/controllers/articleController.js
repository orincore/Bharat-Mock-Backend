const prisma = require('../config/prisma');
const logger = require('../config/logger');

const getArticles = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category
    } = req.query;

    const offset = (page - 1) * limit;

    const where = {
      is_published: true,
      deleted_at: null,
    };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { excerpt: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.category = category;
    }

    // Fetch tags via the relation in the same query instead of one extra query per
    // article in a loop (N+1) — same result shape, far fewer round trips.
    const [rows, count] = await Promise.all([
      prisma.articles.findMany({
        where,
        select: {
          id: true, slug: true, title: true, excerpt: true, category: true, image_url: true,
          read_time: true, views: true, published_at: true,
          authors: { select: { id: true, name: true, avatar_url: true } },
          article_tags: { select: { tag: true } },
        },
        orderBy: { published_at: 'desc' },
        skip: offset,
        take: parseInt(limit),
      }),
      prisma.articles.count({ where }),
    ]);

    const articles = rows.map(({ authors, article_tags, ...rest }) => ({
      ...rest,
      author: authors,
      tags: article_tags.map(t => t.tag),
    }));

    res.json({
      success: true,
      data: articles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get articles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch articles'
    });
  }
};

const getArticleBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const row = await prisma.articles.findFirst({
      where: { slug, is_published: true, deleted_at: null },
      select: {
        id: true, slug: true, title: true, excerpt: true, content: true, category: true,
        image_url: true, read_time: true, views: true, published_at: true,
        meta_title: true, meta_description: true,
        authors: { select: { id: true, name: true, avatar_url: true, bio: true } },
        article_tags: { select: { tag: true } },
      },
    });

    if (!row) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    const { authors, article_tags, ...rest } = row;
    const article = {
      ...rest,
      author: authors,
      tags: article_tags.map(t => t.tag),
    };

    await prisma.articles.update({
      where: { id: article.id },
      data: { views: (article.views || 0) + 1 },
    });

    res.json({
      success: true,
      data: article
    });
  } catch (error) {
    logger.error('Get article by slug error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch article'
    });
  }
};

const getArticleCategories = async (req, res) => {
  try {
    const categories = await prisma.articles.findMany({
      where: { is_published: true, deleted_at: null },
      select: { category: true },
    });

    const uniqueCategories = [...new Set(categories.map(c => c.category))];

    res.json({
      success: true,
      data: uniqueCategories
    });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};

const getPopularTags = async (req, res) => {
  try {
    const tags = await prisma.article_tags.findMany({
      select: { tag: true, article_id: true },
      take: 100,
    });

    const tagCounts = tags.reduce((acc, { tag }) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {});

    const popularTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    res.json({
      success: true,
      data: popularTags
    });
  } catch (error) {
    logger.error('Get popular tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular tags'
    });
  }
};

module.exports = {
  getArticles,
  getArticleBySlug,
  getArticleCategories,
  getPopularTags
};
