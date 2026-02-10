const supabase = require('../config/database');
const logger = require('../config/logger');

const contactSelect = `id, headline, subheading, description, support_email, support_phone, whatsapp_number,
  address_line1, address_line2, city, state, postal_code, country, support_hours, map_embed_url,
  contact_social_links(id, platform, label, url, icon, display_order, is_active)`;

const handleSupabaseError = (res, message, error) => {
  logger.error(message, error);
  return res.status(500).json({ success: false, message });
};

const getContactInfo = async () => {
  const { data, error } = await supabase
    .from('contact_info')
    .select(contactSelect)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

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
      id: link.id,
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

    if (existing?.id) {
      const { data, error } = await supabase
        .from('contact_info')
        .update(payload)
        .eq('id', existing.id)
        .select(contactSelect)
        .single();

      if (error) return handleSupabaseError(res, 'Failed to update contact info', error);
      contact = data;
    } else {
      const { data, error } = await supabase
        .from('contact_info')
        .insert(payload)
        .select(contactSelect)
        .single();

      if (error) return handleSupabaseError(res, 'Failed to create contact info', error);
      contact = data;
    }

    const sanitizedSocials = sanitizeSocialLinks(req.body.contact_social_links || req.body.social_links || []);

    if (sanitizedSocials.length) {
      const upsertPayload = sanitizedSocials.map((link) => ({
        ...link,
        contact_id: contact.id,
        updated_at: new Date().toISOString()
      }));

      const { error: socialError } = await supabase
        .from('contact_social_links')
        .upsert(upsertPayload, { onConflict: 'id' });

      if (socialError) return handleSupabaseError(res, 'Failed to upsert social links', socialError);
    }

    if (Array.isArray(req.body.deleted_social_ids) && req.body.deleted_social_ids.length) {
      const { error: deleteError } = await supabase
        .from('contact_social_links')
        .delete()
        .in('id', req.body.deleted_social_ids);

      if (deleteError) return handleSupabaseError(res, 'Failed to delete social links', deleteError);
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
