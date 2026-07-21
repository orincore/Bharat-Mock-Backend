const prisma = require('../config/prisma');
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

const safeSelect = { id: true, section: true, section_order: true, label: true, href: true, display_order: true, is_active: true, open_in_new_tab: true, created_at: true, updated_at: true };

const handleSupabaseError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getFooterLinks = async (req, res) => {
  try {
    const data = await prisma.footer_links.findMany({
      where: { deleted_at: null, is_active: true },
      select: safeSelect,
      orderBy: [{ section_order: 'asc' }, { section: 'asc' }, { display_order: 'asc' }, { created_at: 'asc' }],
    });

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch footer links', error);
  }
};

const getAdminFooterLinks = async (req, res) => {
  try {
    const data = await prisma.footer_links.findMany({
      where: { deleted_at: null },
      select: safeSelect,
      orderBy: [{ section_order: 'asc' }, { section: 'asc' }, { display_order: 'asc' }, { created_at: 'asc' }],
    });

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch footer links', error);
  }
};

const createFooterLink = async (req, res) => {
  try {
    const payload = sanitizeLinkPayload(req.body, req.user?.id || null);
    payload.created_by = req.user?.id || null;

    const data = await prisma.footer_links.create({
      data: payload,
      select: safeSelect,
    });

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

    const existing = await prisma.footer_links.findFirst({ where: { id, deleted_at: null } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Footer link not found' });
    }

    const data = await prisma.footer_links.update({
      where: { id },
      data: payload,
      select: safeSelect,
    });

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

    await prisma.footer_links.updateMany({
      where: { id, deleted_at: null },
      data: { deleted_at: new Date(), is_active: false },
    });

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

    // The old supabase `.upsert(..., { onConflict: 'id' })` call only ever hits the
    // UPDATE branch in practice (every id here comes from reordering existing links),
    // and would actually violate NOT NULL constraints on `label`/`href` if it ever tried
    // a real insert (those columns aren't in the payload). Using per-row `update` in a
    // transaction is the faithful equivalent of how this endpoint is actually used.
    const updates = order.map((item, index) => ({
      id: item.id,
      section_order: sanitizeNumber(item.section_order ?? item.sectionIndex ?? 0),
      display_order: sanitizeNumber(item.display_order ?? index),
      updated_at: new Date(),
      updated_by: req.user?.id || null
    }));

    await prisma.$transaction(
      updates.map(({ id, ...data }) => prisma.footer_links.update({ where: { id }, data }))
    );

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
