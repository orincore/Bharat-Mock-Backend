const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const logger = require('../config/logger');

const contactInclude = {
  contact_social_links: {
    select: { id: true, platform: true, label: true, url: true, icon: true, display_order: true, is_active: true },
  },
};

const handleSupabaseError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getContactInfo = async () => {
  const data = await prisma.contact_info.findFirst({
    orderBy: { created_at: 'asc' },
    include: contactInclude,
  });

  return data || null;
};

const sanitizeContactPayload = (payload = {}) => {
  const fields = [
    'headline',
    'subheading',
    'description',
    'support_email',
    'support_phone',
    'whatsapp_number',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'country',
    'support_hours',
    'map_embed_url'
  ];

  const sanitized = {};
  fields.forEach((field) => {
    if (payload[field] !== undefined) {
      sanitized[field] = payload[field];
    }
  });

  sanitized.updated_at = new Date().toISOString();
  return sanitized;
};

const sanitizeSocialLinks = (links = []) => {
  if (!Array.isArray(links)) return [];
  return links
    .filter((link) => link && link.platform && link.url)
    .map((link, index) => ({
      // New links arrive without an id; generate one so the NOT NULL `id` column is
      // satisfied (a null id is rejected — the column DEFAULT only fires when id is
      // omitted) and the upsert's onConflict:'id' has a stable key for every row.
      id: link.id || randomUUID(),
      platform: link.platform,
      label: link.label || link.platform,
      url: link.url,
      icon: link.icon || link.platform,
      display_order: Number.isFinite(link.display_order) ? link.display_order : index,
      is_active: typeof link.is_active === 'boolean' ? link.is_active : true
    }));
};

const publicContact = async (req, res) => {
  try {
    const contact = await getContactInfo();
    return res.json({ success: true, data: contact });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch contact info', error);
  }
};

const adminGetContact = async (req, res) => {
  try {
    const contact = await getContactInfo();
    return res.json({ success: true, data: contact });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to fetch contact info', error);
  }
};

const adminUpsertContact = async (req, res) => {
  try {
    const payload = sanitizeContactPayload(req.body || {});
    if (!payload.headline || !payload.support_email || !payload.support_phone || !payload.address_line1) {
      return res.status(400).json({ success: false, message: 'Headline, support email, support phone, and address are required.' });
    }

    const existing = await getContactInfo();
    let contact;

    try {
      if (existing?.id) {
        contact = await prisma.contact_info.update({
          where: { id: existing.id },
          data: payload,
          include: contactInclude,
        });
      } else {
        contact = await prisma.contact_info.create({
          data: payload,
          include: contactInclude,
        });
      }
    } catch (error) {
      return handleSupabaseError(res, existing?.id ? 'Failed to update contact info' : 'Failed to create contact info', error);
    }

    const sanitizedSocials = sanitizeSocialLinks(req.body.contact_social_links || req.body.social_links || []);

    if (sanitizedSocials.length) {
      try {
        await Promise.all(sanitizedSocials.map((link) => {
          const { id, ...rest } = link;
          const data = { ...rest, contact_id: contact.id, updated_at: new Date() };
          return prisma.contact_social_links.upsert({
            where: { id },
            create: { id, ...data },
            update: data,
          });
        }));
      } catch (socialError) {
        return handleSupabaseError(res, 'Failed to upsert social links', socialError);
      }
    }

    if (Array.isArray(req.body.deleted_social_ids) && req.body.deleted_social_ids.length) {
      try {
        await prisma.contact_social_links.deleteMany({
          where: { id: { in: req.body.deleted_social_ids } },
        });
      } catch (deleteError) {
        return handleSupabaseError(res, 'Failed to delete social links', deleteError);
      }
    }

    const refreshed = await getContactInfo();
    return res.json({ success: true, data: refreshed });
  } catch (error) {
    return handleSupabaseError(res, 'Failed to save contact info', error);
  }
};

module.exports = {
  publicContact,
  adminGetContact,
  adminUpsertContact
};
