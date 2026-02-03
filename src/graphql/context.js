const jwt = require('jsonwebtoken');
const supabase = require('../config/database');
const logger = require('../config/logger');

const buildContext = async (req) => {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name, avatar_url, is_blocked')
      .eq('id', decoded.userId)
      .is('deleted_at', null)
      .single();

    if (userError || !user || user.is_blocked) {
      throw new Error('Unauthorized');
    }

    const { data: adminUser, error: adminError } = await supabase
      .from('admin_users')
      .select(`
        id,
        is_active,
        admin_roles (
          id,
          name,
          description
        )
      `)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (adminError || !adminUser || !adminUser.admin_roles) {
      throw new Error('Admin access required');
    }

    return {
      user,
      adminUser,
      adminRole: adminUser.admin_roles.name
    };
  } catch (error) {
    logger.error('GraphQL auth error:', error);
    throw new Error('Unauthorized');
  }
};

module.exports = {
  buildContext
};
