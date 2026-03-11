-- Migration: Update Admin Roles and Permissions System
-- Date: 2026-03-06
-- Description: Add Author role and update permissions for Admin, Editor, Author, and User roles

-- Update existing roles and add new ones
DELETE FROM admin_roles WHERE name IN ('examiner');

INSERT INTO admin_roles (name, description) VALUES
('author', 'Blog post creation and management access')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- Clear existing permissions
DELETE FROM admin_permissions;

-- Admin role permissions (full access to everything)
INSERT INTO admin_permissions (role_id, resource, can_create, can_read, can_update, can_delete)
SELECT 
    id,
    resource,
    true,
    true,
    true,
    true
FROM admin_roles
CROSS JOIN (
    VALUES 
        ('exams'),
        ('categories'),
        ('subcategories'),
        ('blogs'),
        ('users'),
        ('homepage'),
        ('pages'),
        ('subscriptions'),
        ('navigation'),
        ('footer'),
        ('about'),
        ('privacy'),
        ('disclaimer'),
        ('contact'),
        ('testimonials')
) AS resources(resource)
WHERE admin_roles.name = 'admin';

-- Editor role permissions (exams, categories, subcategories - create & update only)
INSERT INTO admin_permissions (role_id, resource, can_create, can_read, can_update, can_delete)
SELECT 
    id,
    resource,
    true,
    true,
    true,
    false
FROM admin_roles
CROSS JOIN (
    VALUES 
        ('exams'),
        ('categories'),
        ('subcategories')
) AS resources(resource)
WHERE admin_roles.name = 'editor';

-- Author role permissions (blogs - create & update only)
INSERT INTO admin_permissions (role_id, resource, can_create, can_read, can_update, can_delete)
SELECT 
    id,
    resource,
    true,
    true,
    true,
    false
FROM admin_roles
CROSS JOIN (
    VALUES 
        ('blogs')
) AS resources(resource)
WHERE admin_roles.name = 'author';

-- Add role column to users table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'role') THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';
    END IF;
END $$;

-- Create index for faster role lookups
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_role_resource ON admin_permissions(role_id, resource);
