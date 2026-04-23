const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/database');
const logger = require('../config/logger');
const { sendWelcomeEmail, sendPasswordOtpEmail, sendEmailVerificationOtpEmail, sendPasswordChangedEmail } = require('../utils/emailService');

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

const generateToken = (userId, role) => {
  return jwt.sign({ userId, role: role || 'user' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  });
};

const register = async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .is('deleted_at', null)
      .single();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        email,
        password_hash: hashedPassword,
        name,
        phone: phone || null,
        is_verified: false,
        role: 'user'
      })
      .select('id, email, name, phone, avatar_url, role, created_at')
      .single();

    if (error) {
      logger.error('Registration error:', error);
      return res.status(500).json({
        success: false,
        message: 'Registration failed'
      });
    }

    await supabase.from('user_preferences').insert({
      user_id: user.id,
      notifications: true,
      newsletter: true,
      exam_reminders: true
    });

    const token = generateToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user,
        token,
        refreshToken
      }
    });
  } catch (error) {
    logger.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

const sendRegistrationOtp = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) {
      return res.status(400).json({ success: false, message: 'Email and name are required' });
    }

    // Check if already registered
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .is('deleted_at', null)
      .single();

    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const otp = generateNumericOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any previous OTPs for this email stored in a temp table
    await supabase
      .from('email_verification_otps')
      .update({ is_used: true })
      .eq('email', email)
      .eq('is_used', false);

    await supabase
      .from('email_verification_otps')
      .insert({ email, otp, expires_at: expiresAt.toISOString(), is_used: false });

    try {
      await sendEmailVerificationOtpEmail(email, name, otp);
    } catch (emailError) {
      logger.error('Failed to send registration OTP email:', emailError);
    }

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    logger.error('Send registration OTP error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

const verifyRegistrationOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const { data: record, error } = await supabase
      .from('email_verification_otps')
      .select('id, otp, expires_at, is_used')
      .eq('email', email)
      .eq('is_used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !record) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    if (record.otp !== otp.toString()) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP' });
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    // Mark OTP as used
    await supabase
      .from('email_verification_otps')
      .update({ is_used: true })
      .eq('id', record.id);

    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (error) {
    logger.error('Verify registration OTP error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify OTP' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, email, password_hash, name, avatar_url, phone, date_of_birth, role, is_blocked, block_reason, deleted_at, created_at')
      .eq('email', email)
      .single();

    if (fetchError || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    if (user.deleted_at) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DELETED',
        message: 'This account has been deleted'
      });
    }

    if (user.is_blocked) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_BLOCKED',
        message: user.block_reason
          ? `Your account has been suspended: ${user.block_reason}`
          : 'Your account has been suspended',
        block_reason: user.block_reason || null
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = generateToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id);

    // eslint-disable-next-line no-unused-vars
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token,
        refreshToken
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        name,
        phone,
        avatar_url,
        date_of_birth,
        role,
        bio,
        is_verified,
        is_blocked,
        block_reason,
        is_premium,
        auth_provider,
        is_onboarded,
        subscription_plan_id,
        subscription_expires_at,
        subscription_auto_renew,
        created_at,
        deleted_at,
        user_education (
          level,
          institution,
          year,
          percentage
        ),
        user_preferences (
          notifications,
          newsletter,
          exam_reminders
        )
      `)
      .eq('id', req.user.id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user?.deleted_at) {
      return res.status(410).json({
        success: false,
        message: 'This account has been deleted'
      });
    }

    let subscriptionPlan = null;
    if (user?.subscription_plan_id) {
      const { data: planData } = await supabase
        .from('subscription_plans')
        .select('id, name, description, duration_days, normal_price_cents, sale_price_cents, currency_code')
        .eq('id', user.subscription_plan_id)
        .maybeSingle();

      if (planData) {
        subscriptionPlan = normalizePlanRecord(planData);
      }
    }

    res.json({
      success: true,
      data: {
        ...user,
        subscription_plan: subscriptionPlan
      }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, phone, date_of_birth, education, preferences, bio } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (date_of_birth) updateData.date_of_birth = date_of_birth;
    if (bio !== undefined) updateData.bio = bio;

    if (Object.keys(updateData).length > 0) {
      const { error: userError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', req.user.id);

      if (userError) {
        logger.error('Update user error:', userError);
        return res.status(500).json({
          success: false,
          message: 'Failed to update profile'
        });
      }
    }

    if (education) {
      const { data: existingEducation } = await supabase
        .from('user_education')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (existingEducation) {
        await supabase
          .from('user_education')
          .update(education)
          .eq('user_id', req.user.id);
      } else {
        await supabase
          .from('user_education')
          .insert({ ...education, user_id: req.user.id });
      }
    }

    if (preferences) {
      await supabase
        .from('user_preferences')
        .update(preferences)
        .eq('user_id', req.user.id);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

const generateNumericOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const { data: user } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email)
      .is('deleted_at', null)
      .single();

    if (!user) {
      return res.json({
        success: true,
        message: 'If the email exists, a reset code has been sent'
      });
    }

    const otp = generateNumericOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await supabase
      .from('password_reset_tokens')
      .update({ is_used: true })
      .eq('user_id', user.id)
      .eq('is_used', false);

    await supabase
      .from('password_reset_tokens')
      .insert({
        user_id: user.id,
        token: otp,
        expires_at: expiresAt.toISOString(),
        is_used: false
      });

    try {
      await sendPasswordOtpEmail(user.email, user.name, otp);
    } catch (emailError) {
      logger.error('Failed to send password OTP email:', emailError);
    }

    res.json({
      success: true,
      message: 'If the email exists, a reset code has been sent'
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const { data: resetToken, error: tokenError } = await supabase
      .from('password_reset_tokens')
      .select('user_id, expires_at, is_used')
      .eq('token', token)
      .single();

    if (tokenError || !resetToken || resetToken.is_used) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset code'
      });
    }

    if (new Date(resetToken.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Reset code has expired'
      });
    }

    const { data: user } = await supabase
      .from('users')
      .select('password_hash, email, name')
      .eq('id', resetToken.user_id)
      .single();

    const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from the current password'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await supabase
      .from('users')
      .update({ password_hash: hashedPassword })
      .eq('id', resetToken.user_id);

    await supabase
      .from('password_reset_tokens')
      .update({ is_used: true })
      .eq('token', token);

    try {
      await sendPasswordChangedEmail(user.email, user.name);
    } catch (emailError) {
      logger.error('Failed to send password changed email:', emailError);
    }

    res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.user.id)
      .single();

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from the current password'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await supabase
      .from('users')
      .update({ password_hash: hashedPassword })
      .eq('id', req.user.id);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

const googleCallback = async (req, res) => {
  try {
    const user = req.user;
    
    const token = generateToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id);

    const redirectUrl = user.is_onboarded 
      ? `${process.env.FRONTEND_URL}/auth/callback?token=${token}&refresh=${refreshToken}`
      : `${process.env.FRONTEND_URL}/onboarding?token=${token}&refresh=${refreshToken}`;

    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Google callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
};

const completeOnboarding = async (req, res) => {
  try {
    const { phone, date_of_birth, interested_categories, password } = req.body;
    const userId = req.user.id;
    const alreadyOnboarded = req.user.is_onboarded;
    const isGoogleUser = req.user.auth_provider === 'google';

    if (isGoogleUser && !password) {
      return res.status(400).json({
        success: false,
        message: 'Please set a password to finish onboarding'
      });
    }

    const updatePayload = {
      phone,
      date_of_birth,
      is_onboarded: true
    };

    if (password) {
      updatePayload.password_hash = await bcrypt.hash(password, 10);
    }

    const { error: updateError } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', userId);

    if (updateError) {
      logger.error('Onboarding update error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }

    const categoryInserts = interested_categories.map(categoryId => ({
      user_id: userId,
      category_id: categoryId
    }));

    const { error: categoryError } = await supabase
      .from('user_interested_categories')
      .insert(categoryInserts);

    if (categoryError) {
      logger.error('Category insert error:', categoryError);
    }

    const { data: updatedUser } = await supabase
      .from('users')
      .select(`
        id,
        email,
        name,
        phone,
        avatar_url,
        date_of_birth,
        role,
        is_verified,
        is_onboarded,
        created_at
      `)
      .eq('id', userId)
      .single();

    if (!alreadyOnboarded) {
      try {
        await sendWelcomeEmail(updatedUser.email, updatedUser.name);
      } catch (emailError) {
        logger.error('Failed to send welcome email:', emailError);
      }
    }

    res.json({
      success: true,
      message: 'Onboarding completed successfully',
      data: updatedUser
    });
  } catch (error) {
    logger.error('Complete onboarding error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete onboarding'
    });
  }
};

const refreshAuthToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (error) {
      const message = error.name === 'TokenExpiredError' ? 'Refresh token expired' : 'Invalid refresh token';
      return res.status(401).json({ success: false, message });
    }

    const userId = decoded.userId;
    const { data: user } = await supabase
      .from('users')
      .select('id, role, is_blocked, block_reason')
      .eq('id', userId)
      .maybeSingle();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.is_blocked) {
      return res.status(403).json({
        success: false,
        message: user.block_reason || 'Your account has been blocked'
      });
    }

    const newAccessToken = generateToken(userId, user.role);
    const newRefreshToken = generateRefreshToken(userId);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: newAccessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
};

const getPublicProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, avatar_url, bio, role, created_at')
      .eq('id', id)
      .single();

    if (error || !user) {
      return res.status(404).json({ success: false, message: 'Author not found' });
    }

    // Count published blogs by this author
    const { count } = await supabase
      .from('blogs')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', id)
      .eq('is_published', true);

    res.json({ success: true, data: { ...user, blog_count: count || 0 } });
  } catch (error) {
    logger.error('Get public profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch author profile' });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const { error } = await supabase
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', userId)
      .is('deleted_at', null);

    if (error) {
      logger.error('Delete account error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete account' });
    }

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting account' });
  }
};

module.exports = {
  register,
  sendRegistrationOtp,
  verifyRegistrationOtp,
  login,
  getProfile,
  updateProfile,
  getPublicProfile,
  forgotPassword,
  resetPassword,
  changePassword,
  googleCallback,
  completeOnboarding,
  refreshAuthToken,
  deleteAccount
};
