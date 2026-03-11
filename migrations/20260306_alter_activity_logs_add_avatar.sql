ALTER TABLE activity_logs
ADD COLUMN IF NOT EXISTS user_avatar_url TEXT;
