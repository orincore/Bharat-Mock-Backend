const supabase = require('../config/database');
const logger = require('../config/logger');
const { uploadExamLogo, uploadExamThumbnail, uploadQuestionImage, uploadOptionImage, deleteFile, extractKeyFromUrl } = require('../services/uploadService');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

const safeAverage = (numbers = []) => {
  const valid = numbers.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (valid.length === 0) return 0;
  return parseFloat((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1));
};

const QUESTION_BATCH_SIZE = 25;
const OPTION_BATCH_SIZE = 50;

const batchInsert = async (table, rows, selectColumns = '*', batchSize = QUESTION_BATCH_SIZE) => {
  if (!rows.length) return [];
  const allCreated = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from(table)
      .insert(chunk)
      .select(selectColumns);
    if (error) {
      logger.error(`Batch insert error on ${table} (chunk ${Math.floor(i / batchSize) + 1}, rows ${i}-${i + chunk.length - 1}):`, error);
    } else if (data) {
      allCreated.push(...data);
    }
  }
  if (allCreated.length !== rows.length) {
    logger.warn(`${table}: expected ${rows.length} rows, inserted ${allCreated.length}`);
  }
  return allCreated;
};

const getAdminExams = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      category,
      difficulty,
      exam_type
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('exams')
      .select(`
        id,
        title,
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
        logo_url,
        thumbnail_url,
        negative_marking,
        negative_mark_value,
        is_published,
        exam_type,
        show_in_mock_tests,
        is_premium,
        created_at,
        updated_at
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%`);
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

    if (exam_type) {
      query = query.eq('exam_type', exam_type);
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

const getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`
        id,
        email,
        name,
        phone,
        avatar_url,
        role,
        is_verified,
        is_blocked,
        is_onboarded,
        auth_provider,
        date_of_birth,
        created_at
      `)
      .eq('id', id)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { data: allResults, error: resultsError } = await supabase
      .from('results')
      .select('score, total_marks, percentage, created_at, exam_id')
      .eq('user_id', id)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (resultsError) {
      logger.error('Admin fetch user results error:', resultsError);
    }

    const { data: recentResults } = await supabase
      .from('results')
      .select(`
        id,
        score,
        total_marks,
        percentage,
        status,
        created_at,
        exam_id,
        exams (
          id,
          title,
          category,
          difficulty
        )
      `)
      .eq('user_id', id)
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: recentAttempts } = await supabase
      .from('exam_attempts')
      .select(`
        id,
        exam_id,
        started_at,
        submitted_at,
        time_taken,
        is_submitted,
        exams (
          id,
          title,
          category,
          difficulty
        )
      `)
      .eq('user_id', id)
      .order('started_at', { ascending: false })
      .limit(5);

    const scores = (allResults || []).map((result) => result.percentage || 0);
    const stats = {
      totalExamsTaken: allResults?.length || 0,
      averageScore: safeAverage(scores),
      bestScore: scores.length ? Math.max(...scores) : 0,
      lastActive: allResults?.[0]?.created_at || user.created_at,
      totalMarksEarned: (allResults || []).reduce((sum, r) => sum + (r.score || 0), 0),
      totalMarksPossible: (allResults || []).reduce((sum, r) => sum + (r.total_marks || 0), 0)
    };

    res.json({
      success: true,
      data: {
        user,
        stats,
        recentResults: (recentResults || []).map((result) => ({
          ...result,
          exam: result.exams ? {
            id: result.exams.id,
            title: result.exams.title,
            category: result.exams.category,
            difficulty: result.exams.difficulty
          } : null
        })),
        recentAttempts: (recentAttempts || []).map((attempt) => ({
          ...attempt,
          exam: attempt.exams ? {
            id: attempt.exams.id,
            title: attempt.exams.title,
            category: attempt.exams.category,
            difficulty: attempt.exams.difficulty
          } : null
        }))
      }
    });
  } catch (error) {
    logger.error('Admin get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user details'
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
      .select('id, name, name_hi, total_questions, marks_per_question, duration, section_order')
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
        text_hi,
        marks,
        negative_marks,
        explanation,
        explanation_hi,
        difficulty,
        image_url,
        question_order,
        question_number,
        question_options (
          id,
          option_text,
          option_text_hi,
          is_correct,
          option_order,
          image_url
        )
      `)
      .eq('exam_id', id)
      .is('deleted_at', null)
      .order('section_id', { ascending: true })
      .order('question_order', { ascending: true })
      .order('question_number', { ascending: true });

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
      name_hi: section.name_hi,
      total_questions: section.total_questions,
      marks_per_question: section.marks_per_question,
      duration: section.duration,
      section_order: section.section_order,
      questions: questions
        .filter(q => q.section_id === section.id)
        .sort((a, b) => {
          const orderA = a.question_order ?? a.question_number ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.question_order ?? b.question_number ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        })
        .map(q => ({
          id: q.id,
          type: q.type,
          text: q.text,
          text_hi: q.text_hi,
          marks: q.marks,
          negative_marks: q.negative_marks,
          explanation: q.explanation,
          explanation_hi: q.explanation_hi,
          difficulty: q.difficulty,
          image_url: q.image_url,
          question_order: q.question_order,
          question_number: q.question_number,
          options: (q.question_options || [])
            .sort((a, b) => a.option_order - b.option_order)
            .map(opt => ({
              id: opt.id,
              option_text: opt.option_text,
              option_text_hi: opt.option_text_hi,
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
        exam_type,
        show_in_mock_tests,
        is_premium,
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
      negative_marking,
      negative_mark_value,
      syllabus,
      slug: customSlug,
      is_published,
      allow_anytime,
      exam_type,
      show_in_mock_tests
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
    
    const parentSlug = subcategorySlug || categorySlug;
    const urlPath = parentSlug ? `/${parentSlug}/${examSlug}` : `/${examSlug}`;

    const parsedSyllabus = syllabus ? JSON.parse(syllabus) : [];
    const allowAnytimeFlag = allow_anytime === 'true' || allow_anytime === true;
    const normalizedStatus = allowAnytimeFlag ? 'anytime' : (status || 'upcoming');
    const normalizedStartDate = allowAnytimeFlag ? null : (start_date || null);
    const normalizedEndDate = allowAnytimeFlag ? null : (end_date || null);

    const { data: exam, error } = await supabase
      .from('exams')
      .insert({
        title,
        duration: parseInt(duration),
        total_marks: parseInt(total_marks),
        total_questions: parseInt(total_questions),
        category: category || categorySlug,
        category_id: category_id || null,
        subcategory: subcategory || subcategorySlug,
        subcategory_id: subcategory_id || null,
        difficulty: difficulty || null,
        difficulty_id: difficulty_id || null,
        status: normalizedStatus,
        start_date: normalizedStartDate,
        end_date: normalizedEndDate,
        pass_percentage: parseFloat(pass_percentage),
        is_free: is_free === 'true' || is_free === true,
        negative_marking: negative_marking === 'true' || negative_marking === true,
        negative_mark_value: parseFloat(negative_mark_value) || 0,
        is_published: is_published === 'true' || is_published === true,
        allow_anytime: allowAnytimeFlag,
        exam_type: exam_type || 'mock_test',
        show_in_mock_tests: show_in_mock_tests === 'true' || show_in_mock_tests === true,
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
    if (updateData.negative_mark_value) updateData.negative_mark_value = parseFloat(updateData.negative_mark_value);
    if (updateData.is_free !== undefined) updateData.is_free = updateData.is_free === 'true' || updateData.is_free === true;
    if (updateData.negative_marking !== undefined) updateData.negative_marking = updateData.negative_marking === 'true' || updateData.negative_marking === true;
    if (updateData.is_published !== undefined) updateData.is_published = updateData.is_published === 'true' || updateData.is_published === true;
    if (updateData.allow_anytime !== undefined) updateData.allow_anytime = updateData.allow_anytime === 'true' || updateData.allow_anytime === true;
    if (updateData.allow_anytime) {
      updateData.status = 'anytime';
      updateData.start_date = null;
      updateData.end_date = null;
    }
    if (updateData.show_in_mock_tests !== undefined) updateData.show_in_mock_tests = updateData.show_in_mock_tests === 'true' || updateData.show_in_mock_tests === true;
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

    const { data: exam, error: examFetchError } = await supabase
      .from('exams')
      .select('id, logo_url, thumbnail_url')
      .eq('id', id)
      .single();

    if (examFetchError || !exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // Collect related questions and options to clean up images and records
    const { data: questions } = await supabase
      .from('questions')
      .select('id, image_url')
      .eq('exam_id', id);

    const questionIds = questions?.map(q => q.id) || [];

    let options = [];
    if (questionIds.length) {
      const { data: optionRecords } = await supabase
        .from('question_options')
        .select('id, question_id, image_url')
        .in('question_id', questionIds);
      options = optionRecords || [];
    }

    // Delete option images
    for (const option of options) {
      if (option.image_url) {
        const optionKey = extractKeyFromUrl(option.image_url);
        if (optionKey) {
          try {
            await deleteFile(optionKey);
          } catch (fileError) {
            logger.warn('Failed to delete option image:', fileError);
          }
        }
      }
    }

    // Delete question images
    for (const question of questions || []) {
      if (question.image_url) {
        const questionKey = extractKeyFromUrl(question.image_url);
        if (questionKey) {
          try {
            await deleteFile(questionKey);
          } catch (fileError) {
            logger.warn('Failed to delete question image:', fileError);
          }
        }
      }
    }

    // Delete options and questions from DB
    if (questionIds.length) {
      const { error: deleteOptionsError } = await supabase
        .from('question_options')
        .delete()
        .in('question_id', questionIds);
      if (deleteOptionsError) {
        logger.error('Delete options error:', deleteOptionsError);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete related options'
        });
      }

      const { error: deleteQuestionsError } = await supabase
        .from('questions')
        .delete()
        .eq('exam_id', id);
      if (deleteQuestionsError) {
        logger.error('Delete questions error:', deleteQuestionsError);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete related questions'
        });
      }
    }

    // Delete sections and syllabus rows
    await supabase.from('exam_sections').delete().eq('exam_id', id);
    await supabase.from('exam_syllabus').delete().eq('exam_id', id);

    // Delete exam media
    if (exam.logo_url) {
      const logoKey = extractKeyFromUrl(exam.logo_url);
      if (logoKey) {
        try {
          await deleteFile(logoKey);
        } catch (fileError) {
          logger.warn('Failed to delete logo image:', fileError);
        }
      }
    }
    if (exam.thumbnail_url) {
      const thumbnailKey = extractKeyFromUrl(exam.thumbnail_url);
      if (thumbnailKey) {
        try {
          await deleteFile(thumbnailKey);
        } catch (fileError) {
          logger.warn('Failed to delete thumbnail image:', fileError);
        }
      }
    }

    const { error: deleteExamError } = await supabase
      .from('exams')
      .delete()
      .eq('id', id);

    if (deleteExamError) {
      logger.error('Delete exam error:', deleteExamError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete exam'
      });
    }

    res.json({
      success: true,
      message: 'Exam and related content deleted successfully'
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
    const { exam_id, section_id, type, text, marks, negative_marks, explanation, difficulty, question_order, question_number } = req.body;

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
        question_order: question_order ? parseInt(question_order) : null,
        question_number: question_number ? parseInt(question_number) : null
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
    if (updateData.question_number) updateData.question_number = parseInt(updateData.question_number);

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

const updateOption = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const { data: existingOption } = await supabase
      .from('question_options')
      .select('image_url')
      .eq('id', id)
      .single();

    if (req.file) {
      if (existingOption?.image_url) {
        const oldKey = extractKeyFromUrl(existingOption.image_url);
        if (oldKey) await deleteFile(oldKey);
      }
      const imageResult = await uploadOptionImage(req.file);
      updateData.image_url = imageResult.url;
    }

    if (updateData.is_correct !== undefined) {
      updateData.is_correct = updateData.is_correct === 'true' || updateData.is_correct === true;
    }

    if (updateData.option_order) {
      updateData.option_order = parseInt(updateData.option_order);
    }

    const { data: option, error } = await supabase
      .from('question_options')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Update option error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update option'
      });
    }

    res.json({
      success: true,
      message: 'Option updated successfully',
      data: option
    });
  } catch (error) {
    logger.error('Update option error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating option'
    });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('users')
      .select('id, email, name, phone, avatar_url, role, is_verified, is_blocked, created_at', { count: 'exact' })
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

    try {
      if (role === 'admin') {
        const { data: adminRole, error: adminRoleError } = await supabase
          .from('admin_roles')
          .select('id')
          .eq('name', 'admin')
          .single();

        if (adminRoleError || !adminRole) {
          throw new Error('Admin role not found');
        }

        await supabase
          .from('admin_users')
          .upsert({
            user_id: id,
            role_id: adminRole.id,
            is_active: true
          }, { onConflict: 'user_id' });
      } else {
        await supabase
          .from('admin_users')
          .delete()
          .eq('user_id', id);
      }
    } catch (adminSyncError) {
      logger.error('Sync admin_users error:', adminSyncError);
      return res.status(500).json({
        success: false,
        message: 'User role updated, but failed to synchronize admin access'
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

const saveDraftExam = async (req, res) => {
  try {
    let examPayload;

    try {
      examPayload = typeof req.body.exam === 'string' ? JSON.parse(req.body.exam) : req.body.exam;
    } catch (parseError) {
      logger.error('Failed to parse exam payload for save draft:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid exam payload. Ensure exam data is valid JSON.'
      });
    }

    if (!examPayload) {
      return res.status(400).json({
        success: false,
        message: 'Exam data is required.'
      });
    }

    examPayload.is_published = false;
    req.body.exam = JSON.stringify(examPayload);

    return bulkCreateExamWithContent(req, res);
  } catch (error) {
    logger.error('Save draft exam error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while saving draft exam'
    });
  }
};

const bulkCreateExamWithContent = async (req, res) => {
  try {
    const {
      exam: rawExam,
      sections: rawSections
    } = req.body;

    let exam;
    let sections = [];

    try {
      exam = typeof rawExam === 'string' ? JSON.parse(rawExam) : rawExam;
    } catch (parseError) {
      logger.error('Failed to parse exam payload for bulk create:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid exam payload. Ensure exam data is valid JSON.'
      });
    }

    try {
      if (rawSections) {
        sections = typeof rawSections === 'string' ? JSON.parse(rawSections) : rawSections;
      }
      if (!Array.isArray(sections)) {
        sections = [];
      }
    } catch (parseError) {
      logger.error('Failed to parse sections payload for bulk create:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid sections payload. Ensure sections data is valid JSON.'
      });
    }

    if (!exam) {
      return res.status(400).json({
        success: false,
        message: 'Exam data is required.'
      });
    }

    // Parallelize: file uploads + slug generation + category/subcategory lookups
    const [logoResult, thumbnailResult, examSlug, catResult, subcatResult] = await Promise.all([
      req.files?.logo ? uploadExamLogo(req.files.logo[0]) : Promise.resolve(null),
      req.files?.thumbnail ? uploadExamThumbnail(req.files.thumbnail[0]) : Promise.resolve(null),
      ensureUniqueSlug(supabase, 'exams', slugify(exam.slug || exam.title)),
      exam.category_id
        ? supabase.from('exam_categories').select('slug').eq('id', exam.category_id).single()
        : Promise.resolve({ data: null }),
      exam.subcategory_id
        ? supabase.from('exam_subcategories').select('slug').eq('id', exam.subcategory_id).single()
        : Promise.resolve({ data: null })
    ]);

    const logoUrl = logoResult?.url || null;
    const thumbnailUrl = thumbnailResult?.url || null;
    const categorySlug = catResult.data?.slug || exam.category || '';
    const subcategorySlug = subcatResult.data?.slug || exam.subcategory || '';
    const parentSlug = subcategorySlug || categorySlug;
    const urlPath = parentSlug ? `/${parentSlug}/${examSlug}` : `/${examSlug}`;

    const parsedSyllabus = exam.syllabus || [];
    const supportsHindi = sections.some(s => 
      s.name_hi || s.questions?.some(q => q.text_hi || q.explanation_hi || q.options?.some(o => o.option_text_hi))
    ) || false;

    const allowAnytimeFlag = exam.allow_anytime === 'true' || exam.allow_anytime === true;
    const normalizedStatus = allowAnytimeFlag ? 'anytime' : (exam.status || 'upcoming');
    const normalizedStartDate = allowAnytimeFlag ? null : (exam.start_date || null);
    const normalizedEndDate = allowAnytimeFlag ? null : (exam.end_date || null);

    const { data: createdExam, error: examError } = await supabase
      .from('exams')
      .insert({
        title: exam.title,
        duration: parseInt(exam.duration),
        total_marks: parseInt(exam.total_marks),
        total_questions: parseInt(exam.total_questions),
        category: exam.category || categorySlug,
        category_id: exam.category_id || null,
        subcategory: exam.subcategory || subcategorySlug,
        subcategory_id: exam.subcategory_id || null,
        difficulty: exam.difficulty || null,
        difficulty_id: exam.difficulty_id || null,
        status: normalizedStatus,
        start_date: normalizedStartDate,
        end_date: normalizedEndDate,
        pass_percentage: parseFloat(exam.pass_percentage),
        is_free: exam.is_free === 'true' || exam.is_free === true,
        negative_marking: exam.negative_marking === 'true' || exam.negative_marking === true,
        negative_mark_value: parseFloat(exam.negative_mark_value) || 0,
        is_published: exam.is_published === 'true' || exam.is_published === true,
        allow_anytime: allowAnytimeFlag,
        exam_type: exam.exam_type || 'mock_test',
        show_in_mock_tests: exam.show_in_mock_tests === 'true' || exam.show_in_mock_tests === true,
        is_premium: exam.is_premium === 'true' || exam.is_premium === true,
        supports_hindi: supportsHindi,
        logo_url: logoUrl,
        thumbnail_url: thumbnailUrl,
        slug: examSlug,
        url_path: urlPath,
        syllabus: parsedSyllabus
      })
      .select()
      .single();

    if (examError) {
      logger.error('Bulk create exam error:', examError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create exam'
      });
    }

    // Insert syllabus in background (don't block response for it)
    const syllabusPromise = parsedSyllabus?.length
      ? supabase.from('exam_syllabus').insert(parsedSyllabus.map(topic => ({ exam_id: createdExam.id, topic })))
      : Promise.resolve();

    // Batch insert all sections at once
    let createdSections = [];
    if (sections.length > 0) {
      const sectionInserts = sections.map((section, idx) => ({
        exam_id: createdExam.id,
        name: section.name,
        name_hi: section.name_hi || null,
        total_questions: section.total_questions,
        marks_per_question: section.marks_per_question,
        duration: section.duration || null,
        section_order: section.section_order ?? (idx + 1)
      }));

      const { data: batchSections, error: sectionError } = await supabase
        .from('exam_sections')
        .insert(sectionInserts)
        .select();

      if (sectionError) {
        logger.error('Bulk create sections error:', sectionError);
      } else {
        createdSections = batchSections || [];
      }

      // Chunked insert: questions then options (prevents Supabase row truncation)
      if (createdSections.length > 0) {
        const allQuestionInserts = [];
        const questionSectionMap = [];

        // Build a name-based lookup so section order mismatches don't lose questions
        const sectionByName = new Map();
        createdSections.forEach(s => sectionByName.set(s.name, s));

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const createdSection = createdSections[i] || sectionByName.get(section.name);
          if (!createdSection || !section.questions?.length) continue;

          for (let qIdx = 0; qIdx < section.questions.length; qIdx++) {
            const question = section.questions[qIdx];
            questionSectionMap.push({ question });
            allQuestionInserts.push({
              exam_id: createdExam.id,
              section_id: createdSection.id,
              type: question.type,
              text: question.text,
              text_hi: question.text_hi || null,
              marks: question.marks,
              negative_marks: question.negative_marks,
              explanation: question.explanation || null,
              explanation_hi: question.explanation_hi || null,
              difficulty: question.difficulty,
              image_url: question.image_url || null,
              question_order: question.question_order || (qIdx + 1),
              question_number: question.question_number || (qIdx + 1)
            });
          }
        }

        logger.info(`Bulk create: inserting ${allQuestionInserts.length} questions in chunks of ${QUESTION_BATCH_SIZE}`);

        const createdQuestions = await batchInsert('questions', allQuestionInserts, 'id', QUESTION_BATCH_SIZE);

        logger.info(`Bulk create: ${createdQuestions.length}/${allQuestionInserts.length} questions inserted`);

        if (createdQuestions.length > 0) {
          const allOptionInserts = [];
          for (let qi = 0; qi < createdQuestions.length; qi++) {
            const { question } = questionSectionMap[qi];
            if (!question.options?.length) continue;
            for (const option of question.options) {
              allOptionInserts.push({
                question_id: createdQuestions[qi].id,
                option_text: option.option_text,
                option_text_hi: option.option_text_hi || null,
                is_correct: option.is_correct === true || option.is_correct === 'true',
                option_order: option.option_order,
                image_url: option.image_url || null
              });
            }
          }

          logger.info(`Bulk create: inserting ${allOptionInserts.length} options in chunks of ${OPTION_BATCH_SIZE}`);

          await batchInsert('question_options', allOptionInserts, 'id', OPTION_BATCH_SIZE);
        }
      }
    }

    await syllabusPromise;

    // Verify actual inserted counts from DB
    const { count: dbQuestionCount } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', createdExam.id);

    const expectedQuestions = sections.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

    if (dbQuestionCount !== expectedQuestions) {
      logger.error(`Bulk create verification FAILED: expected ${expectedQuestions} questions, DB has ${dbQuestionCount} for exam ${createdExam.id}`);
    } else {
      logger.info(`Bulk create verification OK: ${dbQuestionCount}/${expectedQuestions} questions for exam ${createdExam.id}`);
    }

    res.status(201).json({
      success: true,
      message: 'Exam created successfully with all content',
      data: {
        exam: createdExam,
        sections: createdSections,
        questionCount: dbQuestionCount,
        expectedQuestionCount: expectedQuestions
      }
    });
  } catch (error) {
    logger.error('Bulk create exam with content error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating exam with content'
    });
  }
};

const updateExamWithContent = async (req, res) => {
  try {
    const { id } = req.params;
    const { exam: rawExam, sections: rawSections } = req.body;

    const { data: existingExam, error: existingError } = await supabase
      .from('exams')
      .select('id, logo_url, thumbnail_url')
      .eq('id', id)
      .single();

    if (existingError || !existingExam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    let examPayload;
    let sectionsPayload = [];

    try {
      examPayload = typeof rawExam === 'string' ? JSON.parse(rawExam) : rawExam;
    } catch (parseError) {
      logger.error('Failed to parse exam payload for update:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid exam payload. Ensure exam data is valid JSON.'
      });
    }

    try {
      if (rawSections) {
        sectionsPayload = typeof rawSections === 'string' ? JSON.parse(rawSections) : rawSections;
      }
      if (!Array.isArray(sectionsPayload)) {
        sectionsPayload = [];
      }
    } catch (parseError) {
      logger.error('Failed to parse sections payload for update:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid sections payload. Ensure sections data is valid JSON.'
      });
    }

    const bool = (value) => value === true || value === 'true';
    const numberOrNull = (value, fallback = null) => {
      if (value === undefined || value === null || value === '') return fallback;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? fallback : parsed;
    };

    // Parallelize: file uploads + slug generation + category/subcategory lookups
    const uploadPromises = [];

    if (req.files?.logo?.[0]) {
      if (existingExam.logo_url) {
        const oldLogoKey = extractKeyFromUrl(existingExam.logo_url);
        if (oldLogoKey) deleteFile(oldLogoKey).catch(() => {});
      }
      uploadPromises.push(uploadExamLogo(req.files.logo[0]));
    } else {
      uploadPromises.push(Promise.resolve(null));
    }

    if (req.files?.thumbnail?.[0]) {
      if (existingExam.thumbnail_url) {
        const oldThumbKey = extractKeyFromUrl(existingExam.thumbnail_url);
        if (oldThumbKey) deleteFile(oldThumbKey).catch(() => {});
      }
      uploadPromises.push(uploadExamThumbnail(req.files.thumbnail[0]));
    } else {
      uploadPromises.push(Promise.resolve(null));
    }

    const baseSlug = slugify(examPayload.slug || examPayload.title || 'exam');

    const [logoResult, thumbnailResult, examSlug, catResult, subcatResult] = await Promise.all([
      ...uploadPromises,
      ensureUniqueSlug(supabase, 'exams', baseSlug, { excludeId: id }),
      examPayload.category_id
        ? supabase.from('exam_categories').select('slug').eq('id', examPayload.category_id).single()
        : Promise.resolve({ data: null }),
      examPayload.subcategory_id
        ? supabase.from('exam_subcategories').select('slug').eq('id', examPayload.subcategory_id).single()
        : Promise.resolve({ data: null })
    ]);

    const logoUrl = logoResult?.url || existingExam.logo_url || null;
    const thumbnailUrl = thumbnailResult?.url || existingExam.thumbnail_url || null;
    const categorySlug = catResult.data?.slug || examPayload.category || '';
    const subcategorySlug = subcatResult.data?.slug || examPayload.subcategory || '';
    const parentSlug = subcategorySlug || categorySlug;
    const urlPath = parentSlug ? `/${parentSlug}/${examSlug}` : `/${examSlug}`;

    let parsedSyllabus = [];
    if (Array.isArray(examPayload.syllabus)) {
      parsedSyllabus = examPayload.syllabus;
    } else if (typeof examPayload.syllabus === 'string') {
      try {
        parsedSyllabus = JSON.parse(examPayload.syllabus);
      } catch (e) {
        parsedSyllabus = [];
      }
    }

    const allowAnytimeFlag = bool(examPayload.allow_anytime);
    const normalizedStatus = allowAnytimeFlag ? 'anytime' : (examPayload.status || 'upcoming');
    const normalizedStartDate = allowAnytimeFlag ? null : (examPayload.start_date || null);
    const normalizedEndDate = allowAnytimeFlag ? null : (examPayload.end_date || null);
    const supportsHindi = sectionsPayload.some(section =>
      section.name_hi || section.questions?.some(q => q.text_hi || q.explanation_hi || q.options?.some(o => o.option_text_hi))
    );

    const updatePayload = {
      title: examPayload.title,
      duration: numberOrNull(examPayload.duration, 0),
      total_marks: numberOrNull(examPayload.total_marks, 0),
      total_questions: numberOrNull(examPayload.total_questions, 0),
      category: examPayload.category || categorySlug,
      category_id: examPayload.category_id || null,
      subcategory: examPayload.subcategory || subcategorySlug,
      subcategory_id: examPayload.subcategory_id || null,
      difficulty: examPayload.difficulty || null,
      difficulty_id: examPayload.difficulty_id || null,
      status: normalizedStatus,
      start_date: normalizedStartDate,
      end_date: normalizedEndDate,
      pass_percentage: numberOrNull(examPayload.pass_percentage, 0),
      is_free: bool(examPayload.is_free),
      negative_marking: bool(examPayload.negative_marking),
      negative_mark_value: numberOrNull(examPayload.negative_mark_value, 0),
      is_published: bool(examPayload.is_published),
      allow_anytime: allowAnytimeFlag,
      exam_type: examPayload.exam_type || 'mock_test',
      show_in_mock_tests: bool(examPayload.show_in_mock_tests),
      is_premium: bool(examPayload.is_premium),
      supports_hindi: supportsHindi,
      logo_url: logoUrl,
      thumbnail_url: thumbnailUrl,
      slug: examSlug,
      url_path: urlPath,
      syllabus: parsedSyllabus
    };

    // Parallelize: update exam + delete old content (syllabus, questions, options, sections)
    const [examUpdateResult, , existingQuestionsResult] = await Promise.all([
      supabase.from('exams').update(updatePayload).eq('id', id).select().single(),
      supabase.from('exam_syllabus').delete().eq('exam_id', id),
      supabase.from('questions').select('id').eq('exam_id', id)
    ]);

    const { data: updatedExam, error: updateError } = examUpdateResult;

    if (updateError) {
      logger.error('Update exam with content error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update exam'
      });
    }

    // Parallelize: insert new syllabus + delete old options/questions/sections
    const existingQuestions = existingQuestionsResult.data;
    const deleteContentPromises = [];

    if (existingQuestions?.length) {
      const questionIds = existingQuestions.map(q => q.id);
      deleteContentPromises.push(
        supabase.from('question_options').delete().in('question_id', questionIds)
      );
    }

    if (parsedSyllabus.length) {
      deleteContentPromises.push(
        supabase.from('exam_syllabus').insert(parsedSyllabus.map(topic => ({ exam_id: id, topic })))
      );
    }

    await Promise.all(deleteContentPromises);

    // Now delete questions and sections (must be after options are deleted)
    await Promise.all([
      supabase.from('questions').delete().eq('exam_id', id),
      supabase.from('exam_sections').delete().eq('exam_id', id)
    ]);

    // Batch insert all sections at once
    let createdSections = [];

    if (sectionsPayload.length > 0) {
      const sectionInserts = sectionsPayload.map((section, idx) => ({
        exam_id: id,
        name: section.name || '',
        name_hi: section.name_hi || null,
        total_questions: numberOrNull(section.total_questions, section.questions?.length || 0),
        marks_per_question: numberOrNull(section.marks_per_question, 1),
        duration: numberOrNull(section.duration),
        section_order: numberOrNull(section.section_order, idx + 1)
      }));

      const { data: batchSections, error: sectionError } = await supabase
        .from('exam_sections')
        .insert(sectionInserts)
        .select();

      if (sectionError) {
        logger.error('Update exam sections batch insert error:', sectionError);
      } else {
        createdSections = batchSections || [];
      }

      // Chunked insert: questions then options (prevents Supabase row truncation)
      if (createdSections.length > 0) {
        const allQuestionInserts = [];
        const questionSectionMap = [];

        // Build a name-based lookup so section order mismatches don't lose questions
        const sectionByName = new Map();
        createdSections.forEach(s => sectionByName.set(s.name, s));

        for (let i = 0; i < sectionsPayload.length; i++) {
          const section = sectionsPayload[i];
          const createdSection = createdSections[i] || sectionByName.get(section.name);
          if (!createdSection || !section.questions?.length) continue;

          for (let qIdx = 0; qIdx < section.questions.length; qIdx++) {
            const question = section.questions[qIdx];
            questionSectionMap.push({ question });
            allQuestionInserts.push({
              exam_id: id,
              section_id: createdSection.id,
              type: question.type,
              text: question.text,
              text_hi: question.text_hi || null,
              marks: numberOrNull(question.marks, 0),
              negative_marks: numberOrNull(question.negative_marks, 0),
              explanation: question.explanation || null,
              explanation_hi: question.explanation_hi || null,
              difficulty: question.difficulty,
              image_url: question.image_url || null,
              question_order: question.question_order || (qIdx + 1),
              question_number: question.question_number || (qIdx + 1)
            });
          }
        }

        logger.info(`Update exam: inserting ${allQuestionInserts.length} questions in chunks of ${QUESTION_BATCH_SIZE}`);

        const createdQuestions = await batchInsert('questions', allQuestionInserts, 'id', QUESTION_BATCH_SIZE);

        logger.info(`Update exam: ${createdQuestions.length}/${allQuestionInserts.length} questions inserted`);

        if (createdQuestions.length > 0) {
          const allOptionInserts = [];
          for (let qi = 0; qi < createdQuestions.length; qi++) {
            const { question } = questionSectionMap[qi];
            if (!question.options?.length) continue;
            for (const option of question.options) {
              allOptionInserts.push({
                question_id: createdQuestions[qi].id,
                option_text: option.option_text,
                option_text_hi: option.option_text_hi || null,
                is_correct: bool(option.is_correct),
                option_order: numberOrNull(option.option_order),
                image_url: option.image_url || null
              });
            }
          }

          logger.info(`Update exam: inserting ${allOptionInserts.length} options in chunks of ${OPTION_BATCH_SIZE}`);

          await batchInsert('question_options', allOptionInserts, 'id', OPTION_BATCH_SIZE);
        }
      }
    }

    // Verify actual inserted counts from DB
    const { count: dbQuestionCount } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', id);

    const expectedQuestions = sectionsPayload.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

    if (dbQuestionCount !== expectedQuestions) {
      logger.error(`Update exam verification FAILED: expected ${expectedQuestions} questions, DB has ${dbQuestionCount} for exam ${id}`);
    } else {
      logger.info(`Update exam verification OK: ${dbQuestionCount}/${expectedQuestions} questions for exam ${id}`);
    }

    res.json({
      success: true,
      message: 'Exam updated successfully with all content',
      data: {
        exam: updatedExam,
        sections: createdSections,
        questionCount: dbQuestionCount,
        expectedQuestionCount: expectedQuestions
      }
    });
  } catch (error) {
    logger.error('Update exam with content error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating exam with content'
    });
  }
};

// Immediate image upload for questions
const uploadQuestionImageController = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Validate question ID format
    if (!id || id.startsWith('question-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question ID. Please save the question first before uploading images.'
      });
    }

    // Check if question exists
    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select('id, image_url')
      .eq('id', id)
      .single();

    if (questionError || !question) {
      logger.error('Question not found for image upload:', { id, error: questionError });
      return res.status(404).json({
        success: false,
        message: 'Question not found. Please save the question first before uploading images.'
      });
    }

    // Delete old image if exists
    if (question.image_url) {
      const oldImageKey = extractKeyFromUrl(question.image_url);
      if (oldImageKey) {
        try {
          await deleteFile(oldImageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete old question image:', deleteError);
        }
      }
    }

    // Upload new image
    const imageResult = await uploadQuestionImage(req.file);
    
    // Update question with new image URL
    const { error: updateError } = await supabase
      .from('questions')
      .update({ image_url: imageResult.url })
      .eq('id', id);

    if (updateError) {
      logger.error('Failed to update question image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update question image'
      });
    }

    res.json({
      success: true,
      message: 'Question image uploaded successfully',
      data: {
        image_url: imageResult.url
      }
    });
  } catch (error) {
    logger.error('Upload question image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading question image'
    });
  }
};

// Remove question image
const removeQuestionImage = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate question ID format
    if (!id || id.startsWith('question-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid question ID. Please save the question first.'
      });
    }

    // Get current question
    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select('id, image_url')
      .eq('id', id)
      .single();

    if (questionError || !question) {
      logger.error('Question not found for image removal:', { id, error: questionError });
      return res.status(404).json({
        success: false,
        message: 'Question not found. The question may have been deleted or not saved yet.'
      });
    }

    // Delete image from Cloudflare if exists
    if (question.image_url) {
      const imageKey = extractKeyFromUrl(question.image_url);
      if (imageKey) {
        try {
          await deleteFile(imageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete question image from Cloudflare:', deleteError);
        }
      }
    }

    // Update question to remove image URL
    const { error: updateError } = await supabase
      .from('questions')
      .update({ image_url: null })
      .eq('id', id);

    if (updateError) {
      logger.error('Failed to remove question image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove question image'
      });
    }

    res.json({
      success: true,
      message: 'Question image removed successfully'
    });
  } catch (error) {
    logger.error('Remove question image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing question image'
    });
  }
};

// Immediate image upload for options
const uploadOptionImageController = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Validate option ID format
    if (!id || id.startsWith('opt-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid option ID. Please save the option first before uploading images.'
      });
    }

    // Check if option exists
    const { data: option, error: optionError } = await supabase
      .from('question_options')
      .select('id, image_url')
      .eq('id', id)
      .single();

    if (optionError || !option) {
      logger.error('Option not found for image upload:', { id, error: optionError });
      return res.status(404).json({
        success: false,
        message: 'Option not found. Please save the option first before uploading images.'
      });
    }

    // Delete old image if exists
    if (option.image_url) {
      const oldImageKey = extractKeyFromUrl(option.image_url);
      if (oldImageKey) {
        try {
          await deleteFile(oldImageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete old option image:', deleteError);
        }
      }
    }

    // Upload new image
    const imageResult = await uploadOptionImage(req.file);
    
    // Update option with new image URL
    const { error: updateError } = await supabase
      .from('question_options')
      .update({ image_url: imageResult.url })
      .eq('id', id);

    if (updateError) {
      logger.error('Failed to update option image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update option image'
      });
    }

    res.json({
      success: true,
      message: 'Option image uploaded successfully',
      data: {
        image_url: imageResult.url
      }
    });
  } catch (error) {
    logger.error('Upload option image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading option image'
    });
  }
};

// Remove option image
const removeOptionImage = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate option ID format
    if (!id || id.startsWith('opt-') || id.startsWith('temp-')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid option ID. Please save the option first.'
      });
    }

    // Get current option
    const { data: option, error: optionError } = await supabase
      .from('question_options')
      .select('id, image_url')
      .eq('id', id)
      .single();

    if (optionError || !option) {
      logger.error('Option not found for image removal:', { id, error: optionError });
      return res.status(404).json({
        success: false,
        message: 'Option not found. The option may have been deleted or not saved yet.'
      });
    }

    // Delete image from Cloudflare if exists
    if (option.image_url) {
      const imageKey = extractKeyFromUrl(option.image_url);
      if (imageKey) {
        try {
          await deleteFile(imageKey);
        } catch (deleteError) {
          logger.warn('Failed to delete option image from Cloudflare:', deleteError);
        }
      }
    }

    // Update option to remove image URL
    const { error: updateError } = await supabase
      .from('question_options')
      .update({ image_url: null })
      .eq('id', id);

    if (updateError) {
      logger.error('Failed to remove option image URL:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove option image'
      });
    }

    res.json({
      success: true,
      message: 'Option image removed successfully'
    });
  } catch (error) {
    logger.error('Remove option image error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing option image'
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
  updateOption,
  bulkCreateExamWithContent,
  updateExamWithContent,
  saveDraftExam,
  uploadQuestionImage: uploadQuestionImageController,
  removeQuestionImage,
  uploadOptionImage: uploadOptionImageController,
  removeOptionImage,
  getUserDetails,
  getAllUsers,
  updateUserRole,
  toggleUserBlock
};
