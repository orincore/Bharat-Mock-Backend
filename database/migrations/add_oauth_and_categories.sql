-- Add OAuth and onboarding fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'email',
ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS is_onboarded BOOLEAN DEFAULT false;

-- Create user_interested_categories table
CREATE TABLE IF NOT EXISTS user_interested_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, category_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_interested_categories_user_id ON user_interested_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interested_categories_category_id ON user_interested_categories(category_id);

-- Add index on google_id for faster OAuth lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);
