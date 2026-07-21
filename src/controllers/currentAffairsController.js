const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { uploadToR2 } = require('../utils/fileUpload');

const examBriefSelect = {
  id: true, title: true, slug: true, url_path: true, status: true, start_date: true, end_date: true,
  exam_type: true, duration: true, total_marks: true, total_questions: true, thumbnail_url: true, category: true,
};

const mapVideo = (record) => ({
  id: record.id,
  title: record.title,
  description: record.description || null,
  thumbnailUrl: record.thumbnail_url || null,
  videoUrl: record.video_url,
  platform: record.platform || null,
  durationSeconds: record.duration_seconds || null,
  tag: record.tag || 'daily',
  isFeatured: Boolean(record.is_featured),
  isPublished: Boolean(record.is_published),
  displayOrder: record.display_order || 0,
  publishedAt: record.published_at,
  createdAt: record.created_at,
  updatedAt: record.updated_at
});

const mapQuiz = (record, exam) => ({
  id: record.id,
  examId: record.exam_id,
  highlightLabel: record.highlight_label || null,
  summary: record.summary || null,
  badge: record.badge || null,
  tag: record.tag || null,
  isPublished: Boolean(record.is_published),
  displayOrder: record.display_order || 0,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
  exam: exam || null
});

const mapNote = (blog) => ({
  id: blog.id,
  title: blog.title,
  slug: blog.slug,
  excerpt: blog.excerpt,
  publishedAt: blog.published_at,
  featuredImageUrl: blog.featured_image_url,
  tag: blog.current_affairs_tag || blog.category || null
});

const mapSettings = (record) => ({
  id: record.id,
  heroBadge: record.hero_badge || null,
  heroTitle: record.hero_title || 'Current Affairs Videos, Notes & Quizzes',
  heroSubtitle: record.hero_subtitle || null,
  heroDescription: record.hero_description || null,
  heroCtaLabel: record.hero_cta_label || 'Explore Resources',
  heroCtaUrl: record.hero_cta_url || '/current-affairs',
  seoTitle: record.seo_title || null,
  seoDescription: record.seo_description || null,
  seoKeywords: record.seo_keywords || [],
  updatedAt: record.updated_at
});

const getSingletonSettings = async () => {
  let data;
  try {
    data = await prisma.current_affairs_settings.findFirst({
      orderBy: { updated_at: 'desc' },
    });
  } catch (error) {
    logger.error('[current-affairs] failed to fetch settings', error);
    throw new Error('Failed to fetch settings');
  }

  if (!data) {
    try {
      return await prisma.current_affairs_settings.create({ data: {} });
    } catch (insertError) {
      logger.error('[current-affairs] failed to create default settings', insertError);
      throw new Error('Failed to initialize settings');
    }
  }

  return data;
};

const buildError = (res, message, error) => {
  if (error) logger.error(`[current-affairs] ${message}`, error);
  return res.status(500).json({ success: false, message });
};

const currentAffairsController = {
  async getPublicPage(_, res) {
    try {
      const settingsRecord = await getSingletonSettings();
      const settings = mapSettings(settingsRecord);

      let videosData, quizLinks, notesData;
      try {
        [videosData, quizLinks, notesData] = await Promise.all([
          prisma.current_affairs_videos.findMany({
            where: { is_published: true },
            orderBy: [{ is_featured: 'desc' }, { display_order: 'asc' }, { published_at: 'desc' }],
            take: 18,
          }),
          prisma.current_affairs_quizzes.findMany({
            where: { is_published: true },
            orderBy: [{ display_order: 'asc' }, { updated_at: 'desc' }],
            take: 12,
          }),
          prisma.blogs.findMany({
            where: { is_current_affairs_note: true, is_published: true },
            select: { id: true, title: true, slug: true, excerpt: true, featured_image_url: true, published_at: true, current_affairs_tag: true, category: true },
            orderBy: { published_at: 'desc' },
            take: 9,
          }),
        ]);
      } catch (error) {
        return buildError(res, 'Failed to load current affairs data', error);
      }

      const videos = (videosData || []).map(mapVideo);

      let examMap = {};
      const examIds = quizLinks.map((item) => item.exam_id).filter(Boolean);
      if (examIds.length) {
        let examsData;
        try {
          examsData = await prisma.exams.findMany({
            where: { id: { in: examIds } },
            select: {
              id: true, title: true, slug: true, url_path: true, status: true, start_date: true, end_date: true,
              exam_type: true, duration: true, total_marks: true, total_questions: true, pass_percentage: true,
              is_free: true, supports_hindi: true, negative_marking: true, negative_mark_value: true,
              allow_anytime: true, thumbnail_url: true, category: true, difficulty: true, created_at: true, updated_at: true,
            },
          });
        } catch (examsError) {
          return buildError(res, 'Failed to load quiz details', examsError);
        }
        examMap = (examsData || []).reduce((acc, exam) => {
          acc[exam.id] = exam;
          return acc;
        }, {});
      }

      const quizzes = quizLinks.map((record) => mapQuiz(record, examMap[record.exam_id] || null));
      const notes = (notesData || []).map(mapNote);

      return res.json({
        success: true,
        data: {
          settings,
          videos,
          quizzes,
          notes
        }
      });
    } catch (error) {
      return buildError(res, 'Failed to load current affairs data', error);
    }
  },

  async getSettings(_, res) {
    try {
      const settings = await getSingletonSettings();
      return res.json({ success: true, data: mapSettings(settings) });
    } catch (error) {
      return buildError(res, 'Failed to fetch settings', error);
    }
  },

  async updateSettings(req, res) {
    try {
      const existing = await getSingletonSettings();
      const payload = {
        hero_badge: req.body.heroBadge ?? existing.hero_badge,
        hero_title: req.body.heroTitle ?? existing.hero_title,
        hero_subtitle: req.body.heroSubtitle ?? existing.hero_subtitle,
        hero_description: req.body.heroDescription ?? existing.hero_description,
        hero_cta_label: req.body.heroCtaLabel ?? existing.hero_cta_label,
        hero_cta_url: req.body.heroCtaUrl ?? existing.hero_cta_url,
        seo_title: req.body.seoTitle ?? existing.seo_title,
        seo_description: req.body.seoDescription ?? existing.seo_description,
        seo_keywords: Array.isArray(req.body.seoKeywords) ? req.body.seoKeywords : existing.seo_keywords,
        updated_at: new Date().toISOString()
      };

      let data;
      try {
        data = await prisma.current_affairs_settings.update({ where: { id: existing.id }, data: payload });
      } catch (error) {
        return buildError(res, 'Failed to update settings', error);
      }

      return res.json({ success: true, data: mapSettings(data) });
    } catch (error) {
      return buildError(res, 'Failed to update settings', error);
    }
  },

  async listVideos(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
      const tag = req.query.tag;

      let data;
      try {
        data = await prisma.current_affairs_videos.findMany({
          where: tag ? { tag } : {},
          orderBy: [{ display_order: 'asc' }, { updated_at: 'desc' }],
          take: limit,
        });
      } catch (error) {
        return buildError(res, 'Failed to load videos', error);
      }

      return res.json({ success: true, data: (data || []).map(mapVideo) });
    } catch (error) {
      return buildError(res, 'Failed to load videos', error);
    }
  },

  async createVideo(req, res) {
    try {
      const {
        title,
        description,
        thumbnailUrl,
        videoUrl,
        platform,
        durationSeconds,
        tag,
        isFeatured,
        isPublished,
        displayOrder,
        publishedAt
      } = req.body || {};

      if (!title || !videoUrl) {
        return res.status(400).json({ success: false, message: 'Title and video URL are required' });
      }

      const payload = {
        title: title.trim(),
        description: description || null,
        thumbnail_url: thumbnailUrl || null,
        video_url: videoUrl,
        platform: platform || null,
        duration_seconds: durationSeconds ? parseInt(durationSeconds, 10) : null,
        tag: tag || 'daily',
        is_featured: Boolean(isFeatured),
        is_published: typeof isPublished === 'boolean' ? isPublished : true,
        display_order: displayOrder ? parseInt(displayOrder, 10) : 0,
        published_at: publishedAt || new Date().toISOString()
      };

      let data;
      try {
        data = await prisma.current_affairs_videos.create({ data: payload });
      } catch (error) {
        return buildError(res, 'Failed to create video', error);
      }

      return res.status(201).json({ success: true, data: mapVideo(data) });
    } catch (error) {
      return buildError(res, 'Failed to create video', error);
    }
  },

  async updateVideo(req, res) {
    try {
      const { id } = req.params;
      const updates = {};
      const allowedFields = {
        title: 'title',
        description: 'description',
        thumbnailUrl: 'thumbnail_url',
        videoUrl: 'video_url',
        platform: 'platform',
        durationSeconds: 'duration_seconds',
        tag: 'tag',
        isFeatured: 'is_featured',
        isPublished: 'is_published',
        displayOrder: 'display_order',
        publishedAt: 'published_at'
      };

      Object.entries(req.body || {}).forEach(([key, value]) => {
        if (!(key in allowedFields)) return;
        if (key === 'durationSeconds' || key === 'displayOrder') {
          updates[allowedFields[key]] = value === null || value === undefined ? null : parseInt(value, 10);
        } else if (key === 'isFeatured' || key === 'isPublished') {
          updates[allowedFields[key]] = Boolean(value);
        } else {
          updates[allowedFields[key]] = value;
        }
      });

      if (!Object.keys(updates).length) {
        return res.status(400).json({ success: false, message: 'No updates provided' });
      }

      let data;
      try {
        data = await prisma.current_affairs_videos.update({ where: { id }, data: updates });
      } catch (error) {
        return buildError(res, 'Failed to update video', error);
      }

      return res.json({ success: true, data: mapVideo(data) });
    } catch (error) {
      return buildError(res, 'Failed to update video', error);
    }
  },

  async deleteVideo(req, res) {
    try {
      const { id } = req.params;
      try {
        await prisma.current_affairs_videos.delete({ where: { id } });
      } catch (error) {
        return buildError(res, 'Failed to delete video', error);
      }

      return res.json({ success: true });
    } catch (error) {
      return buildError(res, 'Failed to delete video', error);
    }
  },

  async uploadVideoAsset(req, res) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: 'No video provided' });
      }

      const uploadResult = await uploadToR2(file, 'current-affairs/videos');
      if (!uploadResult?.url) {
        return buildError(res, 'Failed to upload video', new Error('Storage upload missing URL'));
      }

      return res.status(201).json({ success: true, file_url: uploadResult.url, file_key: uploadResult.key });
    } catch (error) {
      return buildError(res, 'Failed to upload video', error);
    }
  },

  async uploadThumbnailAsset(req, res) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: 'No image provided' });
      }

      const uploadResult = await uploadToR2(file, 'current-affairs/thumbnails');
      if (!uploadResult?.url) {
        return buildError(res, 'Failed to upload thumbnail', new Error('Storage upload missing URL'));
      }

      return res.status(201).json({ success: true, file_url: uploadResult.url, file_key: uploadResult.key });
    } catch (error) {
      return buildError(res, 'Failed to upload thumbnail', error);
    }
  },

  async listQuizzes(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
      let data;
      try {
        data = await prisma.current_affairs_quizzes.findMany({
          orderBy: [{ display_order: 'asc' }, { updated_at: 'desc' }],
          take: limit,
        });
      } catch (error) {
        return buildError(res, 'Failed to load quizzes', error);
      }

      const examIds = (data || []).map((record) => record.exam_id);
      let examMap = {};
      if (examIds.length) {
        let exams;
        try {
          exams = await prisma.exams.findMany({
            where: { id: { in: examIds } },
            select: examBriefSelect,
          });
        } catch (examsError) {
          return buildError(res, 'Failed to load quiz exams', examsError);
        }
        examMap = (exams || []).reduce((acc, exam) => {
          acc[exam.id] = exam;
          return acc;
        }, {});
      }

      const payload = (data || []).map((record) => mapQuiz(record, examMap[record.exam_id] || null));
      return res.json({ success: true, data: payload });
    } catch (error) {
      return buildError(res, 'Failed to load quizzes', error);
    }
  },

  async createQuiz(req, res) {
    try {
      const { examId, highlightLabel, summary, tag, badge, isPublished, displayOrder } = req.body || {};
      if (!examId) {
        return res.status(400).json({ success: false, message: 'examId is required' });
      }

      const exam = await prisma.exams.findUnique({ where: { id: examId }, select: examBriefSelect });

      if (!exam) {
        return res.status(404).json({ success: false, message: 'Exam not found' });
      }

      const payload = {
        exam_id: examId,
        highlight_label: highlightLabel || null,
        summary: summary || null,
        tag: tag || null,
        badge: badge || null,
        is_published: typeof isPublished === 'boolean' ? isPublished : true,
        display_order: displayOrder ? parseInt(displayOrder, 10) : 0
      };

      let data;
      try {
        data = await prisma.current_affairs_quizzes.create({ data: payload });
      } catch (error) {
        if (error.code === 'P2002') {
          return res.status(409).json({ success: false, message: 'Exam already linked to current affairs' });
        }
        return buildError(res, 'Failed to create quiz entry', error);
      }

      return res.status(201).json({ success: true, data: mapQuiz(data, exam) });
    } catch (error) {
      return buildError(res, 'Failed to create quiz entry', error);
    }
  },

  async updateQuiz(req, res) {
    try {
      const { id } = req.params;
      const updates = {};
      const {
        examId,
        highlightLabel,
        summary,
        tag,
        badge,
        isPublished,
        displayOrder
      } = req.body || {};

      let linkedExam = null;
      if (examId) {
        const exam = await prisma.exams.findUnique({ where: { id: examId }, select: examBriefSelect });

        if (!exam) {
          return res.status(404).json({ success: false, message: 'Exam not found' });
        }
        linkedExam = exam;
        updates.exam_id = examId;
      }

      if (typeof highlightLabel !== 'undefined') updates.highlight_label = highlightLabel;
      if (typeof summary !== 'undefined') updates.summary = summary;
      if (typeof tag !== 'undefined') updates.tag = tag;
      if (typeof badge !== 'undefined') updates.badge = badge;
      if (typeof isPublished !== 'undefined') updates.is_published = Boolean(isPublished);
      if (typeof displayOrder !== 'undefined') updates.display_order = parseInt(displayOrder, 10);

      if (!Object.keys(updates).length) {
        return res.status(400).json({ success: false, message: 'No updates provided' });
      }

      let data;
      try {
        data = await prisma.current_affairs_quizzes.update({ where: { id }, data: updates });
      } catch (error) {
        return buildError(res, 'Failed to update quiz entry', error);
      }

      if (!linkedExam && data.exam_id) {
        const exam = await prisma.exams.findUnique({ where: { id: data.exam_id }, select: examBriefSelect });
        if (exam) {
          linkedExam = exam;
        }
      }

      return res.json({ success: true, data: mapQuiz(data, linkedExam) });
    } catch (error) {
      return buildError(res, 'Failed to update quiz entry', error);
    }
  },

  async deleteQuiz(req, res) {
    try {
      const { id } = req.params;
      try {
        await prisma.current_affairs_quizzes.delete({ where: { id } });
      } catch (error) {
        return buildError(res, 'Failed to delete quiz entry', error);
      }
      return res.json({ success: true });
    } catch (error) {
      return buildError(res, 'Failed to delete quiz entry', error);
    }
  }
};

module.exports = currentAffairsController;
