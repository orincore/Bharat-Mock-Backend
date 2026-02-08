const { GraphQLUpload } = require('graphql-upload-minimal');
const GraphQLJSON = require('graphql-type-json');
const supabase = require('../config/database');
const logger = require('../config/logger');
const { uploadExamLogo, uploadExamThumbnail } = require('../services/uploadService');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value);

const ensureAdminContext = (context) => {
  if (!context?.user || !context?.adminRole) {
    throw new Error('Unauthorized');
  }
};

const bool = (value, defaultValue = false) => {
  if (value === undefined || value === null) return defaultValue;
  return value === true || value === 'true';
};

const numberOrNull = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const arrayOrEmpty = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const collectStreamToBuffer = (stream) => new Promise((resolve, reject) => {
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  stream.on('end', () => resolve(Buffer.concat(chunks)));
  stream.on('error', reject);
});

const processUpload = async (uploadPromise) => {
  if (!uploadPromise) return null;
  const upload = await uploadPromise;
  const { filename, mimetype, createReadStream } = upload;
  const stream = createReadStream();
  const buffer = await collectStreamToBuffer(stream);
  return {
    originalname: filename,
    mimetype,
    buffer
  };
};

const fetchCategorySlug = async (categoryId) => {
  if (!categoryId) return '';
  const { data } = await supabase
    .from('exam_categories')
    .select('slug')
    .eq('id', categoryId)
    .single();
  return data?.slug || '';
};

const fetchSubcategorySlug = async (subcategoryId) => {
  if (!subcategoryId) return '';
  const { data } = await supabase
    .from('exam_subcategories')
    .select('slug')
    .eq('id', subcategoryId)
    .single();
  return data?.slug || '';
};

const SECTION_FIELD_MAP = {
  name: 'name',
  name_hi: 'name_hi',
  total_questions: 'total_questions',
  marks_per_question: 'marks_per_question',
  duration: 'duration',
  section_order: 'section_order'
};

const QUESTION_FIELD_MAP = {
  type: 'type',
  text: 'text',
  text_hi: 'text_hi',
  marks: 'marks',
  negative_marks: 'negative_marks',
  explanation: 'explanation',
  explanation_hi: 'explanation_hi',
  difficulty: 'difficulty',
  image_url: 'image_url',
  question_order: 'question_order',
  question_number: 'question_number'
};

const OPTION_FIELD_MAP = {
  option_text: 'option_text',
  option_text_hi: 'option_text_hi',
  is_correct: 'is_correct',
  option_order: 'option_order',
  image_url: 'image_url'
};

const NUMERIC_FIELDS = new Set([
  'total_questions',
  'marks_per_question',
  'duration',
  'marks',
  'negative_marks',
  'question_order',
  'question_number',
  'option_order',
  'section_order'
]);

const BOOLEAN_FIELDS = new Set(['is_correct']);

const normalizeAutosaveValue = (field, value) => {
  if (value === undefined) return null;
  if (NUMERIC_FIELDS.has(field)) {
    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? null : numericValue;
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return Boolean(value);
  }
  return value;
};

const persistAutosaveChange = async ({ exam_id: _exam_id, field_path, payload }) => {
  if (!field_path || !field_path.startsWith('sections')) {
    return;
  }

  const pathParts = field_path.split('.');

  // Full sections payload autosave is stored for draft review but not applied live
  if (pathParts.length === 1) {
    return;
  }

  const sectionId = pathParts[1];
  if (!sectionId || sectionId.startsWith('section-')) {
    return;
  }

  // Section level update e.g., sections.{sectionId}.name
  if (pathParts.length === 3) {
    const field = pathParts[2];
    const column = SECTION_FIELD_MAP[field];
    if (!column) return;

    const updateValue = normalizeAutosaveValue(field, payload);
    const { error } = await supabase
      .from('exam_sections')
      .update({ [column]: updateValue })
      .eq('id', sectionId);

    if (error) {
      logger.error('Autosave section update error:', error);
      throw new Error('Failed to update section');
    }
    return;
  }

  // Section -> questions -> question field
  if (pathParts[2] === 'questions') {
    const questionId = pathParts[3];
    if (!questionId || questionId.startsWith('question-')) {
      return;
    }

    if (pathParts.length === 5) {
      const field = pathParts[4];
      const column = QUESTION_FIELD_MAP[field];
      if (!column) return;

      const updateValue = normalizeAutosaveValue(field, payload);
      const { error } = await supabase
        .from('questions')
        .update({ [column]: updateValue })
        .eq('id', questionId);

      if (error) {
        logger.error('Autosave question update error:', error);
        throw new Error('Failed to update question');
      }
      return;
    }

    // Section -> questions -> {questionId} -> options -> {optionId} -> field
    if (pathParts[4] === 'options') {
      const optionId = pathParts[5];
      if (!optionId || optionId.startsWith('option-') || optionId.startsWith('opt-')) {
        return;
      }

      const field = pathParts[6];
      const column = OPTION_FIELD_MAP[field];
      if (!column) return;

      const updateValue = normalizeAutosaveValue(field, payload);
      const { error } = await supabase
        .from('question_options')
        .update({ [column]: updateValue })
        .eq('id', optionId);

      if (error) {
        logger.error('Autosave option update error:', error);
        throw new Error('Failed to update option');
      }
      return;
    }
  }
};

const hydrateSectionsWithQuestions = async (examId) => {
  const { data: sections, error: sectionsError } = await supabase
    .from('exam_sections')
    .select('id, name, name_hi, total_questions, marks_per_question, duration, section_order')
    .eq('exam_id', examId)
    .order('section_order');

  if (sectionsError) {
    throw new Error('Failed to fetch exam sections');
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
    .eq('exam_id', examId)
    .order('question_number');

  if (questionsError) {
    throw new Error('Failed to fetch exam questions');
  }

  return sections.map((section) => ({
    ...section,
    questions: (questions || [])
      .filter((q) => q.section_id === section.id)
      .map((q) => ({
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
        options: (q.question_options || []).sort((a, b) => a.option_order - b.option_order)
      }))
  }));
};

const persistSections = async (examId, sections = []) => {
  const createdSections = [];

  for (const section of sections) {
    const sectionPayload = {
      exam_id: examId,
      name: section.name,
      name_hi: section.name_hi || null,
      total_questions: numberOrNull(section.total_questions, section.questions?.length || 0),
      marks_per_question: numberOrNull(section.marks_per_question, 1),
      duration: numberOrNull(section.duration),
      section_order: numberOrNull(section.section_order, createdSections.length + 1)
    };

    const { data: createdSection, error: sectionError } = await supabase
      .from('exam_sections')
      .insert(sectionPayload)
      .select()
      .single();

    if (sectionError) {
      logger.error('Section insert error (GraphQL):', sectionError);
      continue;
    }

    createdSections.push(createdSection);

    if (section.questions && section.questions.length > 0) {
      for (const [questionIndex, question] of section.questions.entries()) {
        const questionPayload = {
          exam_id: examId,
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
          question_order: numberOrNull(question.question_order, questionIndex + 1),
          question_number: numberOrNull(question.question_number, questionIndex + 1)
        };

        const { data: createdQuestion, error: questionError } = await supabase
          .from('questions')
          .insert(questionPayload)
          .select()
          .single();

        if (questionError) {
          logger.error('Question insert error (GraphQL):', questionError);
          continue;
        }

        if (question.options && question.options.length > 0) {
          const optionsPayload = question.options.map((option) => ({
            question_id: createdQuestion.id,
            option_text: option.option_text,
            option_text_hi: option.option_text_hi || null,
            is_correct: bool(option.is_correct),
            option_order: numberOrNull(option.option_order),
            image_url: option.image_url || null
          }));

          const { error: optionsError } = await supabase
            .from('question_options')
            .insert(optionsPayload);

          if (optionsError) {
            logger.error('Option insert error (GraphQL):', optionsError);
          }
        }
      }
    }
  }

  return createdSections;
};

const replaceExamStructure = async (examId, sections) => {
  const { data: existingQuestions } = await supabase
    .from('questions')
    .select('id')
    .eq('exam_id', examId);

  if (existingQuestions?.length) {
    const questionIds = existingQuestions.map((q) => q.id);
    await supabase
      .from('question_options')
      .delete()
      .in('question_id', questionIds);
  }

  await supabase.from('questions').delete().eq('exam_id', examId);
  await supabase.from('exam_sections').delete().eq('exam_id', examId);

  return persistSections(examId, sections);
};

const computeSupportsHindi = (sections = []) => sections.some((section) =>
  section.name_hi || section.questions?.some((q) =>
    q.text_hi || q.explanation_hi || q.options?.some((o) => o.option_text_hi))
);

const resolvers = {
  Upload: GraphQLUpload,
  JSON: GraphQLJSON,

  Query: {
    adminExams: async (_, { filter = {} }, context) => {
      ensureAdminContext(context);
      const page = filter.page || 1;
      const limit = filter.limit || 10;
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
          difficulty,
          status,
          start_date,
          end_date,
          pass_percentage,
          is_free,
          image_url,
          logo_url,
          thumbnail_url,
          negative_marking,
          negative_mark_value,
          allow_anytime,
          supports_hindi,
          exam_type,
          show_in_mock_tests,
          slug,
          url_path,
          created_at,
          updated_at
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (filter.search) {
        query = query.or(`title.ilike.%${filter.search}%`);
      }
      if (filter.status) query = query.eq('status', filter.status);
      if (filter.category) query = query.eq('category', filter.category);
      if (filter.difficulty) query = query.eq('difficulty', filter.difficulty);
      if (filter.exam_type) query = query.eq('exam_type', filter.exam_type);

      const { data, error, count } = await query;
      if (error) {
        throw new Error('Failed to fetch exams');
      }

      return {
        data: data || [],
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
        page,
        limit
      };
    },

    adminExam: async (_, { id }, context) => {
      ensureAdminContext(context);
      const { data, error } = await supabase
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
          image_url,
          logo_url,
          thumbnail_url,
          negative_marking,
          negative_mark_value,
          allow_anytime,
          supports_hindi,
          exam_type,
          show_in_mock_tests,
          slug,
          url_path,
          created_at,
          updated_at
        `)
        .eq('id', id)
        .single();

      if (error) {
        throw new Error('Exam not found');
      }

      const { data: syllabusRows } = await supabase
        .from('exam_syllabus')
        .select('topic')
        .eq('exam_id', id);

      return {
        ...data,
        syllabus: syllabusRows?.map((row) => row.topic) || data.syllabus || []
      };
    },

    examStructure: async (_, { examId }, context) => {
      ensureAdminContext(context);
      return hydrateSectionsWithQuestions(examId);
    },

    draftFields: async (_, { draft_key, exam_id }, context) => {
      ensureAdminContext(context);
      let query = supabase
        .from('exam_draft_fields')
        .select('*')
        .eq('draft_key', draft_key)
        .order('updated_at', { ascending: false });

      if (exam_id) {
        query = query.eq('exam_id', exam_id);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error('Failed to fetch draft fields');
      }
      return data || [];
    }
  },

  Mutation: {
    createExam: async (_, { input, sections = [], logo, thumbnail }, context) => {
      ensureAdminContext(context);

      const [logoFile, thumbnailFile] = await Promise.all([
        processUpload(logo),
        processUpload(thumbnail)
      ]);

      let logoUrl = null;
      let thumbnailUrl = null;

      if (logoFile) {
        const uploadResult = await uploadExamLogo(logoFile);
        logoUrl = uploadResult.url;
      }
      if (thumbnailFile) {
        const uploadResult = await uploadExamThumbnail(thumbnailFile);
        thumbnailUrl = uploadResult.url;
      }

      const baseSlug = slugify(input.slug || input.title || 'exam');
      const examSlug = await ensureUniqueSlug(supabase, 'exams', baseSlug);
      const categorySlug = input.category_id ? await fetchCategorySlug(input.category_id) : (input.category || '');
      const subcategorySlug = input.subcategory_id ? await fetchSubcategorySlug(input.subcategory_id) : (input.subcategory || '');
      const combinedSlug = [categorySlug, subcategorySlug].filter(Boolean).join('-');
      const urlPath = `/${combinedSlug}/${examSlug}`.replace(/\/+\/+/g, '/');
      const allowAnytimeFlag = bool(input.allow_anytime);
      const normalizedStatus = allowAnytimeFlag ? 'anytime' : (input.status || 'upcoming');
      const normalizedStartDate = allowAnytimeFlag ? null : (input.start_date || null);
      const normalizedEndDate = allowAnytimeFlag ? null : (input.end_date || null);
      const parsedSyllabus = arrayOrEmpty(input.syllabus);
      const supportsHindi = computeSupportsHindi(sections);

      const insertPayload = {
        title: input.title,
        duration: numberOrNull(input.duration, 0),
        total_marks: numberOrNull(input.total_marks, 0),
        total_questions: numberOrNull(input.total_questions, 0),
        category: input.category || categorySlug,
        category_id: input.category_id || null,
        subcategory: input.subcategory || subcategorySlug,
        subcategory_id: input.subcategory_id || null,
        difficulty: input.difficulty || null,
        difficulty_id: input.difficulty_id || null,
        status: normalizedStatus,
        start_date: normalizedStartDate,
        end_date: normalizedEndDate,
        pass_percentage: numberOrNull(input.pass_percentage, 0),
        is_free: bool(input.is_free, true),
        negative_marking: bool(input.negative_marking),
        negative_mark_value: numberOrNull(input.negative_mark_value, 0),
        is_published: bool(input.is_published),
        allow_anytime: allowAnytimeFlag,
        exam_type: input.exam_type || 'mock_test',
        show_in_mock_tests: bool(input.show_in_mock_tests),
        supports_hindi: supportsHindi,
        logo_url: logoUrl,
        thumbnail_url: thumbnailUrl,
        slug: examSlug,
        url_path: urlPath,
        syllabus: parsedSyllabus
      };

      const { data: exam, error } = await supabase
        .from('exams')
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        logger.error('Create exam error (GraphQL):', error);
        throw new Error('Failed to create exam');
      }

      if (parsedSyllabus.length) {
        const syllabusPayload = parsedSyllabus.map((topic) => ({ exam_id: exam.id, topic }));
        await supabase.from('exam_syllabus').insert(syllabusPayload);
      }

      const createdSections = await persistSections(exam.id, sections || []);

      return {
        exam,
        sections: createdSections
      };
    },

    updateExam: async (_, { id, input, sections = [], logo, thumbnail }, context) => {
      ensureAdminContext(context);

      const { data: existingExam, error: existingError } = await supabase
        .from('exams')
        .select('id, logo_url, thumbnail_url, slug')
        .eq('id', id)
        .single();

      if (existingError || !existingExam) {
        throw new Error('Exam not found');
      }

      const [logoFile, thumbnailFile] = await Promise.all([
        processUpload(logo),
        processUpload(thumbnail)
      ]);

      let logoUrl = existingExam.logo_url || null;
      let thumbnailUrl = existingExam.thumbnail_url || null;

      if (logoFile) {
        const uploadResult = await uploadExamLogo(logoFile);
        logoUrl = uploadResult.url;
      }
      if (thumbnailFile) {
        const uploadResult = await uploadExamThumbnail(thumbnailFile);
        thumbnailUrl = uploadResult.url;
      }

      const baseSlug = slugify(input.slug || input.title || existingExam.slug || 'exam');
      const examSlug = await ensureUniqueSlug(supabase, 'exams', baseSlug, { excludeId: id });
      const categorySlug = input.category_id ? await fetchCategorySlug(input.category_id) : (input.category || '');
      const subcategorySlug = input.subcategory_id ? await fetchSubcategorySlug(input.subcategory_id) : (input.subcategory || '');
      const combinedSlug = [categorySlug, subcategorySlug].filter(Boolean).join('-');
      const urlPath = `/${combinedSlug}/${examSlug}`.replace(/\/+\/+/g, '/');
      const allowAnytimeFlag = bool(input.allow_anytime);
      const normalizedStatus = allowAnytimeFlag ? 'anytime' : (input.status || 'upcoming');
      const normalizedStartDate = allowAnytimeFlag ? null : (input.start_date || null);
      const normalizedEndDate = allowAnytimeFlag ? null : (input.end_date || null);
      const parsedSyllabus = arrayOrEmpty(input.syllabus);
      const supportsHindi = computeSupportsHindi(sections);

      const updatePayload = {
        title: input.title,
        duration: numberOrNull(input.duration, 0),
        total_marks: numberOrNull(input.total_marks, 0),
        total_questions: numberOrNull(input.total_questions, 0),
        category: input.category || categorySlug,
        category_id: input.category_id || null,
        subcategory: input.subcategory || subcategorySlug,
        subcategory_id: input.subcategory_id || null,
        difficulty: input.difficulty || null,
        difficulty_id: input.difficulty_id || null,
        status: normalizedStatus,
        start_date: normalizedStartDate,
        end_date: normalizedEndDate,
        pass_percentage: numberOrNull(input.pass_percentage, 0),
        is_free: bool(input.is_free, true),
        price: numberOrNull(input.price, 0),
        negative_marking: bool(input.negative_marking),
        negative_mark_value: numberOrNull(input.negative_mark_value, 0),
        is_published: bool(input.is_published),
        allow_anytime: allowAnytimeFlag,
        exam_type: input.exam_type || 'mock_test',
        show_in_mock_tests: bool(input.show_in_mock_tests),
        supports_hindi: supportsHindi,
        logo_url: logoUrl,
        thumbnail_url: thumbnailUrl,
        slug: examSlug,
        url_path: urlPath,
        syllabus: parsedSyllabus
      };

      const { data: exam, error } = await supabase
        .from('exams')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        logger.error('Update exam error (GraphQL):', error);
        throw new Error('Failed to update exam');
      }

      await supabase
        .from('exam_syllabus')
        .delete()
        .eq('exam_id', id);

      if (parsedSyllabus.length) {
        const syllabusPayload = parsedSyllabus.map((topic) => ({ exam_id: id, topic }));
        await supabase.from('exam_syllabus').insert(syllabusPayload);
      }

      const createdSections = await replaceExamStructure(id, sections || []);

      return {
        exam,
        sections: createdSections
      };
    },

    deleteExam: async (_, { id }, context) => {
      ensureAdminContext(context);
      const { error } = await supabase
        .from('exams')
        .delete()
        .eq('id', id);

      if (error) {
        throw new Error('Failed to delete exam');
      }
      return true;
    },

    upsertDraftField: async (_, { input }, context) => {
      ensureAdminContext(context);
      const payload = {
        draft_key: input.draft_key,
        exam_id: input.exam_id || null,
        field_path: input.field_path,
        payload: input.payload,
        updated_by: context.user.id
      };

      const { data, error } = await supabase
        .from('exam_draft_fields')
        .upsert(payload, { onConflict: 'draft_key,field_path' })
        .select()
        .single();

      if (error) {
        throw new Error('Failed to save draft');
      }

      // Persist autosave change immediately for server-backed sections/questions/options
      try {
        await persistAutosaveChange({
          exam_id: payload.exam_id,
          field_path: payload.field_path,
          payload: payload.payload
        });
      } catch (autosaveError) {
        logger.error('Autosave persistence error:', autosaveError);
        // Continue returning draft data even if live persistence failed
      }

      return data;
    },

    clearDraft: async (_, { draft_key, exam_id }, context) => {
      ensureAdminContext(context);
      let query = supabase
        .from('exam_draft_fields')
        .delete()
        .eq('draft_key', draft_key);

      if (exam_id) {
        query = query.eq('exam_id', exam_id);
      }

      const { error } = await query;
      if (error) {
        throw new Error('Failed to clear draft');
      }
      return true;
    },

    uploadQuestionImage: async (_, { questionId, file }, { user }) => {
      if (!user) throw new Error('Unauthorized');
      
      try {
        // Decode base64 file data
        const matches = file.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          throw new Error('Invalid file format');
        }
        
        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Generate filename
        const extension = mimeType.split('/')[1] || 'jpg';
        const filename = `question-${questionId}-${Date.now()}.${extension}`;
        
        // Upload to R2 with proper folder structure
        const uploadService = require('../services/uploadService');
        const result = await uploadService.uploadBuffer(buffer, filename, mimeType, 'questions');

        if (isValidUuid(questionId)) {
          const { error: updateError } = await supabase
            .from('questions')
            .update({ image_url: result.url })
            .eq('id', questionId);

          if (updateError) {
            logger.error('Question image URL update error:', updateError);
            throw new Error('Failed to update question image');
          }
        } else {
          logger.warn('Skipping question image DB update for temporary question id', { questionId });
        }
        
        return {
          success: true,
          imageUrl: result.url
        };
      } catch (error) {
        logger.error('Question image upload error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    uploadOptionImage: async (_, { optionId, file }, { user }) => {
      if (!user) throw new Error('Unauthorized');
      
      try {
        // Decode base64 file data
        const matches = file.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          throw new Error('Invalid file format');
        }
        
        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Generate filename
        const extension = mimeType.split('/')[1] || 'jpg';
        const filename = `option-${optionId}-${Date.now()}.${extension}`;
        
        // Upload to R2 with proper folder structure
        const uploadService = require('../services/uploadService');
        const result = await uploadService.uploadBuffer(buffer, filename, mimeType, 'options');

        if (isValidUuid(optionId)) {
          const { error: updateError } = await supabase
            .from('question_options')
            .update({ image_url: result.url })
            .eq('id', optionId);

          if (updateError) {
            logger.error('Option image URL update error:', updateError);
            throw new Error('Failed to update option image');
          }
        } else {
          logger.warn('Skipping option image DB update for temporary option id', { optionId });
        }
        
        return {
          success: true,
          imageUrl: result.url
        };
      } catch (error) {
        logger.error('Option image upload error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  }
};

module.exports = resolvers;
