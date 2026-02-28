const supabase = require('../config/database');
const logger = require('../config/logger');
const { getCache, setCache } = require('../utils/cache');

const INIT_CACHE_TTL = 300;
const INIT_CACHE_KEY = 'app:init:public';

const getAppInit = async (req, res) => {
  try {
    const isAuthenticated = Boolean(req.user?.id);
    const cacheKey = isAuthenticated ? `app:init:user:${req.user.id}` : INIT_CACHE_KEY;

    const cached = getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const promises = [
      supabase
        .from('navigation_links')
        .select('id, label, href, display_order, is_active, open_in_new_tab, created_at, updated_at')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true }),

      supabase
        .from('footer_links')
        .select('id, section, section_order, label, href, display_order, is_active, open_in_new_tab, created_at, updated_at')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('section_order', { ascending: true })
        .order('section', { ascending: true })
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true }),

      supabase
        .from('contact_info')
        .select(`id, headline, subheading, description, support_email, support_phone, whatsapp_number,
          address_line1, address_line2, city, state, postal_code, country, support_hours, map_embed_url,
          contact_social_links(id, platform, label, url, icon, display_order, is_active)`)
        .order('created_at', { ascending: true })
        .limit(1)
        .single(),

      supabase
        .from('exam_categories')
        .select('id, name, slug, icon, logo_url, display_order')
        .or('is_active.eq.true,is_active.is.null')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true }),

      supabase
        .from('exam_subcategories')
        .select('id, name, slug, category_id, logo_url, display_order')
        .or('is_active.eq.true,is_active.is.null')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true }),
    ];

    if (isAuthenticated) {
      promises.push(
        supabase
          .from('users')
          .select(`
            id, email, name, phone, avatar_url, date_of_birth, role,
            is_verified, is_premium, auth_provider, is_onboarded,
            subscription_plan_id, subscription_expires_at, subscription_auto_renew,
            created_at,
            user_education (level, institution, year, percentage),
            user_preferences (notifications, newsletter, exam_reminders)
          `)
          .eq('id', req.user.id)
          .single()
      );
    }

    const results = await Promise.allSettled(promises);

    const navResult = results[0];
    const footerResult = results[1];
    const contactResult = results[2];
    const categoriesResult = results[3];
    const subcategoriesResult = results[4];
    const profileResult = isAuthenticated ? results[5] : null;

    const navigation = navResult.status === 'fulfilled' && !navResult.value.error
      ? navResult.value.data || []
      : [];

    const footer = footerResult.status === 'fulfilled' && !footerResult.value.error
      ? footerResult.value.data || []
      : [];

    const contact = contactResult.status === 'fulfilled' && !contactResult.value.error
      ? contactResult.value.data || null
      : null;

    const categories = categoriesResult.status === 'fulfilled' && !categoriesResult.value.error
      ? categoriesResult.value.data || []
      : [];

    const subcategories = subcategoriesResult.status === 'fulfilled' && !subcategoriesResult.value.error
      ? subcategoriesResult.value.data || []
      : [];

    let profile = null;
    if (isAuthenticated && profileResult?.status === 'fulfilled' && !profileResult.value.error) {
      const user = profileResult.value.data;
      if (user?.subscription_plan_id) {
        const { data: planData } = await supabase
          .from('subscription_plans')
          .select('id, name, description, duration_days, price_cents, currency_code')
          .eq('id', user.subscription_plan_id)
          .maybeSingle();

        if (planData) {
          user.subscription_plan = {
            ...planData,
            price_cents: Number(planData.price_cents),
            duration_days: Number(planData.duration_days),
          };
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

    const ttl = isAuthenticated ? 60 : INIT_CACHE_TTL;
    setCache(cacheKey, response, ttl);

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
