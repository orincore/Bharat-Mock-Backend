// structured_data is an overloaded JSONB column on page_seo. It holds BOTH:
//   1. Internal page config — `tab_headings`, `toc_order`, `tab_seo`
//   2. The admin's public JSON-LD schema (a flat object with `@context` / `@type` …)
//
// These are edited through independent admin panels that all hit the same
// `updateSEO` endpoint. A naive `structured_data = incoming` overwrite means
// saving one concern wipes the other (saving schema dropped tab headings, and
// saving tab headings dropped the schema). This helper merges the incoming
// payload onto what's already stored so the two concerns never clobber each
// other.
//
// Rules:
//   - Internal keys (tab_headings/toc_order/tab_seo) are replaced only when the
//     incoming payload actually provides them; otherwise the stored value is kept.
//   - Schema keys (everything else) are replaced as a set only when the incoming
//     payload contains schema keys (detected via @context/@type or any non-internal
//     key). This lets admins remove a schema field without it lingering, while a
//     config-only save leaves the existing schema untouched.

const INTERNAL_KEYS = ['tab_headings', 'toc_order', 'tab_seo'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const splitKeys = (obj) => {
  const internal = {};
  const schema = {};
  if (!isPlainObject(obj)) return { internal, schema };
  for (const [key, value] of Object.entries(obj)) {
    if (INTERNAL_KEYS.includes(key)) internal[key] = value;
    else schema[key] = value;
  }
  return { internal, schema };
};

// Parse one JSON-LD chunk into an object: direct JSON.parse, then a retry with
// control characters stripped (literal newlines inside string values are invalid
// JSON). Returns the object, or null when nothing usable can be extracted.
function parseJsonChunk(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (isPlainObject(parsed)) return parsed;
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line no-control-regex
    const parsed = JSON.parse(text.replace(/[\x00-\x1F\x7F]+/g, ' '));
    if (isPlainObject(parsed)) return parsed;
  } catch { /* give up */ }
  return null;
}

// Combine several JSON-LD objects into a single valid object. One schema is
// returned as-is; multiple are nested under `@graph` — the schema.org-native way
// to ship several entities in one block — so structured_data stays a single
// object that can coexist with the internal config keys.
function combineSchemas(schemas) {
  if (schemas.length === 0) return null;
  if (schemas.length === 1) return schemas[0];
  return {
    '@context': 'https://schema.org',
    // Drop each item's redundant @context — the wrapper supplies it.
    '@graph': schemas.map(({ '@context': _ctx, ...rest }) => rest),
  };
}

// Admins may enter JSON-LD as a raw string: plain JSON, JSON with literal
// newlines (invalid until control chars are stripped), an array of objects, or
// one OR MORE pasted <script type="application/ld+json"> blocks. structured_data
// must be stored as a single object so the schema can coexist with internal
// config keys, so we parse the string here and fold multiple entities into a
// single `@graph` object. Returns null when nothing usable can be extracted.
function parseSchemaString(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  // 1. Direct JSON parse — accept a single object, or an array of objects.
  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed;
    if (Array.isArray(parsed)) {
      const objs = parsed.filter(isPlainObject);
      if (objs.length) return combineSchemas(objs);
    }
  } catch { /* fall through */ }

  // 2. Strip control characters (literal newlines inside string values).
  try {
    // eslint-disable-next-line no-control-regex
    const parsed = JSON.parse(raw.replace(/[\x00-\x1F\x7F]+/g, ' '));
    if (isPlainObject(parsed)) return parsed;
    if (Array.isArray(parsed)) {
      const objs = parsed.filter(isPlainObject);
      if (objs.length) return combineSchemas(objs);
    }
  } catch { /* fall through */ }

  // 3. Extract JSON from EVERY pasted <script type="application/ld+json"> block.
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const schemas = [];
  let match;
  while ((match = scriptRe.exec(raw)) !== null) {
    const parsed = parseJsonChunk(match[1].trim());
    if (parsed) schemas.push(parsed);
  }
  if (schemas.length) return combineSchemas(schemas);

  return null;
}

/**
 * Merge an incoming structured_data payload onto the existing stored value,
 * preserving whichever concern (internal config vs. public schema) the incoming
 * save did not touch.
 *
 * @param {object|string|null|undefined} existing - structured_data currently in the DB
 * @param {object|string|null|undefined} incoming - structured_data from the request body
 * @returns {object} the merged structured_data to persist
 */
function mergeStructuredData(existing, incoming) {
  // Normalize a string schema payload into an object so it can merge with config.
  let incomingObj = incoming;
  if (typeof incoming === 'string') {
    incomingObj = parseSchemaString(incoming);
  }

  // Normalize a legacy string-stored existing value the same way.
  let existingObj = existing;
  if (typeof existing === 'string') {
    existingObj = parseSchemaString(existing);
  }

  // If the incoming value still isn't an object we can't reason about its keys;
  // keep what's stored (don't let an unparseable payload wipe valid data).
  if (!isPlainObject(incomingObj)) {
    if (isPlainObject(existingObj)) return existingObj;
    return isPlainObject(incoming) ? incoming : {};
  }

  const existingParts = splitKeys(existingObj);
  const incomingParts = splitKeys(incomingObj);

  // Internal keys: take incoming when provided, else keep existing.
  const internal = { ...existingParts.internal };
  for (const key of INTERNAL_KEYS) {
    if (key in incomingParts.internal) internal[key] = incomingParts.internal[key];
  }

  // Schema keys: replace the whole schema set only when the incoming payload
  // carries schema keys; otherwise retain the stored schema.
  const incomingHasSchema = Object.keys(incomingParts.schema).length > 0;
  const schema = incomingHasSchema ? incomingParts.schema : existingParts.schema;

  return { ...schema, ...internal };
}

module.exports = { mergeStructuredData, INTERNAL_KEYS };
