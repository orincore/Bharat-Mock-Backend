const supabase = require('../config/database');
const logger = require('../config/logger');

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

const safeSelect = `id, label, href, display_order, is_active, open_in_new_tab, created_at, updated_at`;

const handleSupabaseError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getNavigationLinks = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('navigation_links')
      .select(safeSelect)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      return handleSupabaseError(res, 'Failed to fetch navigation links', error);
    }

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch navigation links', error);
  }
};

const getAdminNavigationLinks = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('navigation_links')
      .select(`${safeSelect}, is_active, open_in_new_tab`)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      return handleSupabaseError(res, 'Failed to fetch navigation links', error);
    }

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch navigation links', error);
  }
};

const createNavigationLink = async (req, res) => {
  try {
    const payload = sanitizeLinkPayload(req.body, req.user?.id || null);
    payload.created_by = req.user?.id || null;

    const { data, error } = await supabase
      .from('navigation_links')
      .insert(payload)
      .select(safeSelect)
      .single();

    if (error) {
      return handleSupabaseError(res, 'Failed to create navigation link', error);
    }

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

    const { data, error } = await supabase
      .from('navigation_links')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null)
      .select(safeSelect)
      .single();

    if (error) {
      return handleSupabaseError(res, 'Failed to update navigation link', error);
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Navigation link not found' });
    }

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

    const { error } = await supabase
      .from('navigation_links')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) {
      return handleSupabaseError(res, 'Failed to delete navigation link', error);
    }

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

    const updates = order.map((item, index) => ({
      id: item.id,
      display_order: sanitizeNumber(item.display_order ?? index),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null
    }));

    const { error } = await supabase
      .from('navigation_links')
      .upsert(updates, { onConflict: 'id' });

    if (error) {
      return handleSupabaseError(res, 'Failed to reorder navigation links', error);
    }

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
