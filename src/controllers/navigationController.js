const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { redisCache, buildCacheKey } = require('../utils/redisCache');

const NAV_TTL = 86400; // 24 hours — navigation rarely changes, invalidated on every write
const NAV_CACHE_KEY = buildCacheKey('navigation', 'links');
const INIT_PUBLIC_KEY = buildCacheKey('init', 'public');
// Per-user init caches (init:user:<id>) also embed the navbar links, so bust them too.
const INIT_USER_PATTERN = buildCacheKey('init', 'user', '*');

const invalidateNavCache = async () => {
  await Promise.all([
    redisCache.del(NAV_CACHE_KEY),
    redisCache.del(INIT_PUBLIC_KEY),
    redisCache.deleteByPattern(INIT_USER_PATTERN),
  ]);
  console.log('[Cache] Invalidated navigation:links + init:public + init:user:*');
};

const sanitizeNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const sanitizeLinkPayload = (payload = {}, userId = null) => {
  const {
    label,
    href,
    display_order,
    is_active,
    open_in_new_tab
  } = payload;

  if (!label?.trim()) {
    throw new Error('Navigation label is required');
  }
  if (!href?.trim()) {
    throw new Error('Navigation link (href) is required');
  }

  return {
    label: label.trim(),
    href: href.trim(),
    display_order: sanitizeNumber(display_order),
    is_active: sanitizeBoolean(is_active, true),
    open_in_new_tab: sanitizeBoolean(open_in_new_tab, false),
    updated_by: userId,
    updated_at: new Date().toISOString()
  };
};

const safeSelect = { id: true, label: true, href: true, display_order: true, is_active: true, open_in_new_tab: true, created_at: true, updated_at: true };

const handleSupabaseError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getNavigationLinks = async (req, res) => {
  try {
    const cached = await redisCache.get(NAV_CACHE_KEY);
    if (cached) {
      console.log('[Cache] HIT  navigation:links');
      return res.json(cached);
    }
    console.log('[Cache] MISS navigation:links — fetching from DB');

    const data = await prisma.navigation_links.findMany({
      where: { deleted_at: null, is_active: true },
      select: safeSelect,
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    });

    const responsePayload = { success: true, data: data || [] };
    await redisCache.set(NAV_CACHE_KEY, responsePayload, NAV_TTL);
    console.log(`[Cache] SET  navigation:links (TTL ${NAV_TTL}s)`);
    return res.json(responsePayload);
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch navigation links', error);
  }
};

const getAdminNavigationLinks = async (req, res) => {
  try {
    const data = await prisma.navigation_links.findMany({
      where: { deleted_at: null },
      select: safeSelect,
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    });

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch navigation links', error);
  }
};

const createNavigationLink = async (req, res) => {
  try {
    const payload = sanitizeLinkPayload(req.body, req.user?.id || null);
    payload.created_by = req.user?.id || null;

    let data;
    try {
      data = await prisma.navigation_links.create({ data: payload, select: safeSelect });
    } catch (error) {
      return handleSupabaseError(res, 'Failed to create navigation link', error);
    }

    await invalidateNavCache();
    return res.status(201).json({ success: true, data });
  } catch (error) {
    if (error.message?.includes('required')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleSupabaseError(res, 'Failed to create navigation link', error);
  }
};

const updateNavigationLink = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Navigation link ID is required' });
    }

    const payload = sanitizeLinkPayload(req.body, req.user?.id || null);

    const existing = await prisma.navigation_links.findFirst({ where: { id, deleted_at: null } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Navigation link not found' });
    }

    let data;
    try {
      data = await prisma.navigation_links.update({ where: { id }, data: payload, select: safeSelect });
    } catch (error) {
      return handleSupabaseError(res, 'Failed to update navigation link', error);
    }

    await invalidateNavCache();
    return res.json({ success: true, data });
  } catch (error) {
    if (error.message?.includes('required')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleSupabaseError(res, 'Failed to update navigation link', error);
  }
};

const deleteNavigationLink = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Navigation link ID is required' });
    }

    await prisma.navigation_links.updateMany({
      where: { id, deleted_at: null },
      data: { deleted_at: new Date(), is_active: false },
    });

    await invalidateNavCache();
    return res.json({ success: true, message: 'Navigation link deleted successfully' });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to delete navigation link', error);
  }
};

const reorderNavigationLinks = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, message: 'Order payload must be a non-empty array' });
    }

    // As with footerController's reorder, every id here comes from reordering existing
    // links — a real upsert would violate NOT NULL constraints on label/href since
    // they're not in this payload. Per-row update is the faithful equivalent.
    const updates = order.map((item, index) => ({
      id: item.id,
      display_order: sanitizeNumber(item.display_order ?? index),
      updated_at: new Date(),
      updated_by: req.user?.id || null
    }));

    try {
      await prisma.$transaction(
        updates.map(({ id, ...data }) => prisma.navigation_links.update({ where: { id }, data }))
      );
    } catch (error) {
      return handleSupabaseError(res, 'Failed to reorder navigation links', error);
    }

    await invalidateNavCache();
    return getAdminNavigationLinks(req, res);
  } catch (error) {
    return handleSupabaseError(res, 'Failed to reorder navigation links', error);
  }
};

module.exports = {
  getNavigationLinks,
  getAdminNavigationLinks,
  createNavigationLink,
  updateNavigationLink,
  deleteNavigationLink,
  reorderNavigationLinks,
};
