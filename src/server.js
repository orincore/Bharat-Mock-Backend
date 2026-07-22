require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisCache } = require('./utils/redisCache');
const passport = require('./config/passport');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const examRoutes = require('./routes/examRoutes');
const resultRoutes = require('./routes/resultRoutes');
const collegeRoutes = require('./routes/collegeRoutes');
const courseRoutes = require('./routes/courseRoutes');
const articleRoutes = require('./routes/articleRoutes');
const blogRoutes = require('./routes/blog');
const taxonomyRoutes = require('./routes/taxonomyRoutes');
const subcategoryContentRoutes = require('./routes/subcategoryContentRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const subscriptionPageRoutes = require('./routes/subscriptionPageRoutes');
const pageContentRoutes = require('./routes/pageContent');
const categoryPageContentRoutes = require('./routes/categoryPageContent');
const testSeriesPageContentRoutes = require('./routes/testSeriesPageContent');
const adminRoutes = require('./routes/adminRoutes');
const { startSubscriptionJobs } = require('./jobs/subscriptionJobs');
const homepageRoutes = require('./routes/homepageRoutes');
const navigationRoutes = require('./routes/navigationRoutes');
const footerRoutes = require('./routes/footerRoutes');
const contactRoutes = require('./routes/contactRoutes');
const aboutRoutes = require('./routes/aboutRoutes');
const privacyRoutes = require('./routes/privacyRoutes');
const disclaimerRoutes = require('./routes/disclaimerRoutes');
const refundRoutes = require('./routes/refundRoutes');
const initRoutes = require('./routes/initRoutes');
const pagePopularTestsRoutes = require('./routes/pagePopularTests');
const pageBannersRoutes = require('./routes/pageBannersRoutes');
const testimonialsRoutes = require('./routes/testimonialsRoutes');
const testSeriesRoutes = require('./routes/testSeriesRoutes');
const paperSectionsRoutes = require('./routes/paperSectionsRoutes');
const currentAffairsRoutes = require('./routes/currentAffairsRoutes');
const activityLogRoutes = require('./routes/activityLogRoutes');
const sitemapRoutes = require('./routes/sitemapRoutes');
const examTranslationsRoutes = require('./routes/examTranslationsRoutes');
const { Prisma } = require('./generated/prisma');

const app = express();

// Trust the first 2 hops — Cloudflare's edge, then Traefik (k3s ingress) —
// so rate limiting & logging resolve req.ip to the real visitor, not one of
// the proxies. With this at 1 (its old single-nginx-hop value), every
// visitor's rate-limit bucket collapsed onto Cloudflare's edge IP, exhausting
// the global window almost immediately regardless of who was actually asking.
app.set('trust proxy', 2);

// Prisma Decimal fields (score, marks, percentage, accuracy, etc.) serialize to
// strings by default, which silently breaks any frontend code expecting a number
// (e.g. .toFixed()). JSON.stringify calls value.toJSON() BEFORE any replacer function
// ever sees it, so a `json replacer` can't intercept Decimals — decimal.js's own
// toJSON (== toString) always wins first. Overriding toJSON directly is the only hook
// that actually runs for every res.json() call, at any nesting depth.
Prisma.Decimal.prototype.toJSON = function decimalToJSONNumber() {
  return this.toNumber();
};

app.use(helmet());

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://bharatmock.com',
  'https://www.bharatmock.com',
  'https://app.bharatmock.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : defaultAllowedOrigins;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
}));

app.use(compression());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(passport.initialize());

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

const API_VERSION = process.env.API_VERSION || 'v1';

// Rate limiters use a SHARED Redis store (rate-limit-redis) so a limit is
// enforced across ALL backend pods, not per-pod. With the default in-memory
// store each HPA replica kept its own counter, so an IP effectively got
// (replicas x max) requests and the RateLimit-Remaining header jumped around
// depending on which pod answered a given request. The store reuses the app's
// existing ioredis client (src/utils/redisCache). If Redis is unavailable the
// limiter falls back to its in-memory store, and passOnStoreError lets a
// transient Redis failure fail-open (skip limiting) rather than 500 the API.
//
// Key = the true visitor IP. Behind Cloudflare, CF-Connecting-IP is the
// authoritative client IP and is immune to how many proxy hops sit in front
// (unlike req.ip, which depends on the exact `trust proxy` hop count). Falls
// back to req.ip for direct / local access.
// Requests our own Next.js frontend makes to the API on behalf of visitors —
// the /api/session -> /auth/profile session check plus every server-side
// (SSR/ISR) page-data fetch — all originate from ONE machine (the frontend
// pod). Cloudflare stamps cf-connecting-ip at the API edge with that pod's IP,
// and req.ip is the same, so without special handling every visitor collapses
// into a single rate-limit bucket that trips in seconds: /api/session returns
// 429 for everyone and SSR fetches 429 -> notFound() -> 404 across the site.
//
// The frontend attaches INTERNAL_PROXY_SECRET on these server-to-server calls
// (see frontend src/lib/server/internalApiHeaders.ts). When present and valid we
// (a) never count the request against IP limits [skip, below] because it acts
// for the whole user base rather than one abuser, and (b) if it forwards the
// visitor's real IP, bucket by that instead of the collapsed frontend IP. End
// users hitting the API directly from the browser are unaffected — those carry
// their own cf-connecting-ip and remain rate limited normally.
const INTERNAL_PROXY_SECRET = process.env.INTERNAL_PROXY_SECRET || '';
const isTrustedInternalProxy = (req) =>
  !!INTERNAL_PROXY_SECRET &&
  req.headers['x-internal-proxy-secret'] === INTERNAL_PROXY_SECRET;

const rateLimitKey = (req) => {
  if (isTrustedInternalProxy(req) && req.headers['x-real-client-ip']) {
    return String(req.headers['x-real-client-ip']);
  }
  return req.headers['cf-connecting-ip'] || req.ip;
};

// Global-limiter key that survives Indian mobile scale. Most of our users are on
// Jio/Airtel/Vi, whose CGNAT puts thousands of subscribers behind ONE public IP.
// A purely per-IP content limit would therefore 429 huge blocks of legitimate,
// logged-in users at 50k+ concurrency. So for the coarse /api/ limiter we bucket
// an authenticated visitor by their own session token instead of their shared
// IP: each real user gets an independent window regardless of CGNAT. The token
// is only HASHED here (never verified/decoded) — cheap, runs before auth
// middleware, and can't throw. Anonymous requests fall back to CF-Connecting-IP;
// those are overwhelmingly cacheable GETs served from the Cloudflare edge, so
// they rarely reach this limiter at all. Brute-force protection on credential
// endpoints stays strictly per-IP (authLimiter) — that MUST stay IP-keyed.
const sessionOrIpKey = (req) => {
  if (isTrustedInternalProxy(req) && req.headers['x-real-client-ip']) {
    return String(req.headers['x-real-client-ip']);
  }
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const cookieMatch = /(?:^|;\s*)bm_session=([^;]+)/.exec(req.headers['cookie'] || '');
  const token = bearer || (cookieMatch ? cookieMatch[1] : '');
  if (token) {
    return 'sess:' + crypto.createHash('sha256').update(token).digest('hex');
  }
  return req.headers['cf-connecting-ip'] || req.ip;
};

const makeLimiter = ({ windowMs, max, message, prefix, keyGenerator }) => {
  const options = {
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    keyGenerator: keyGenerator || rateLimitKey,
    // Never rate-limit our own frontend's server-to-server calls: one frontend
    // pod fans out requests for the entire user base, so counting them as a
    // single IP is what took the site down (429 storm -> 404s). Guarded by a
    // shared secret so end users cannot spoof the exemption.
    skip: isTrustedInternalProxy,
    passOnStoreError: true,
  };
  if (redisCache.client) {
    const store = new RedisStore({
      prefix,
      sendCommand: (...args) => redisCache.client.call(...args),
    });
    // rate-limit-redis fires SCRIPT LOAD from its constructor and stores the
    // (un-awaited) promises on the instance. If Redis is unreachable at boot
    // those reject with no handler — attach no-op catches so a Redis outage
    // during a deploy fails open (passOnStoreError) rather than surfacing as
    // noisy "Unhandled Rejection" logs. The store reloads the scripts itself
    // on the next request once Redis is reachable again.
    Promise.resolve(store.incrementScriptSha).catch(() => {});
    Promise.resolve(store.getScriptSha).catch(() => {});
    options.store = store;
  } else {
    logger.warn('Rate limiter: Redis client unavailable — using per-pod in-memory store');
  }
  return rateLimit(options);
};

const globalLimiter = makeLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
  prefix: 'rl:global:',
  keyGenerator: sessionOrIpKey, // per-session for logged-in users (CGNAT-safe)
});

const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many auth attempts, please try again after 15 minutes.' },
  prefix: 'rl:auth:',
});

if (process.env.NODE_ENV === 'production') {
  app.use('/api/', globalLimiter);
}

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

if (process.env.NODE_ENV === 'production') {
  // Brute-force protection (30 req / 15 min) belongs ONLY on credential
  // endpoints. It must NOT cover GET /profile — the session check the frontend
  // runs on every page load via /api/session — nor /refresh or /logout. Mounting
  // it on the whole /auth prefix is what turned a normal browsing session into a
  // 429 storm and took the site down. Mount it per-endpoint instead.
  const authPrefix = `/api/${API_VERSION}/auth`;
  const bruteForceEndpoints = [
    '/login',
    '/register',
    '/send-registration-otp',
    '/verify-registration-otp',
    '/forgot-password',
    '/reset-password',
    '/change-password', // also covers /change-password/send-otp (prefix match)
    '/google/complete-registration',
  ];
  for (const endpoint of bruteForceEndpoints) {
    app.use(`${authPrefix}${endpoint}`, authLimiter);
  }
}
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/exams`, examRoutes);
app.use(`/api/${API_VERSION}/results`, resultRoutes);
app.use(`/api/${API_VERSION}/colleges`, collegeRoutes);
app.use(`/api/${API_VERSION}/courses`, courseRoutes);
app.use(`/api/${API_VERSION}/articles`, articleRoutes);
app.use(`/api/${API_VERSION}/blogs`, blogRoutes);
app.use(`/api/${API_VERSION}/taxonomy`, taxonomyRoutes);
app.use(`/api/${API_VERSION}/subcategories`, subcategoryContentRoutes);
app.use(`/api/${API_VERSION}/page-content`, pageContentRoutes);
app.use(`/api/${API_VERSION}/category-page-content`, categoryPageContentRoutes);
app.use(`/api/${API_VERSION}/test-series-page-content`, testSeriesPageContentRoutes);
app.use(`/api/${API_VERSION}/homepage`, homepageRoutes);
app.use(`/api/${API_VERSION}/navigation`, navigationRoutes);
app.use(`/api/${API_VERSION}/footer`, footerRoutes);
app.use(`/api/${API_VERSION}/contact`, contactRoutes);
app.use(`/api/${API_VERSION}/about`, aboutRoutes);
app.use(`/api/${API_VERSION}/privacy`, privacyRoutes);
app.use(`/api/${API_VERSION}/disclaimer`, disclaimerRoutes);
app.use(`/api/${API_VERSION}/refund-policy`, refundRoutes);
// After any successful admin CONTENT mutation, purge the Cloudflare edge cache
// so the edit shows immediately instead of waiting for the edge TTL. No-op
// until CF_ZONE_ID / CF_PURGE_API_TOKEN are configured. Skip reads-via-POST
// (PDF export) and pure media uploads, which don't change rendered page HTML.
const { schedulePurgeEverything } = require('./utils/cloudflarePurge');
app.use(`/api/${API_VERSION}/admin`, (req, res, next) => {
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const skip = req.path.includes('/pdf') || req.path.includes('/upload');
  if (isMutation && !skip) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) schedulePurgeEverything();
    });
  }
  next();
});
app.use(`/api/${API_VERSION}/admin`, adminRoutes);
app.use(`/api/${API_VERSION}/subscriptions`, subscriptionRoutes);
app.use(`/api/${API_VERSION}/subscription-page`, subscriptionPageRoutes);
app.use(`/api/${API_VERSION}/page-popular-tests`, pagePopularTestsRoutes);
app.use(`/api/${API_VERSION}/page-banners`, pageBannersRoutes);
app.use(`/api/${API_VERSION}/testimonials`, testimonialsRoutes);
app.use(`/api/${API_VERSION}/test-series`, testSeriesRoutes);
app.use(`/api/${API_VERSION}/paper-sections`, paperSectionsRoutes);
app.use(`/api/${API_VERSION}/current-affairs`, currentAffairsRoutes);
app.use(`/api/${API_VERSION}/init`, initRoutes);
app.use(`/api/${API_VERSION}/activity`, activityLogRoutes);
app.use(`/api/${API_VERSION}/sitemap`, sitemapRoutes);
app.use(`/api/${API_VERSION}/exam-translations`, examTranslationsRoutes);

let server;

const startServer = async () => {
  try {
    app.use(notFound);
    app.use(errorHandler);

    const PORT = process.env.PORT || 5000;

    server = app.listen(PORT, () => {
      logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`API: http://localhost:${PORT}/api/${API_VERSION}`);
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.timeout = 120000;
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

startServer();
startSubscriptionJobs();

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception (keeping process alive):', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection (keeping process alive):', { reason: reason?.message || reason, stack: reason?.stack });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (server) {
    server.close(() => {
      logger.info('Process terminated');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000);
  }
});

module.exports = app;
