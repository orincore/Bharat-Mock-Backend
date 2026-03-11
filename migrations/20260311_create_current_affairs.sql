-- Current Affairs data model
CREATE TABLE IF NOT EXISTS current_affairs_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_badge TEXT,
  hero_title TEXT,
  hero_subtitle TEXT,
  hero_description TEXT,
  hero_cta_label TEXT,
  hero_cta_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords TEXT[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO current_affairs_settings (id, hero_title, hero_subtitle, hero_description, hero_cta_label, hero_cta_url, seo_title, seo_description, seo_keywords)
SELECT gen_random_uuid(),
       'Current Affairs Videos, Notes & Quizzes',
       'Fresh daily, weekly, and monthly coverage for all major exams',
       'Stay exam-ready with curated quizzes, bite-sized video explainers, and block-editor powered notes updated in real time by the Bharat Mock content desk.',
       'Explore Resources',
       '/current-affairs',
       'Current Affairs for SSC, Banking, UPSC & State Exams | Bharat Mock',
       'Attempt daily quizzes, watch explainer videos, and download notes covering the latest current affairs topics for SSC, Banking, UPSC, Railways, Defence and State PSC exams.',
       ARRAY['current affairs','ssc current affairs','banking current affairs','daily current affairs','weekly current affairs']
WHERE NOT EXISTS (SELECT 1 FROM current_affairs_settings);

CREATE TABLE IF NOT EXISTS current_affairs_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  video_url TEXT NOT NULL,
  platform TEXT,
  duration_seconds INTEGER,
  tag TEXT DEFAULT 'daily',
  is_featured BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS current_affairs_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  highlight_label TEXT,
  summary TEXT,
  tag TEXT,
  badge TEXT,
  is_published BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE current_affairs_quizzes
  ADD CONSTRAINT current_affairs_quizzes_exam_unique UNIQUE (exam_id);

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS is_current_affairs_note BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_affairs_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_current_affairs_note ON blogs(is_current_affairs_note, is_published, published_at DESC);

CREATE OR REPLACE FUNCTION update_current_affairs_videos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_current_affairs_videos ON current_affairs_videos;
CREATE TRIGGER trg_update_current_affairs_videos
  BEFORE UPDATE ON current_affairs_videos
  FOR EACH ROW
  EXECUTE FUNCTION update_current_affairs_videos_updated_at();

CREATE OR REPLACE FUNCTION update_current_affairs_quizzes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_current_affairs_quizzes ON current_affairs_quizzes;
CREATE TRIGGER trg_update_current_affairs_quizzes
  BEFORE UPDATE ON current_affairs_quizzes
  FOR EACH ROW
  EXECUTE FUNCTION update_current_affairs_quizzes_updated_at();
