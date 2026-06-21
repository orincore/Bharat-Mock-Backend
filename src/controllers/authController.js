const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/database');
const logger = require('../config/logger');
const { sendWelcomeEmail, sendPasswordOtpEmail, sendEmailVerificationOtpEmail, sendPasswordChangedEmail } = require('../utils/emailService');
const { redisCache, buildCacheKey } = require('../utils/redisCache');

// Per-user profile cache. Short TTL because it carries subscription state; we also
// bust it explicitly on profile update, account deletion, and logout so it never
// serves stale data. Keys mirror the init user cache so logout can clear both.
const PROFILE_CACHE_TTL = 60; // seconds
const profileCacheKey = (userId) => buildCacheKey('auth_profile', userId);
const initUserCacheKey = (userId) => buildCacheKey('init', 'user', userId);

// Drop every cached entry tied to a user (profile + app-init). Safe to call with a
// missing id (no-op) and never throws — cache busting must not break the request.
const bustUserCaches = async (userId) => {
  if (!userId) return;
  try {
    await Promise.all([
      redisCache.del(profileCacheKey(userId)),
      redisCache.del(initUserCacheKey(userId)),
    ]);
    console.log(`[Cache] BUST auth_profile + init:user for ${userId}`);
  } catch (err) {
    logger.warn('Failed to bust user caches:', err?.message || err);
  }
};

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

// `tv` (token version) is embedded in every token. The auth middleware rejects a
// token whose tv no longer matches the user's current token_version, so bumping that
// column invalidates outstanding sessions.
const generateToken = (userId, role, tokenVersion = 0) => {
  return jwt.sign({ userId, role: role || 'user', tv: tokenVersion ?? 0 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

const generateRefreshToken = (userId, tokenVersion = 0) => {
  return jwt.sign({ userId, tv: tokenVersion ?? 0 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  });
};

// A SEPARATE secret for the pre-registration onboarding token. Signing it with a
// different key than JWT_SECRET guarantees it can never be accepted as a session token
// by the auth middleware (which verifies with JWT_SECRET) — so this token grants no
// access to anything except completing registration.
const GOOGLE_ONBOARDING_SECRET =
  process.env.GOOGLE_ONBOARDING_SECRET || `${process.env.JWT_SECRET}::google-onboarding`;
const GOOGLE_ONBOARDING_EXPIRES_IN = process.env.GOOGLE_ONBOARDING_EXPIRES_IN || '30m';

// Short-lived token that carries a verified Google identity through the onboarding form
// BEFORE any user row exists. Created in googleCallback, consumed by completeGoogleRegistration.
const generateOnboardingToken = (profile) =>
  jwt.sign(
    {
      purpose: 'google_onboarding',
      email: profile.email,
      name: profile.name,
      avatar_url: profile.avatar_url || null,
      google_id: profile.google_id
    },
    GOOGLE_ONBOARDING_SECRET,
    { expiresIn: GOOGLE_ONBOARDING_EXPIRES_IN }
  );

const verifyOnboardingToken = (token) => {
  const decoded = jwt.verify(token, GOOGLE_ONBOARDING_SECRET);
  if (decoded.purpose !== 'google_onboarding') {
    throw new Error('Invalid onboarding token purpose');
  }
  return decoded;
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
      .select('id, email, password_hash, name, avatar_url, phone, role, is_blocked, block_reason, deleted_at, created_at, token_version')
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

    const token = generateToken(user.id, user.role, user.token_version);
    const refreshToken = generateRefreshToken(user.id, user.token_version);

    // eslint-disable-next-line no-unused-vars
    const { password_hash, token_version, ...userWithoutPassword } = user;

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
    const cacheKey = profileCacheKey(req.user.id);
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      console.log(`[Cache] HIT  ${cacheKey}`);
      return res.json(cached);
    }
    console.log(`[Cache] MISS ${cacheKey} — fetching from DB`);

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        name,
        phone,
        avatar_url,
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

    const payload = {
      success: true,
      data: {
        ...user,
        subscription_plan: subscriptionPlan
      }
    };

    // Cache the successful profile so repeated/burst loads are served from Redis.
    await redisCache.set(profileCacheKey(req.user.id), payload, PROFILE_CACHE_TTL);

    res.json(payload);
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
    const { name, phone, education, preferences, bio } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
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

    // Profile changed — drop cached copies so the next load reflects the update.
    await bustUserCaches(req.user.id);

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
      .select('password_hash, email, name, token_version')
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

    // Bump token_version to revoke EVERY existing session for this account. After a
    // password reset the legitimate owner must sign in again with the new password,
    // and anyone who had hijacked a session is logged out immediately.
    await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        token_version: (user.token_version ?? 0) + 1
      })
      .eq('id', resetToken.user_id);

    // Drop the cached profile/init so no revoked session is served stale data.
    await bustUserCaches(resetToken.user_id);

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

// Mask an email for safe display in the UI: jo****@gmail.com
const maskEmail = (email = '') => {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
};

// Step 1 of the authenticated change-password flow: email a 6-digit OTP to the
// logged-in user's registered address. Reuses the password_reset_tokens store.
const sendChangePasswordOtp = async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', req.user.id)
      .is('deleted_at', null)
      .single();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const otp = generateNumericOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate any previous unused codes for this user.
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
      logger.error('Failed to send change-password OTP email:', emailError);
      return res.status(500).json({ success: false, message: 'Failed to send verification code' });
    }

    res.json({
      success: true,
      message: 'A verification code has been sent to your email',
      email: maskEmail(user.email)
    });
  } catch (error) {
    logger.error('Send change-password OTP error:', error);
    res.status(500).json({ success: false, message: 'Failed to send verification code' });
  }
};

// Step 2: verify the OTP and set the new password.
const changePassword = async (req, res) => {
  try {
    const { otp, newPassword } = req.body;

    const { data: resetToken } = await supabase
      .from('password_reset_tokens')
      .select('id, expires_at, is_used')
      .eq('user_id', req.user.id)
      .eq('token', otp)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!resetToken || resetToken.is_used) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    if (new Date(resetToken.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new one.'
      });
    }

    const { data: user } = await supabase
      .from('users')
      .select('password_hash, email, name, role, token_version')
      .eq('id', req.user.id)
      .single();

    if (user.password_hash) {
      const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
      if (isSamePassword) {
        return res.status(400).json({
          success: false,
          message: 'New password must be different from the current password'
        });
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const nextTokenVersion = (user.token_version ?? 0) + 1;

    // Bump token_version: this revokes ALL sessions (every outstanding token carries the
    // old tv). We then immediately mint fresh tokens for THIS session below, so the user
    // who initiated the change stays logged in while every other device — including a
    // hijacker's — is signed out.
    await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        token_version: nextTokenVersion
      })
      .eq('id', req.user.id);

    await bustUserCaches(req.user.id);

    await supabase
      .from('password_reset_tokens')
      .update({ is_used: true })
      .eq('id', resetToken.id);

    try {
      await sendPasswordChangedEmail(user.email, user.name);
    } catch (emailError) {
      logger.error('Failed to send password changed email:', emailError);
    }

    // Fresh tokens for the current session, stamped with the new tv so they survive the
    // revocation. The client must replace its stored tokens with these.
    const newToken = generateToken(req.user.id, user.role, nextTokenVersion);
    const newRefreshToken = generateRefreshToken(req.user.id, nextTokenVersion);

    res.json({
      success: true,
      message: 'Password changed successfully',
      data: { token: newToken, refreshToken: newRefreshToken }
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

    // Brand-new Google signup — no DB row exists yet. Hand the user a short-lived
    // ONBOARDING token (not a login token) and send them to the onboarding form. The
    // account is created only when they submit complete details, so an incomplete
    // profile can never exist or log in.
    if (user.isPendingRegistration) {
      const onboardingToken = generateOnboardingToken(user);
      return res.redirect(
        `${process.env.FRONTEND_URL}/onboarding?pending=${encodeURIComponent(onboardingToken)}`
      );
    }

    const token = generateToken(user.id, user.role, user.token_version);
    const refreshToken = generateRefreshToken(user.id, user.token_version);

    const redirectUrl = user.is_onboarded
      ? `${process.env.FRONTEND_URL}/auth/callback?token=${token}&refresh=${refreshToken}`
      : `${process.env.FRONTEND_URL}/onboarding?token=${token}&refresh=${refreshToken}`;

    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Google callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
};

// Creates the Google user's account ONLY after the onboarding form is submitted with
// complete details. Consumes the short-lived onboarding token from googleCallback.
const completeGoogleRegistration = async (req, res) => {
  try {
    const { pendingToken, phone, password } = req.body;

    if (!pendingToken) {
      return res.status(400).json({
        success: false,
        message: 'Missing onboarding session. Please sign in with Google again.'
      });
    }

    let pending;
    try {
      pending = verifyOnboardingToken(pendingToken);
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: 'ONBOARDING_TOKEN_INVALID',
        message: 'Your onboarding session has expired. Please sign in with Google again.'
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required.'
      });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Please set a password of at least 8 characters.'
      });
    }

    // Guard against a duplicate (completed in another tab, or an email account already
    // uses this address). Never create a second row for the same email.
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', pending.email)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'ACCOUNT_EXISTS',
        message: 'An account with this email already exists. Please sign in instead.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: pending.email,
        name: pending.name,
        avatar_url: pending.avatar_url || null,
        password_hash: passwordHash,
        phone,
        role: 'user',
        is_verified: true,
        is_onboarded: true,
        auth_provider: 'google',
        google_id: pending.google_id
      })
      .select('id, email, name, phone, avatar_url, role, is_verified, is_onboarded, created_at')
      .single();

    if (createError || !newUser) {
      logger.error('Google registration create error:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create your account. Please try again.'
      });
    }

    // Default preferences (mirror email registration).
    await supabase.from('user_preferences').insert({
      user_id: newUser.id,
      notifications: true,
      newsletter: true,
      exam_reminders: true
    });

    try {
      await sendWelcomeEmail(newUser.email, newUser.name);
    } catch (emailError) {
      logger.error('Failed to send welcome email:', emailError);
    }

    const token = generateToken(newUser.id, newUser.role);
    const refreshToken = generateRefreshToken(newUser.id);

    res.status(201).json({
      success: true,
      message: 'Registration completed successfully',
      data: { user: newUser, token, refreshToken }
    });
  } catch (error) {
    logger.error('Complete Google registration error:', error);
    res.status(500).json({ success: false, message: 'Failed to complete registration' });
  }
};

const completeOnboarding = async (req, res) => {
  try {
    const { phone, password } = req.body;
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

    // The profile is cached (getProfile). Without busting it, a follow-up getProfile
    // would keep returning is_onboarded=false and bounce the user back to onboarding.
    await bustUserCaches(userId);

    const { data: updatedUser } = await supabase
      .from('users')
      .select(`
        id,
        email,
        name,
        phone,
        avatar_url,
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
      .select('id, role, is_blocked, block_reason, token_version')
      .eq('id', userId)
      .maybeSingle();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // A refresh token minted before a password reset/change is no longer valid — its
    // tv lags behind the user's current token_version. Block it so a stolen refresh
    // token can't mint fresh access tokens.
    if ((decoded.tv ?? 0) !== (user.token_version ?? 0)) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REVOKED',
        message: 'Your session has expired. Please sign in again.'
      });
    }

    if (user.is_blocked) {
      return res.status(403).json({
        success: false,
        message: user.block_reason || 'Your account has been blocked'
      });
    }

    const newAccessToken = generateToken(userId, user.role, user.token_version);
    const newRefreshToken = generateRefreshToken(userId, user.token_version);

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

    // Ensure a deleted account never serves a cached profile/init.
    await bustUserCaches(userId);

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting account' });
  }
};

// Logout — JWTs are stateless, so there is nothing to revoke server-side. We use this
// hook to bust the user's cached profile + app-init so a fresh login (or the next
// account on this device) never sees the previous session's cached data, and so the
// DB isn't hit again on the next profile load until Redis is repopulated.
const logout = async (req, res) => {
  try {
    await bustUserCaches(req.user?.id);
    res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    logger.error('Logout error:', error);
    // Logout should never fail the client — report success regardless.
    res.json({ success: true, message: 'Logged out' });
  }
};

module.exports = {
  register,
  sendRegistrationOtp,
  verifyRegistrationOtp,
  login,
  getProfile,
  updateProfile,
  logout,
  getPublicProfile,
  forgotPassword,
  resetPassword,
  sendChangePasswordOtp,
  changePassword,
  googleCallback,
  completeOnboarding,
  completeGoogleRegistration,
  refreshAuthToken,
  deleteAccount
};
