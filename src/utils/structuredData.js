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

// Admins may enter JSON-LD as a raw string: plain JSON, JSON with literal
// newlines (invalid until control chars are stripped), or a pasted
// <script type="application/ld+json"> block. structured_data must be stored as an
// object so the schema can coexist with internal config keys, so we parse the
// string into an object here. Returns null when nothing usable can be extracted.
function parseSchemaString(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  // 1. Direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed;
  } catch { /* fall through */ }

  // 2. Strip control characters (literal newlines inside string values)
  try {
    // eslint-disable-next-line no-control-regex
    const parsed = JSON.parse(raw.replace(/[\x00-\x1F\x7F]+/g, ' '));
    if (isPlainObject(parsed)) return parsed;
  } catch { /* fall through */ }

  // 3. Extract JSON from a pasted <script type="application/ld+json"> block
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = scriptRe.exec(raw);
  if (match) {
    const inner = match[1].trim();
    try {
      const parsed = JSON.parse(inner);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      try {
        // eslint-disable-next-line no-control-regex
        const parsed = JSON.parse(inner.replace(/[\x00-\x1F\x7F]+/g, ' '));
        if (isPlainObject(parsed)) return parsed;
      } catch { /* give up */ }
    }
  }

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
