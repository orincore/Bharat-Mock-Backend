const slugify = (text = '') => {
  return text
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .substring(0, 180);
};

const ensureUniqueSlug = async (supabase, table, baseSlug, options = {}) => {
  const { column = 'slug', excludeId, filters = {} } = options;

  let slug = baseSlug || 'item';
  let uniqueSlug = slug;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase
      .from(table)
      .select('id')
      .eq(column, uniqueSlug)
      .limit(1);

    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    });

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data) {
      break;
    }

    uniqueSlug = `${slug}-${counter}`;
    counter += 1;
  }

  return uniqueSlug;
};

module.exports = {
  slugify,
  ensureUniqueSlug
};
