const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const prisma = require('./prisma');

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

          const existingUser = await prisma.users.findUnique({ where: { email } });

          if (existingUser) {
            const updatePayload = {
              auth_provider: 'google',
              google_id: profile.id,
              is_verified: true
            };

            if (avatar_url) {
              updatePayload.avatar_url = avatar_url;
            }

            try {
              const refreshedUser = await prisma.users.update({
                where: { id: existingUser.id },
                data: updatePayload,
              });
              return done(null, refreshedUser);
            } catch (updateError) {
              return done(null, existingUser);
            }
          }

          // Brand-new Google user: do NOT create a profile yet. Account creation is
          // deferred until the onboarding form is submitted with complete details, so an
          // incomplete profile never exists in the database (incomplete info = no profile
          // = no login). Carry the verified Google identity forward as a transient
          // "pending registration"; googleCallback turns it into a short-lived onboarding
          // token, and completeGoogleRegistration creates the row once details are filled.
          return done(null, {
            isPendingRegistration: true,
            email,
            name,
            avatar_url: avatar_url || null,
            google_id: profile.id
          });
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
    const user = await prisma.users.findUnique({ where: { id } });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
