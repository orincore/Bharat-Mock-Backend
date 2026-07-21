const prisma = require('../config/prisma');
const logger = require('../config/logger');

const getCourses = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      level
    } = req.query;

    const offset = (page - 1) * limit;

    const where = {
      is_published: true,
      deleted_at: null,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (level) {
      where.level = level;
    }

    const [courses, count] = await Promise.all([
      prisma.courses.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: offset,
        take: parseInt(limit),
      }),
      prisma.courses.count({ where }),
    ]);

    res.json({
      success: true,
      data: courses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get courses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses'
    });
  }
};

const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;

    const course = await prisma.courses.findFirst({
      where: { id, is_published: true, deleted_at: null },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    const [eligibility, careerProspects, topColleges] = await Promise.all([
      prisma.course_eligibility.findMany({
        where: { course_id: id },
        select: { eligibility: true },
      }),
      prisma.course_career_prospects.findMany({
        where: { course_id: id },
        select: { prospect: true },
      }),
      prisma.course_top_colleges.findMany({
        where: { course_id: id },
        include: {
          colleges: {
            select: { id: true, name: true, location: true, ranking: true, image_url: true },
          },
        },
      }),
    ]);

    course.eligibility = eligibility.map(e => e.eligibility) || [];
    course.careerProspects = careerProspects.map(c => c.prospect) || [];
    course.topColleges = topColleges.map(tc => tc.colleges?.name).filter(Boolean) || [];

    res.json({
      success: true,
      data: course
    });
  } catch (error) {
    logger.error('Get course by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch course details'
    });
  }
};

module.exports = {
  getCourses,
  getCourseById
};
