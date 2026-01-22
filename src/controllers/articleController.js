const supabase = require('../config/database');
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

    let query = supabase
      .from('articles')
      .select(`
        id,
        slug,
        title,
        excerpt,
        category,
        image_url,
        read_time,
        views,
        published_at,
        authors (
          id,
          name,
          avatar_url
        )
      `, { count: 'exact' })
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('published_at', { ascending: false });

    if (search) {
      query = query.or(`title.ilike.%${search}%,excerpt.ilike.%${search}%`);
    }

    if (category) {
      query = query.eq('category', category);
    }

    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: articles, error, count } = await query;

    if (error) {
      logger.error('Get articles error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch articles'
      });
    }

    for (let article of articles) {
      const { data: tags } = await supabase
        .from('article_tags')
        .select('tag')
        .eq('article_id', article.id);
      
      article.tags = tags?.map(t => t.tag) || [];
      article.author = article.authors;
      delete article.authors;
    }

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

    const { data: article, error } = await supabase
      .from('articles')
      .select(`
        id,
        slug,
        title,
        excerpt,
        content,
        category,
        image_url,
        read_time,
        views,
        published_at,
        meta_title,
        meta_description,
        authors (
          id,
          name,
          avatar_url,
          bio
        )
      `)
      .eq('slug', slug)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();

    if (error || !article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    const { data: tags } = await supabase
      .from('article_tags')
      .select('tag')
      .eq('article_id', article.id);

    article.tags = tags?.map(t => t.tag) || [];
    article.author = article.authors;
    delete article.authors;

    await supabase
      .from('articles')
      .update({ views: (article.views || 0) + 1 })
      .eq('id', article.id);

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
    const { data: categories, error } = await supabase
      .from('articles')
      .select('category')
      .eq('is_published', true)
      .is('deleted_at', null);

    if (error) {
      logger.error('Get categories error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch categories'
      });
    }

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
    const { data: tags, error } = await supabase
      .from('article_tags')
      .select('tag, article_id')
      .limit(100);

    if (error) {
      logger.error('Get tags error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch tags'
      });
    }

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
