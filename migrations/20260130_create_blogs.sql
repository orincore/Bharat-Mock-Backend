-- Create blogs table
CREATE TABLE IF NOT EXISTS blogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  excerpt TEXT,
  featured_image_url TEXT,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category VARCHAR(100),
  tags TEXT[],
  is_published BOOLEAN DEFAULT FALSE,
  is_featured BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMP WITH TIME ZONE,
  view_count INTEGER DEFAULT 0,
  read_time INTEGER,
  meta_title VARCHAR(255),
  meta_description TEXT,
  meta_keywords TEXT,
  og_title VARCHAR(255),
  og_description TEXT,
  og_image_url TEXT,
  canonical_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create blog_sections table (similar to page_sections)
CREATE TABLE IF NOT EXISTS blog_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id UUID NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  section_key VARCHAR(100),
  title VARCHAR(255),
  subtitle TEXT,
  display_order INTEGER DEFAULT 0,
  is_collapsible BOOLEAN DEFAULT FALSE,
  is_expanded BOOLEAN DEFAULT TRUE,
  background_color VARCHAR(50),
  text_color VARCHAR(50),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create blog_blocks table (similar to page_blocks)
CREATE TABLE IF NOT EXISTS blog_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES blog_sections(id) ON DELETE CASCADE,
  block_type VARCHAR(50) NOT NULL,
  content JSONB DEFAULT '{}',
  settings JSONB DEFAULT '{}',
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_blogs_slug ON blogs(slug);
CREATE INDEX IF NOT EXISTS idx_blogs_published ON blogs(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blogs_category ON blogs(category);
CREATE INDEX IF NOT EXISTS idx_blogs_author ON blogs(author_id);
CREATE INDEX IF NOT EXISTS idx_blog_sections_blog_id ON blog_sections(blog_id);
CREATE INDEX IF NOT EXISTS idx_blog_blocks_section_id ON blog_blocks(section_id);

-- Add RLS policies
ALTER TABLE blogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_blocks ENABLE ROW LEVEL SECURITY;

-- Public read access for published blogs
CREATE POLICY "Public can view published blogs" ON blogs
  FOR SELECT USING (is_published = true);

CREATE POLICY "Public can view blog sections" ON blog_sections
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM blogs WHERE blogs.id = blog_sections.blog_id AND blogs.is_published = true
    )
  );

CREATE POLICY "Public can view blog blocks" ON blog_blocks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM blog_sections
      JOIN blogs ON blogs.id = blog_sections.blog_id
      WHERE blog_sections.id = blog_blocks.section_id AND blogs.is_published = true
    )
  );

-- Admin full access
CREATE POLICY "Admins have full access to blogs" ON blogs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid() AND auth.users.role = 'admin'
    )
  );

CREATE POLICY "Admins have full access to blog_sections" ON blog_sections
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid() AND auth.users.role = 'admin'
    )
  );

CREATE POLICY "Admins have full access to blog_blocks" ON blog_blocks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid() AND auth.users.role = 'admin'
    )
  );
