const supabase = require('../config/database');
const logger = require('../config/logger');

const getColleges = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      location, 
      type,
      sortBy = 'ranking'
    } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from('colleges')
      .select('*', { count: 'exact' })
      .eq('is_published', true)
      .is('deleted_at', null);

    if (search) {
      query = query.or(`name.ilike.%${search}%,location.ilike.%${search}%`);
    }

    if (location) {
      query = query.ilike('location', `%${location}%`);
    }

    if (type) {
      query = query.eq('type', type);
    }

    if (sortBy === 'ranking') {
      query = query.order('ranking', { ascending: true, nullsLast: true });
    } else if (sortBy === 'rating') {
      query = query.order('rating', { ascending: false, nullsLast: true });
    }

    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: colleges, error, count } = await query;

    if (error) {
      logger.error('Get colleges error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch colleges'
      });
    }

    res.json({
      success: true,
      data: colleges,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get colleges error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch colleges'
    });
  }
};

const getCollegeById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: college, error } = await supabase
      .from('colleges')
      .select('*')
      .eq('id', id)
      .eq('is_published', true)
      .is('deleted_at', null)
      .single();

    if (error || !college) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    const { data: accreditations } = await supabase
      .from('college_accreditations')
      .select('accreditation')
      .eq('college_id', id);

    const { data: facilities } = await supabase
      .from('college_facilities')
      .select('facility')
      .eq('college_id', id);

    const { data: fees } = await supabase
      .from('college_fees')
      .select('course, fee, currency')
      .eq('college_id', id);

    const { data: cutoffs } = await supabase
      .from('college_cutoffs')
      .select('exam, year, category, rank')
      .eq('college_id', id)
      .order('year', { ascending: false });

    const { data: placement } = await supabase
      .from('college_placements')
      .select(`
        average_package,
        highest_package,
        placement_percentage,
        college_recruiters (
          recruiter_name
        )
      `)
      .eq('college_id', id)
      .single();

    college.accreditation = accreditations?.map(a => a.accreditation) || [];
    college.facilities = facilities?.map(f => f.facility) || [];
    college.fees = {
      minFee: fees?.length > 0 ? Math.min(...fees.map(f => f.fee)) : 0,
      maxFee: fees?.length > 0 ? Math.max(...fees.map(f => f.fee)) : 0,
      currency: fees?.[0]?.currency || 'INR',
      details: fees || []
    };
    college.cutoffs = cutoffs || [];
    college.placements = placement ? {
      averagePackage: placement.average_package,
      highestPackage: placement.highest_package,
      placementPercentage: placement.placement_percentage,
      topRecruiters: placement.college_recruiters?.map(r => r.recruiter_name) || []
    } : null;

    res.json({
      success: true,
      data: college
    });
  } catch (error) {
    logger.error('Get college by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch college details'
    });
  }
};

module.exports = {
  getColleges,
  getCollegeById
};
