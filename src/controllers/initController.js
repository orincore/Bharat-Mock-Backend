const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { redisCache, buildCacheKey } = require('../utils/redisCache');

const INIT_PUBLIC_TTL = 1800; // 30 min — public (no user), invalidated via nav/taxonomy writes
const INIT_USER_TTL  = 60;   // 1 min  — per-user (includes profile/subscription)
const INIT_PUBLIC_KEY = buildCacheKey('init', 'public');
const initUserKey = (userId) => buildCacheKey('init', 'user', userId);

const normalizePlanRecord = (planData) => {
  if (!planData) return null;
  const normalPrice = Number(planData.normal_price_cents ?? planData.price_cents ?? 0);
  const saleField = planData.sale_price_cents;
  const salePrice = saleField === null || saleField === undefined ? null : Number(saleField);
  return {
    ...planData,
    normal_price_cents: normalPrice,
    sale_price_cents: salePrice,
    price_cents: salePrice !== null ? salePrice : normalPrice,
    duration_days: Number(planData.duration_days)
  };
};

const getAppInit = async (req, res) => {
  try {
    const isAuthenticated = Boolean(req.user?.id);
    const cacheKey = isAuthenticated ? initUserKey(req.user.id) : INIT_PUBLIC_KEY;

    const cached = await redisCache.get(cacheKey);
    if (cached) {
      console.log(`[Cache] HIT  ${cacheKey}`);
      return res.json(cached);
    }
    console.log(`[Cache] MISS ${cacheKey} — fetching from DB`);

    const promises = [
      prisma.navigation_links.findMany({
        where: { deleted_at: null, is_active: true },
        select: { id: true, label: true, href: true, display_order: true, is_active: true, open_in_new_tab: true, created_at: true, updated_at: true },
        orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
      }),

      prisma.footer_links.findMany({
        where: { deleted_at: null, is_active: true },
        select: { id: true, section: true, section_order: true, label: true, href: true, display_order: true, is_active: true, open_in_new_tab: true, created_at: true, updated_at: true },
        orderBy: [{ section_order: 'asc' }, { section: 'asc' }, { display_order: 'asc' }, { created_at: 'asc' }],
      }),

      prisma.contact_info.findFirst({
        select: {
          id: true, headline: true, subheading: true, description: true, support_email: true, support_phone: true, whatsapp_number: true,
          address_line1: true, address_line2: true, city: true, state: true, postal_code: true, country: true, support_hours: true, map_embed_url: true,
          contact_social_links: { select: { id: true, platform: true, label: true, url: true, icon: true, display_order: true, is_active: true } },
        },
        orderBy: { created_at: 'asc' },
      }),

      prisma.exam_categories.findMany({
        where: { OR: [{ is_active: true }, { is_active: null }] },
        select: { id: true, name: true, slug: true, icon: true, logo_url: true, display_order: true },
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
      }),

      prisma.exam_subcategories.findMany({
        where: { OR: [{ is_active: true }, { is_active: null }] },
        select: { id: true, name: true, slug: true, category_id: true, logo_url: true, display_order: true },
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
      }),
    ];

    if (isAuthenticated) {
      promises.push(
        prisma.users.findUnique({
          where: { id: req.user.id },
          select: {
            id: true, email: true, name: true, phone: true, avatar_url: true, role: true, bio: true,
            is_verified: true, is_premium: true, auth_provider: true, is_onboarded: true,
            subscription_plan_id: true, subscription_expires_at: true, subscription_auto_renew: true,
            created_at: true,
            user_education: { select: { level: true, institution: true, year: true, percentage: true } },
            user_preferences: { select: { notifications: true, newsletter: true, exam_reminders: true } },
          },
        })
      );
    }

    const results = await Promise.allSettled(promises);

    const navResult = results[0];
    const footerResult = results[1];
    const contactResult = results[2];
    const categoriesResult = results[3];
    const subcategoriesResult = results[4];
    const profileResult = isAuthenticated ? results[5] : null;

    const navigation = navResult.status === 'fulfilled'
      ? navResult.value || []
      : [];

    const footer = footerResult.status === 'fulfilled'
      ? footerResult.value || []
      : [];

    const contact = contactResult.status === 'fulfilled'
      ? contactResult.value || null
      : null;

    const categories = categoriesResult.status === 'fulfilled'
      ? categoriesResult.value || []
      : [];

    const subcategories = subcategoriesResult.status === 'fulfilled'
      ? subcategoriesResult.value || []
      : [];

    let profile = null;
    if (isAuthenticated && profileResult?.status === 'fulfilled') {
      const user = profileResult.value;
      if (user?.subscription_plan_id) {
        const planData = await prisma.subscription_plans.findUnique({
          where: { id: user.subscription_plan_id },
          select: { id: true, name: true, description: true, duration_days: true, normal_price_cents: true, sale_price_cents: true, currency_code: true },
        });

        if (planData) {
          user.subscription_plan = normalizePlanRecord(planData);
        }
      }
      profile = user;
    }

    const response = {
      success: true,
      data: {
        navigation,
        footer,
        contact,
        categories,
        subcategories,
        profile,
      },
    };

    const ttl = isAuthenticated ? INIT_USER_TTL : INIT_PUBLIC_TTL;
    await redisCache.set(cacheKey, response, ttl);
    console.log(`[Cache] SET  ${cacheKey} (TTL ${ttl}s)`);

    return res.json(response);
  } catch (error) {
    logger.error('App init error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load app data',
    });
  }
};

module.exports = { getAppInit };
