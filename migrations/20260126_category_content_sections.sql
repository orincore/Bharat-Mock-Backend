-- Migration: Add category content sections tables
-- Created: 2026-01-26
-- Description: Tables for managing dynamic category content (notifications, syllabus, cutoffs, dates, tips)

-- Category Notifications Table
CREATE TABLE IF NOT EXISTS category_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('exam', 'result', 'admit_card', 'notification', 'announcement')),
  notification_date DATE NOT NULL,
  link_url VARCHAR(1000),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_category_notifications_category ON category_notifications(category_id);
CREATE INDEX idx_category_notifications_active ON category_notifications(is_active);
CREATE INDEX idx_category_notifications_date ON category_notifications(notification_date DESC);

-- Category Syllabus Table
CREATE TABLE IF NOT EXISTS category_syllabus (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  subject_name VARCHAR(200) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_category_syllabus_category ON category_syllabus(category_id);
CREATE INDEX idx_category_syllabus_order ON category_syllabus(display_order);

-- Category Syllabus Topics Table
CREATE TABLE IF NOT EXISTS category_syllabus_topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  syllabus_id UUID NOT NULL REFERENCES category_syllabus(id) ON DELETE CASCADE,
  topic_name VARCHAR(300) NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_syllabus_topics_syllabus ON category_syllabus_topics(syllabus_id);
CREATE INDEX idx_syllabus_topics_order ON category_syllabus_topics(display_order);

-- Category Cutoffs Table
CREATE TABLE IF NOT EXISTS category_cutoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  exam_name VARCHAR(200),
  year VARCHAR(10) NOT NULL,
  cutoff_category VARCHAR(100) NOT NULL,
  marks DECIMAL(10, 2) NOT NULL,
  total_marks DECIMAL(10, 2),
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_category_cutoffs_category ON category_cutoffs(category_id);
CREATE INDEX idx_category_cutoffs_year ON category_cutoffs(year DESC);
CREATE INDEX idx_category_cutoffs_active ON category_cutoffs(is_active);

-- Category Important Dates Table
CREATE TABLE IF NOT EXISTS category_important_dates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  event_name VARCHAR(300) NOT NULL,
  event_date DATE,
  event_date_text VARCHAR(100),
  description TEXT,
  link_url VARCHAR(1000),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_category_dates_category ON category_important_dates(category_id);
CREATE INDEX idx_category_dates_event ON category_important_dates(event_date);
CREATE INDEX idx_category_dates_active ON category_important_dates(is_active);

-- Category Preparation Tips Table
CREATE TABLE IF NOT EXISTS category_preparation_tips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  tip_type VARCHAR(50) DEFAULT 'general',
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_category_tips_category ON category_preparation_tips(category_id);
CREATE INDEX idx_category_tips_order ON category_preparation_tips(display_order);
CREATE INDEX idx_category_tips_active ON category_preparation_tips(is_active);

-- Category Articles Junction Table (many-to-many)
CREATE TABLE IF NOT EXISTS category_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES exam_categories(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id, article_id)
);

CREATE INDEX idx_category_articles_category ON category_articles(category_id);
CREATE INDEX idx_category_articles_article ON category_articles(article_id);
CREATE INDEX idx_category_articles_featured ON category_articles(is_featured);

-- Update triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_category_notifications_updated_at BEFORE UPDATE ON category_notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_category_syllabus_updated_at BEFORE UPDATE ON category_syllabus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_category_syllabus_topics_updated_at BEFORE UPDATE ON category_syllabus_topics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_category_cutoffs_updated_at BEFORE UPDATE ON category_cutoffs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_category_important_dates_updated_at BEFORE UPDATE ON category_important_dates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_category_preparation_tips_updated_at BEFORE UPDATE ON category_preparation_tips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE category_notifications IS 'Stores notifications, announcements, and updates for each category';
COMMENT ON TABLE category_syllabus IS 'Stores subject-wise syllabus information for categories';
COMMENT ON TABLE category_syllabus_topics IS 'Stores individual topics under each syllabus subject';
COMMENT ON TABLE category_cutoffs IS 'Stores previous year cutoff marks for category exams';
COMMENT ON TABLE category_important_dates IS 'Stores important dates and deadlines for category exams';
COMMENT ON TABLE category_preparation_tips IS 'Stores preparation tips and strategies for categories';
COMMENT ON TABLE category_articles IS 'Links articles to categories for featured/related content';
