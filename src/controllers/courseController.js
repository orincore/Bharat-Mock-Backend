const supabase = require('../config/database');
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

    let query = supabase
      .from('courses')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .is('deleted_at', null);

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (level) {
      query = query.eq('level', level);
    }

    query = query.order('name').range(offset, offset + parseInt(limit) - 1);

    const { data: courses, error, count } = await query;

    if (error) {
      logger.error('Get courses error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch courses'
      });
    }

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

    const { data: course, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', id)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();

    if (error || !course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    const { data: eligibility } = await supabase
      .from('course_eligibility')
      .select('eligibility')
      .eq('course_id', id);

    const { data: careerProspects } = await supabase
      .from('course_career_prospects')
      .select('prospect')
      .eq('course_id', id);

    const { data: topColleges } = await supabase
      .from('course_top_colleges')
      .select(`
        colleges (
          id,
          name,
          location,
          ranking,
          image_url
        )
      `)
      .eq('course_id', id);

    course.eligibility = eligibility?.map(e => e.eligibility) || [];
    course.careerProspects = careerProspects?.map(c => c.prospect) || [];
    course.topColleges = topColleges?.map(tc => tc.colleges.name) || [];

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
