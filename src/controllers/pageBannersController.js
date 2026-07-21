const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { uploadToR2 } = require('../utils/fileUpload');

const formatError = (message) => ({ success: false, message });

const fetchBanners = async (pageIdentifier, onlyActive = true) => {
  if (!pageIdentifier) {
    return [];
  }

  try {
    return await prisma.page_banners.findMany({
      where: {
        page_identifier: pageIdentifier,
        ...(onlyActive ? { is_active: true } : {}),
      },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    });
  } catch (error) {
    logger.error('[pageBanners] fetch error', { pageIdentifier, error });
    return [];
  }
};

const getPublicBanners = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;
    const banners = await fetchBanners(pageIdentifier, true);
    return res.json({ success: true, data: banners });
  } catch (error) {
    logger.error('[pageBanners] public fetch error', error);
    return res.status(500).json(formatError('Failed to fetch banners'));
  }
};

const getAdminBanners = async (req, res) => {
  try {
    const { pageIdentifier } = req.params;
    const banners = await fetchBanners(pageIdentifier, false);
    return res.json({ success: true, data: banners });
  } catch (error) {
    logger.error('[pageBanners] admin fetch error', error);
    return res.status(500).json(formatError('Failed to fetch banners'));
  }
};

const createBanner = async (req, res) => {
  try {
    const {
      pageIdentifier,
      imageUrl,
      linkUrl,
      altText,
      displayOrder,
      isActive = true
    } = req.body;

    if (!pageIdentifier || !imageUrl) {
      return res.status(400).json(formatError('Page identifier and image URL are required'));
    }

    let orderValue = Number(displayOrder);
    if (!Number.isFinite(orderValue)) {
      orderValue = await prisma.page_banners.count({
        where: { page_identifier: pageIdentifier },
      });
    }

    const payload = {
      page_identifier: pageIdentifier,
      image_url: imageUrl,
      link_url: linkUrl || null,
      alt_text: altText || null,
      display_order: orderValue,
      is_active: Boolean(isActive)
    };

    let data;
    try {
      data = await prisma.page_banners.create({ data: payload });
    } catch (error) {
      logger.error('[pageBanners] create error', error);
      return res.status(500).json(formatError('Failed to create banner'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[pageBanners] create exception', error);
    return res.status(500).json(formatError('Server error while creating banner'));
  }
};

const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json(formatError('Banner ID is required'));
    }

    const updates = {};
    const map = {
      pageIdentifier: 'page_identifier',
      imageUrl: 'image_url',
      linkUrl: 'link_url',
      altText: 'alt_text',
      isActive: 'is_active'
    };

    Object.entries(req.body || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (key === 'displayOrder' && Number.isFinite(Number(value))) {
        updates.display_order = Number(value);
      } else if (map[key]) {
        updates[map[key]] = key === 'isActive' ? Boolean(value) : value;
      }
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json(formatError('No fields to update'));
    }

    let data;
    try {
      data = await prisma.page_banners.update({ where: { id }, data: updates });
    } catch (error) {
      logger.error('[pageBanners] update error', error);
      return res.status(404).json(formatError('Banner not found or failed to update'));
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[pageBanners] update exception', error);
    return res.status(500).json(formatError('Server error while updating banner'));
  }
};

const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json(formatError('Banner ID is required'));
    }

    try {
      await prisma.page_banners.delete({ where: { id } });
    } catch (error) {
      logger.error('[pageBanners] delete error', error);
      return res.status(500).json(formatError('Failed to delete banner'));
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('[pageBanners] delete exception', error);
    return res.status(500).json(formatError('Server error while deleting banner'));
  }
};

const reorderBanners = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || !order.length) {
      return res.status(400).json(formatError('Order array is required'));
    }

    await prisma.$transaction(
      order.map((id, index) => prisma.page_banners.update({ where: { id }, data: { display_order: index } }))
    );
    return res.json({ success: true });
  } catch (error) {
    logger.error('[pageBanners] reorder error', error);
    return res.status(500).json(formatError('Failed to reorder banners'));
  }
};

const uploadBannerImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(formatError('Image file is required'));
    }

    const uploadResult = await uploadToR2(req.file, 'page-banners');

    if (!uploadResult?.url) {
      return res.status(500).json(formatError('Failed to upload banner image'));
    }

    return res.json({ success: true, data: uploadResult });
  } catch (error) {
    logger.error('[pageBanners] upload error', error);
    return res.status(500).json(formatError('Server error while uploading image'));
  }
};

module.exports = {
  getPublicBanners,
  getAdminBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  reorderBanners,
  uploadBannerImage
};
