const supabase = require('../config/database');
const logger = require('../config/logger');
const { uploadToR2 } = require('../utils/fileUpload');

const TABLE_NAME = 'page_banners';

const formatError = (message) => ({ success: false, message });

const fetchBanners = async (pageIdentifier, onlyActive = true) => {
  if (!pageIdentifier) {
    return [];
  }

  let query = supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('page_identifier', pageIdentifier)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (onlyActive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('[pageBanners] fetch error', { pageIdentifier, error });
    return [];
  }

  return data || [];
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
      const { count } = await supabase
        .from(TABLE_NAME)
        .select('*', { count: 'exact', head: true })
        .eq('page_identifier', pageIdentifier);
      orderValue = count || 0;
    }

    const payload = {
      page_identifier: pageIdentifier,
      image_url: imageUrl,
      link_url: linkUrl || null,
      alt_text: altText || null,
      display_order: orderValue,
      is_active: Boolean(isActive)
    };

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .insert(payload)
      .select('*')
      .single();

    if (error) {
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

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error || !data) {
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

    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq('id', id);

    if (error) {
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

    const updates = order.map((id, index) =>
      supabase
        .from(TABLE_NAME)
        .update({ display_order: index })
        .eq('id', id)
    );

    await Promise.all(updates);
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
