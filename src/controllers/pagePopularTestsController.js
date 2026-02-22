const supabase = require('../config/database');

const buildErrorResponse = (message, statusCode = 500) => ({
  success: false,
  message,
  statusCode
});

const getPopularTests = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;
    
    const { data, error } = await supabase
      .from('page_popular_tests')
      .select(`
        id,
        page_identifier,
        exam_id,
        display_order,
        is_active,
        created_at,
        updated_at,
        exams (
          id,
          title,
          slug,
          duration,
          total_questions,
          thumbnail_url,
          logo_url,
          difficulty,
          category,
          subcategory,
          exam_type,
          is_premium,
          status,
          allow_anytime,
          start_date,
          end_date
        )
      `)
      .eq('page_identifier', pageIdentifier)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching popular tests:', error);
      return res.status(500).json(buildErrorResponse('Failed to fetch popular tests'));
    }

    const formattedData = data.map(item => ({
      id: item.id,
      displayOrder: item.display_order,
      exam: item.exams
    }));

    return res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (err) {
    console.error('Error in getPopularTests:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const getPopularTestsAdmin = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;
    
    const { data, error } = await supabase
      .from('page_popular_tests')
      .select(`
        id,
        page_identifier,
        exam_id,
        display_order,
        is_active,
        created_at,
        updated_at,
        exams (
          id,
          title,
          slug,
          duration,
          total_questions,
          thumbnail_url,
          logo_url,
          difficulty,
          category,
          subcategory,
          exam_type,
          is_premium,
          status
        )
      `)
      .eq('page_identifier', pageIdentifier)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching popular tests (admin):', error);
      return res.status(500).json(buildErrorResponse('Failed to fetch popular tests'));
    }

    const formattedData = data.map(item => ({
      id: item.id,
      pageIdentifier: item.page_identifier,
      examId: item.exam_id,
      displayOrder: item.display_order,
      isActive: item.is_active,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      exam: item.exams
    }));

    return res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (err) {
    console.error('Error in getPopularTestsAdmin:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const addPopularTest = async (req, res) => {
  try {
    const { pageIdentifier, examId } = req.body;

    if (!pageIdentifier || !examId) {
      return res.status(400).json(buildErrorResponse('Page identifier and exam ID are required', 400));
    }

    const { data: existingTests, error: fetchError } = await supabase
      .from('page_popular_tests')
      .select('display_order')
      .eq('page_identifier', pageIdentifier)
      .order('display_order', { ascending: false })
      .limit(1);

    if (fetchError) {
      console.error('Error fetching existing tests:', fetchError);
      return res.status(500).json(buildErrorResponse('Failed to add popular test'));
    }

    const nextOrder = existingTests.length > 0 ? existingTests[0].display_order + 1 : 0;

    const { data, error } = await supabase
      .from('page_popular_tests')
      .insert({
        page_identifier: pageIdentifier,
        exam_id: examId,
        display_order: nextOrder,
        is_active: true
      })
      .select(`
        id,
        page_identifier,
        exam_id,
        display_order,
        is_active,
        created_at,
        updated_at,
        exams (
          id,
          title,
          slug,
          duration,
          total_questions,
          thumbnail_url,
          logo_url,
          difficulty,
          category,
          subcategory,
          exam_type,
          is_premium,
          status
        )
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json(buildErrorResponse('This exam is already in the popular tests list', 409));
      }
      console.error('Error adding popular test:', error);
      return res.status(500).json(buildErrorResponse('Failed to add popular test'));
    }

    return res.status(201).json({
      success: true,
      message: 'Popular test added successfully',
      data: {
        id: data.id,
        pageIdentifier: data.page_identifier,
        examId: data.exam_id,
        displayOrder: data.display_order,
        isActive: data.is_active,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        exam: data.exams
      }
    });
  } catch (err) {
    console.error('Error in addPopularTest:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const removePopularTest = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('page_popular_tests')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error removing popular test:', error);
      return res.status(500).json(buildErrorResponse('Failed to remove popular test'));
    }

    return res.status(200).json({
      success: true,
      message: 'Popular test removed successfully'
    });
  } catch (err) {
    console.error('Error in removePopularTest:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const reorderPopularTests = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json(buildErrorResponse('Ordered IDs array is required', 400));
    }

    const updates = orderedIds.map((id, index) => 
      supabase
        .from('page_popular_tests')
        .update({ display_order: index })
        .eq('id', id)
        .eq('page_identifier', pageIdentifier)
    );

    const results = await Promise.all(updates);
    
    const hasError = results.some(result => result.error);
    if (hasError) {
      console.error('Error reordering popular tests');
      return res.status(500).json(buildErrorResponse('Failed to reorder popular tests'));
    }

    return res.status(200).json({
      success: true,
      message: 'Popular tests reordered successfully'
    });
  } catch (err) {
    console.error('Error in reorderPopularTests:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

const togglePopularTestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json(buildErrorResponse('isActive must be a boolean', 400));
    }

    const { data, error } = await supabase
      .from('page_popular_tests')
      .update({ is_active: isActive })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error toggling popular test status:', error);
      return res.status(500).json(buildErrorResponse('Failed to update popular test status'));
    }

    return res.status(200).json({
      success: true,
      message: 'Popular test status updated successfully',
      data: {
        id: data.id,
        isActive: data.is_active
      }
    });
  } catch (err) {
    console.error('Error in togglePopularTestStatus:', err);
    return res.status(500).json(buildErrorResponse('Internal server error'));
  }
};

module.exports = {
  getPopularTests,
  getPopularTestsAdmin,
  addPopularTest,
  removePopularTest,
  reorderPopularTests,
  togglePopularTestStatus
};
