const slugify = (text = '', options = {}) => {
  const { fallback = 'item' } = options;

  const base = text
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .substring(0, 180);

  // Titles made entirely of characters outside a-z0-9 (emoji, non-Latin
  // scripts like Hindi, pure punctuation, etc.) normalize to an empty
  // string. Never return that - an empty slug collides with every other
  // empty-title tab and breaks the URL. Fall back to a short random key.
  if (base) return base;

  return `${fallback}-${Math.random().toString(36).slice(2, 8)}`;
};

const ensureUniqueSlug = async (model, baseSlug, options = {}) => {
  const { column = 'slug', excludeId, filters = {} } = options;

  let slug = baseSlug || 'item';
  let uniqueSlug = slug;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { [column]: uniqueSlug, ...filters };
    if (excludeId) where.id = { not: excludeId };

    const existing = await model.findFirst({ where, select: { id: true } });

    if (!existing) break;

    uniqueSlug = `${slug}-${counter}`;
    counter += 1;
  }

  return uniqueSlug;
};

module.exports = {
  slugify,
  ensureUniqueSlug
};
