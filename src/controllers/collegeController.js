const prisma = require('../config/prisma');
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

    const where = {
      is_published: true,
      deleted_at: null,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }

    if (type) {
      where.type = type;
    }

    let orderBy;
    if (sortBy === 'ranking') {
      orderBy = { ranking: { sort: 'asc', nulls: 'last' } };
    } else if (sortBy === 'rating') {
      orderBy = { rating: { sort: 'desc', nulls: 'last' } };
    }

    const [colleges, count] = await Promise.all([
      prisma.colleges.findMany({
        where,
        ...(orderBy ? { orderBy } : {}),
        skip: offset,
        take: parseInt(limit),
      }),
      prisma.colleges.count({ where }),
    ]);

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

    const college = await prisma.colleges.findFirst({
      where: { id, is_published: true, deleted_at: null },
    });

    if (!college) {
      return res.status(404).json({
        success: false,
        message: 'College not found'
      });
    }

    const [accreditations, facilities, fees, cutoffs, placement] = await Promise.all([
      prisma.college_accreditations.findMany({
        where: { college_id: id },
        select: { accreditation: true },
      }),
      prisma.college_facilities.findMany({
        where: { college_id: id },
        select: { facility: true },
      }),
      prisma.college_fees.findMany({
        where: { college_id: id },
        select: { course: true, fee: true, currency: true },
      }),
      prisma.college_cutoffs.findMany({
        where: { college_id: id },
        select: { exam: true, year: true, category: true, rank: true },
        orderBy: { year: 'desc' },
      }),
      prisma.college_placements.findUnique({
        where: { college_id: id },
        select: {
          average_package: true,
          highest_package: true,
          placement_percentage: true,
          college_recruiters: { select: { recruiter_name: true } },
        },
      }),
    ]);

    // Decimal columns come back as Decimal.js objects, not plain numbers —
    // must convert before doing arithmetic like Math.min/Math.max.
    const feeAmounts = fees.map(f => Number(f.fee));

    college.accreditation = accreditations.map(a => a.accreditation) || [];
    college.facilities = facilities.map(f => f.facility) || [];
    college.fees = {
      minFee: feeAmounts.length > 0 ? Math.min(...feeAmounts) : 0,
      maxFee: feeAmounts.length > 0 ? Math.max(...feeAmounts) : 0,
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
