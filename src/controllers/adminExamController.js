const supabase = require('../config/database');
const logger = require('../config/logger');
const { uploadExamLogo, uploadExamThumbnail, uploadQuestionImage, uploadOptionImage, deleteFile, extractKeyFromUrl } = require('../services/uploadService');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

const getAdminExams = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      category,
      difficulty
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('exams')
      .select(`
        id,
        title,
        description,
        duration,
        total_marks,
        total_questions,
        category,
        subcategory,
        difficulty,
        status,
        start_date,
        end_date,
        pass_percentage,
        is_free,
        price,
        logo_url,
        thumbnail_url,
        negative_marking,
        negative_mark_value,
        is_published,
        created_at,
        updated_at
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('Get admin exams error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exams'
      });
    }

    res.json({
      success: true,
      data: exams,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0
      }
    });
  } catch (error) {
    logger.error('Get admin exams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching exams'
    });
  }
};

const getExamSectionsWithQuestions = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('id')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (examError || !exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    const { data: sections, error: sectionsError } = await supabase
      .from('exam_sections')
      .select('id, name, total_questions, marks_per_question, duration, section_order')
      .eq('exam_id', id)
      .order('section_order');

    if (sectionsError) {
      logger.error('Get sections error:', sectionsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exam sections'
      });
    }

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select(`
        id,
        section_id,
        type,
        text,
        marks,
        negative_marks,
        explanation,
        difficulty,
        image_url,
        question_order,
        question_options (
          id,
          option_text,
          is_correct,
          option_order,
          image_url
        )
      `)
      .eq('exam_id', id)
      .is('deleted_at', null)
      .order('question_order');

    if (questionsError) {
      logger.error('Get questions error:', questionsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch exam questions'
      });
    }

    const sectionsWithQuestions = sections.map(section => ({
      id: section.id,
      name: section.name,
      total_questions: section.total_questions,
      marks_per_question: section.marks_per_question,
      duration: section.duration,
      section_order: section.section_order,
      questions: questions
        .filter(q => q.section_id === section.id)
        .map(q => ({
          id: q.id,
          type: q.type,
          text: q.text,
          marks: q.marks,
          negative_marks: q.negative_marks,
          explanation: q.explanation,
          difficulty: q.difficulty,
          image_url: q.image_url,
          question_order: q.question_order,
          options: (q.question_options || [])
            .sort((a, b) => a.option_order - b.option_order)
            .map(opt => ({
              id: opt.id,
              option_text: opt.option_text,
              is_correct: opt.is_correct,
              option_order: opt.option_order,
              image_url: opt.image_url
            }))
        }))
    }));

    res.json({
      success: true,
      data: sectionsWithQuestions
    });
  } catch (error) {
    logger.error('Get exam sections/questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam sections and questions'
    });
  }
};

const getAdminExamById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: exam, error } = await supabase
      .from('exams')
      .select(`
        id,
        title,
        description,
        duration,
        total_marks,
        total_questions,
        category,
        category_id,
        subcategory,
        subcategory_id,
        difficulty,
        difficulty_id,
        status,
        start_date,
        end_date,
        pass_percentage,
        is_free,
        price,
        is_published,
        logo_url,
        thumbnail_url,
        negative_marking,
        negative_mark_value,
        slug,
        url_path,
        syllabus,
        allow_anytime
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    const { data: syllabusRows } = await supabase
      .from('exam_syllabus')
      .select('topic')
      .eq('exam_id', id);

    exam.syllabus = syllabusRows?.map(row => row.topic) || exam.syllabus || [];

    res.json({
      success: true,
      data: exam
    });
  } catch (error) {
    logger.error('Get admin exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam details'
    });
  }
};

const createExam = async (req, res) => {
  try {
    const {
      title,
      description,
      duration,
      total_marks,
      total_questions,
      category,
      category_id,
      subcategory,
      subcategory_id,
      difficulty,
      difficulty_id,
      status,
      start_date,
      end_date,
      pass_percentage,
      is_free,
      price,
      negative_marking,
      negative_mark_value,
      syllabus,
      slug: customSlug,
      is_published,
      allow_anytime
    } = req.body;

    let logoUrl = null;
    let thumbnailUrl = null;

    if (req.files) {
      if (req.files.logo) {
        const logoResult = await uploadExamLogo(req.files.logo[0]);
        logoUrl = logoResult.url;
      }
      if (req.files.thumbnail) {
        const thumbnailResult = await uploadExamThumbnail(req.files.thumbnail[0]);
        thumbnailUrl = thumbnailResult.url;
      }
    }

    const examSlug = await ensureUniqueSlug(supabase, 'exams', slugify(customSlug || title));
    
    let categorySlug = category || '';
    let subcategorySlug = subcategory || '';
    
    if (category_id) {
      const { data: cat } = await supabase.from('exam_categories').select('slug').eq('id', category_id).single();
      if (cat) categorySlug = cat.slug;
    }
    
    if (subcategory_id) {
      const { data: subcat } = await supabase.from('exam_subcategories').select('slug').eq('id', subcategory_id).single();
      if (subcat) subcategorySlug = subcat.slug;
    }
    
    const urlPath = `/${categorySlug}/${subcategorySlug}/${examSlug}`.replace(/\/+/g, '/');

    const parsedSyllabus = syllabus ? JSON.parse(syllabus) : [];

    const { data: exam, error } = await supabase
      .from('exams')
      .insert({
        title,
        description,
        duration: parseInt(duration),
        total_marks: parseInt(total_marks),
        total_questions: parseInt(total_questions),
        category: category || categorySlug,
        category_id: category_id || null,
        subcategory: subcategory || subcategorySlug,
        subcategory_id: subcategory_id || null,
        difficulty: difficulty || null,
        difficulty_id: difficulty_id || null,
        status: status || 'upcoming',
        start_date,
        end_date,
        pass_percentage: parseFloat(pass_percentage),
        is_free: is_free === 'true' || is_free === true,
        price: parseFloat(price) || 0,
        negative_marking: negative_marking === 'true' || negative_marking === true,
        negative_mark_value: parseFloat(negative_mark_value) || 0,
        is_published: is_published === 'true' || is_published === true,
        allow_anytime: allow_anytime === 'true' || allow_anytime === true,
        logo_url: logoUrl,
        thumbnail_url: thumbnailUrl,
        slug: examSlug,
        url_path: urlPath,
        syllabus: parsedSyllabus
      })
      .select()
      .single();

    if (error) {
      logger.error('Create exam error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create exam'
      });
    }

    if (parsedSyllabus?.length) {
      const syllabusPayload = parsedSyllabus.map(topic => ({
        exam_id: exam.id,
        topic
      }));
      const { error: syllabusError } = await supabase
        .from('exam_syllabus')
        .insert(syllabusPayload);

      if (syllabusError) {
        logger.error('Insert syllabus error:', syllabusError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: exam
    });
  } catch (error) {
    logger.error('Create exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating exam'
    });
  }
};

const updateExam = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const { data: existingExam } = await supabase
      .from('exams')
      .select('logo_url, thumbnail_url')
      .eq('id', id)
      .single();

    if (req.files) {
      if (req.files.logo) {
        if (existingExam?.logo_url) {
          const oldKey = extractKeyFromUrl(existingExam.logo_url);
          if (oldKey) await deleteFile(oldKey);
        }
        const logoResult = await uploadExamLogo(req.files.logo[0]);
        updateData.logo_url = logoResult.url;
      }
      if (req.files.thumbnail) {
        if (existingExam?.thumbnail_url) {
          const oldKey = extractKeyFromUrl(existingExam.thumbnail_url);
          if (oldKey) await deleteFile(oldKey);
        }
        const thumbnailResult = await uploadExamThumbnail(req.files.thumbnail[0]);
        updateData.thumbnail_url = thumbnailResult.url;
      }
    }

    if (updateData.duration) updateData.duration = parseInt(updateData.duration);
    if (updateData.total_marks) updateData.total_marks = parseInt(updateData.total_marks);
    if (updateData.total_questions) updateData.total_questions = parseInt(updateData.total_questions);
    if (updateData.pass_percentage) updateData.pass_percentage = parseFloat(updateData.pass_percentage);
    if (updateData.price) updateData.price = parseFloat(updateData.price);
    if (updateData.negative_mark_value) updateData.negative_mark_value = parseFloat(updateData.negative_mark_value);
    if (updateData.is_free !== undefined) updateData.is_free = updateData.is_free === 'true' || updateData.is_free === true;
    if (updateData.negative_marking !== undefined) updateData.negative_marking = updateData.negative_marking === 'true' || updateData.negative_marking === true;
    if (updateData.is_published !== undefined) updateData.is_published = updateData.is_published === 'true' || updateData.is_published === true;
    if (updateData.allow_anytime !== undefined) updateData.allow_anytime = updateData.allow_anytime === 'true' || updateData.allow_anytime === true;
    let parsedSyllabus = undefined;
    if (updateData.syllabus) {
      if (typeof updateData.syllabus === 'string') {
        parsedSyllabus = JSON.parse(updateData.syllabus);
      } else if (Array.isArray(updateData.syllabus)) {
        parsedSyllabus = updateData.syllabus;
      }
      updateData.syllabus = parsedSyllabus || [];
    }

    const { data: exam, error } = await supabase
      .from('exams')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Update exam error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update exam'
      });
    }

    if (parsedSyllabus !== undefined) {
      const { error: deleteError } = await supabase
        .from('exam_syllabus')
        .delete()
        .eq('exam_id', id);

      if (deleteError) {
        logger.error('Delete syllabus error:', deleteError);
      } else if (parsedSyllabus.length) {
        const syllabusPayload = parsedSyllabus.map(topic => ({
          exam_id: id,
          topic
        }));
        const { error: insertError } = await supabase
          .from('exam_syllabus')
          .insert(syllabusPayload);
        if (insertError) {
          logger.error('Insert syllabus error:', insertError);
        }
      }
    }

    res.json({
      success: true,
      message: 'Exam updated successfully',
      data: exam
    });
  } catch (error) {
    logger.error('Update exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating exam'
    });
  }
};

const deleteExam = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: exam } = await supabase
      .from('exams')
      .select('logo_url, thumbnail_url')
      .eq('id', id)
      .single();

    if (exam?.logo_url) {
      const logoKey = extractKeyFromUrl(exam.logo_url);
      if (logoKey) await deleteFile(logoKey);
    }
    if (exam?.thumbnail_url) {
      const thumbnailKey = extractKeyFromUrl(exam.thumbnail_url);
      if (thumbnailKey) await deleteFile(thumbnailKey);
    }

    const { error } = await supabase
      .from('exams')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Delete exam error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete exam'
      });
    }

    res.json({
      success: true,
      message: 'Exam deleted successfully'
    });
  } catch (error) {
    logger.error('Delete exam error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting exam'
    });
  }
};

const createSection = async (req, res) => {
  try {
    const { exam_id, name, total_questions, marks_per_question, duration, section_order } = req.body;

    const { data: section, error } = await supabase
      .from('exam_sections')
      .insert({
        exam_id,
        name,
        total_questions: parseInt(total_questions),
        marks_per_question: parseFloat(marks_per_question),
        duration: duration ? parseInt(duration) : null,
        section_order: parseInt(section_order)
      })
      .select()
      .single();

    if (error) {
      logger.error('Create section error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create section'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Section created successfully',
      data: section
    });
  } catch (error) {
    logger.error('Create section error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating section'
    });
  }
};

const updateSection = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    if (updateData.total_questions) updateData.total_questions = parseInt(updateData.total_questions);
    if (updateData.marks_per_question) updateData.marks_per_question = parseFloat(updateData.marks_per_question);
    if (updateData.duration) updateData.duration = parseInt(updateData.duration);
    if (updateData.section_order) updateData.section_order = parseInt(updateData.section_order);

    const { data: section, error } = await supabase
      .from('exam_sections')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Update section error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update section'
      });
    }

    res.json({
      success: true,
      message: 'Section updated successfully',
      data: section
    });
  } catch (error) {
    logger.error('Update section error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating section'
    });
  }
};

const deleteSection = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('exam_sections')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Delete section error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete section'
      });
    }

    res.json({
      success: true,
      message: 'Section deleted successfully'
    });
  } catch (error) {
    logger.error('Delete section error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting section'
    });
  }
};

const createQuestion = async (req, res) => {
  try {
    const { exam_id, section_id, type, text, marks, negative_marks, explanation, difficulty, question_order } = req.body;

    let imageUrl = null;
    if (req.file) {
      const imageResult = await uploadQuestionImage(req.file);
      imageUrl = imageResult.url;
    }

    const { data: question, error } = await supabase
      .from('questions')
      .insert({
        exam_id,
        section_id,
        type,
        text,
        marks: parseFloat(marks),
        negative_marks: parseFloat(negative_marks) || 0,
        explanation,
        image_url: imageUrl,
        difficulty,
        question_order: question_order ? parseInt(question_order) : null
      })
      .select()
      .single();

    if (error) {
      logger.error('Create question error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create question'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: question
    });
  } catch (error) {
    logger.error('Create question error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating question'
    });
  }
};

const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const { data: existingQuestion } = await supabase
      .from('questions')
      .select('image_url')
      .eq('id', id)
      .single();

    if (req.file) {
      if (existingQuestion?.image_url) {
        const oldKey = extractKeyFromUrl(existingQuestion.image_url);
        if (oldKey) await deleteFile(oldKey);
      }
      const imageResult = await uploadQuestionImage(req.file);
      updateData.image_url = imageResult.url;
    }

    if (updateData.marks) updateData.marks = parseFloat(updateData.marks);
    if (updateData.negative_marks) updateData.negative_marks = parseFloat(updateData.negative_marks);
    if (updateData.question_order) updateData.question_order = parseInt(updateData.question_order);

    const { data: question, error } = await supabase
      .from('questions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Update question error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update question'
      });
    }

    res.json({
      success: true,
      message: 'Question updated successfully',
      data: question
    });
  } catch (error) {
    logger.error('Update question error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating question'
    });
  }
};

const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: question } = await supabase
      .from('questions')
      .select('image_url')
      .eq('id', id)
      .single();

    if (question?.image_url) {
      const imageKey = extractKeyFromUrl(question.image_url);
      if (imageKey) await deleteFile(imageKey);
    }

    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Delete question error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete question'
      });
    }

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    logger.error('Delete question error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting question'
    });
  }
};

const createOption = async (req, res) => {
  try {
    const { question_id, option_text, is_correct, option_order } = req.body;

    let imageUrl = null;
    if (req.file) {
      const imageResult = await uploadOptionImage(req.file);
      imageUrl = imageResult.url;
    }

    const { data: option, error } = await supabase
      .from('question_options')
      .insert({
        question_id,
        option_text,
        is_correct: is_correct === 'true' || is_correct === true,
        option_order: parseInt(option_order),
        image_url: imageUrl
      })
      .select()
      .single();

    if (error) {
      logger.error('Create option error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create option'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Option created successfully',
      data: option
    });
  } catch (error) {
    logger.error('Create option error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating option'
    });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('users')
      .select('id, email, name, phone, role, is_verified, is_blocked, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (role) {
      query = query.eq('role', role);
    }

    const { data: users, error, count } = await query;

    if (error) {
      logger.error('Get users error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }

    res.json({
      success: true,
      data: users,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
};

const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be "user" or "admin"'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', id)
      .select('id, email, name, role')
      .single();

    if (error) {
      logger.error('Update user role error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user role'
      });
    }

    res.json({
      success: true,
      message: 'User role updated successfully',
      data: user
    });
  } catch (error) {
    logger.error('Update user role error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user role'
    });
  }
};

const toggleUserBlock = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_blocked')
      .eq('id', id)
      .single();

    const { data: user, error } = await supabase
      .from('users')
      .update({ is_blocked: !currentUser.is_blocked })
      .eq('id', id)
      .select('id, email, name, is_blocked')
      .single();

    if (error) {
      logger.error('Toggle user block error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user status'
      });
    }

    res.json({
      success: true,
      message: `User ${user.is_blocked ? 'blocked' : 'unblocked'} successfully`,
      data: user
    });
  } catch (error) {
    logger.error('Toggle user block error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user status'
    });
  }
};

module.exports = {
  getAdminExams,
  getAdminExamById,
  getExamSectionsWithQuestions,
  createExam,
  updateExam,
  deleteExam,
  createSection,
  updateSection,
  deleteSection,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  createOption,
  getAllUsers,
  updateUserRole,
  toggleUserBlock
};
