-- Migration: Add admin features and enhanced exam schema
-- Date: 2026-01-22

-- Add role column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin'));

-- Create index on role for faster queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Add logo and thumbnail columns to exams table
ALTER TABLE exams
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add image_url column to questions table if not exists
ALTER TABLE questions
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add image_url column to question_options table for answer images
ALTER TABLE question_options
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Update existing admin user (if exists) - replace with actual admin email
-- UPDATE users SET role = 'admin' WHERE email = 'admin@bharatmock.com';

-- Add comments for documentation
COMMENT ON COLUMN users.role IS 'User role: user (default) or admin';
COMMENT ON COLUMN exams.logo_url IS 'URL to exam logo stored in Cloudflare R2';
COMMENT ON COLUMN exams.thumbnail_url IS 'URL to exam thumbnail stored in Cloudflare R2';
COMMENT ON COLUMN questions.image_url IS 'URL to question image stored in Cloudflare R2';
COMMENT ON COLUMN question_options.image_url IS 'URL to option/answer image stored in Cloudflare R2';
