const supabase = require('../config/database');
const logger = require('../config/logger');

const sanitizeNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeLinkPayload = (payload = {}, userId = null) => {
  const {
    section,
    section_order,
    label,
    href,
    display_order,
    is_active,
    open_in_new_tab
  } = payload;

  if (!label?.trim()) {
    throw new Error('Footer link label is required');
  }
  if (!href?.trim()) {
    throw new Error('Footer link (href) is required');
  }

  return {
    section: section?.trim() || 'General',
    section_order: sanitizeNumber(section_order),
    label: label.trim(),
    href: href.trim(),
    display_order: sanitizeNumber(display_order),
    is_active: typeof is_active === 'boolean' ? is_active : true,
    open_in_new_tab: typeof open_in_new_tab === 'boolean' ? open_in_new_tab : false,
    updated_by: userId,
    updated_at: new Date().toISOString()
  };
};

const safeSelect = `id, section, section_order, label, href, display_order, is_active, open_in_new_tab, created_at, updated_at`;

const handleSupabaseError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getFooterLinks = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('footer_links')
      .select(safeSelect)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('section_order', { ascending: true })
      .order('section', { ascending: true })
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      return handleSupabaseError(res, 'Failed to fetch footer links', error);
    }

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch footer links', error);
  }
};

const getAdminFooterLinks = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('footer_links')
      .select(safeSelect)
      .is('deleted_at', null)
      .order('section_order', { ascending: true })
      .order('section', { ascending: true })
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      return handleSupabaseError(res, 'Failed to fetch footer links', error);
    }

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch footer links', error);
  }
};

const createFooterLink = async (req, res) => {
  try {
    const payload = sanitizeLinkPayload(req.body, req.user?.id || null);
    payload.created_by = req.user?.id || null;

    const { data, error } = await supabase
      .from('footer_links')
      .insert(payload)
      .select(safeSelect)
      .single();

    if (error) {
      return handleSupabaseError(res, 'Failed to create footer link', error);
    }

    return res.status(201).json({ success: true, data });
  } catch (error) {
    if (error.message?.includes('required')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleSupabaseError(res, 'Failed to create footer link', error);
  }
};

const updateFooterLink = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Footer link ID is required' });
    }

    const payload = sanitizeLinkPayload(req.body, req.user?.id || null);

    const { data, error } = await supabase
      .from('footer_links')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null)
      .select(safeSelect)
      .single();

    if (error) {
      return handleSupabaseError(res, 'Failed to update footer link', error);
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Footer link not found' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    if (error.message?.includes('required')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleSupabaseError(res, 'Failed to update footer link', error);
  }
};

const deleteFooterLink = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Footer link ID is required' });
    }

    const { error } = await supabase
      .from('footer_links')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) {
      return handleSupabaseError(res, 'Failed to delete footer link', error);
    }

    return res.json({ success: true, message: 'Footer link deleted successfully' });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to delete footer link', error);
  }
};

const reorderFooterLinks = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, message: 'Order payload must be a non-empty array' });
    }

    const updates = order.map((item, index) => ({
      id: item.id,
      section_order: sanitizeNumber(item.section_order ?? item.sectionIndex ?? 0),
      display_order: sanitizeNumber(item.display_order ?? index),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null
    }));

    const { error } = await supabase
      .from('footer_links')
      .upsert(updates, { onConflict: 'id' });

    if (error) {
      return handleSupabaseError(res, 'Failed to reorder footer links', error);
    }

    return getAdminFooterLinks(req, res);
  } catch (error) {
    return handleSupabaseError(res, 'Failed to reorder footer links', error);
  }
};

module.exports = {
  getFooterLinks,
  getAdminFooterLinks,
  createFooterLink,
  updateFooterLink,
  deleteFooterLink,
  reorderFooterLinks
};
