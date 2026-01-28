const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const supabase = require('./database');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL
} = process.env;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails[0].value;
          const name = profile.displayName;
          const avatar_url = profile.photos[0]?.value;

          const { data: existingUser, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

          if (existingUser && !fetchError) {
            const updatePayload = {
              auth_provider: 'google',
              google_id: profile.id
            };

            if (avatar_url) {
              updatePayload.avatar_url = avatar_url;
            }

            const { data: refreshedUser, error: updateError } = await supabase
              .from('users')
              .update(updatePayload)
              .eq('id', existingUser.id)
              .select()
              .single();

            if (updateError || !refreshedUser) {
              return done(null, existingUser);
            }

            return done(null, refreshedUser);
          }

          const hashedPlaceholder = await bcrypt.hash(profile.id + Date.now().toString(), 10);

          const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
              email,
              name,
              avatar_url,
              password_hash: hashedPlaceholder,
              role: 'user',
              is_onboarded: false,
              auth_provider: 'google',
              google_id: profile.id
            })
            .select()
            .single();

          if (createError) {
            return done(createError, null);
          }

          return done(null, newUser);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
} else {
  console.warn(
    '⚠️  Google OAuth env vars missing. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL to enable OAuth.'
  );
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return done(error, null);
    }

    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
