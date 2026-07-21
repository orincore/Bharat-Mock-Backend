// Cloudflare edge-cache purging.
//
// The public site sits behind a Cloudflare Cache Rule that edge-caches
// server-rendered HTML for anonymous visitors (see the frontend perf notes /
// INFRA doc). That makes pages fast but means an admin content edit wouldn't
// show until the edge TTL expires. This module purges the edge cache right
// after a successful admin mutation so edits appear immediately (the
// "on-demand revalidation" behaviour, done at the CDN instead of in Next.js).
//
// Fully OPTIONAL and no-op-safe: if CF_ZONE_ID / CF_PURGE_API_TOKEN are not set
// (e.g. before the Cloudflare API token is created), every call is a silent
// no-op — safe to ship ahead of the Cloudflare configuration.

const logger = require('../config/logger');

const CF_ZONE_ID = process.env.CF_ZONE_ID;
const CF_PURGE_API_TOKEN = process.env.CF_PURGE_API_TOKEN;
const ENABLED = Boolean(CF_ZONE_ID && CF_PURGE_API_TOKEN);

let warnedDisabled = false;
function ensureEnabled() {
  if (!ENABLED && !warnedDisabled) {
    warnedDisabled = true;
    logger.info('[cf-purge] CF_ZONE_ID / CF_PURGE_API_TOKEN not set — Cloudflare cache purging disabled (no-op)');
  }
  return ENABLED;
}

async function cfPurge(body) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CF_PURGE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        // Never let a slow/unreachable Cloudflare API stall anything.
        signal: AbortSignal.timeout(5000),
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      logger.warn('[cf-purge] purge request failed', { status: res.status, errors: json.errors });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('[cf-purge] purge request errored', { message: err.message });
    return false;
  }
}

// Debounced "purge everything": coalesce rapid admin edits (e.g. a bulk
// question upload firing dozens of mutations) into a single purge every
// DEBOUNCE_MS, so we don't burn Cloudflare's purge rate limit. Content edits
// are infrequent, so purge_everything is the simple, correct default; granular
// per-URL purging (purgeUrls below) is available for a future optimization but
// isn't required for correctness.
const DEBOUNCE_MS = 8000;
let pendingTimer = null;

function schedulePurgeEverything() {
  if (!ensureEnabled()) return;
  if (pendingTimer) return; // one already queued — this edit will be covered by it
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    const ok = await cfPurge({ purge_everything: true });
    if (ok) logger.info('[cf-purge] edge cache purged (purge_everything) after admin content change');
  }, DEBOUNCE_MS);
  // Don't keep the event loop alive just for a pending purge.
  if (pendingTimer.unref) pendingTimer.unref();
}

// Purge specific absolute URLs (up to 30 per Cloudflare call). Useful once
// mutation→URL mapping is wired per controller; unused by the default
// purge-everything path.
async function purgeUrls(urls) {
  if (!ensureEnabled() || !Array.isArray(urls) || urls.length === 0) return false;
  return cfPurge({ files: urls.slice(0, 30) });
}

module.exports = { schedulePurgeEverything, purgeUrls, CLOUDFLARE_PURGE_ENABLED: ENABLED };
