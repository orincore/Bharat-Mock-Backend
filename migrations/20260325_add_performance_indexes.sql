-- Performance optimization indexes for Bharat Mock Backend
-- Add critical indexes to improve query performance

-- Exams table indexes
CREATE INDEX IF NOT EXISTS idx_exams_category_id ON exams(category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_subcategory_id ON exams(subcategory_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_difficulty_id ON exams(difficulty_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_is_published ON exams(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_exam_type ON exams(exam_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_is_premium ON exams(is_premium) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_slug ON exams(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_url_path ON exams(url_path) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_exam_uid ON exams(exam_uid) WHERE deleted_at IS NULL;

-- Composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_exams_category_status ON exams(category_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_category_published ON exams(category_id, is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_published_created ON exams(is_published, created_at DESC) WHERE deleted_at IS NULL;

-- Test series indexes
CREATE INDEX IF NOT EXISTS idx_test_series_category_id ON test_series(category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_test_series_subcategory_id ON test_series(subcategory_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_test_series_difficulty_id ON test_series(difficulty_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_test_series_is_published ON test_series(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_test_series_slug ON test_series(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_test_series_display_order ON test_series(display_order) WHERE deleted_at IS NULL;

-- Exam attempts indexes for performance
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_id ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_id ON exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_user ON exam_attempts(exam_id, user_id);

-- Exam syllabus indexes for topic searches
CREATE INDEX IF NOT EXISTS idx_exam_syllabus_exam_id ON exam_syllabus(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_syllabus_topic_gin ON exam_syllabus USING gin(to_tsvector('english', topic));

-- Page popular tests indexes
CREATE INDEX IF NOT EXISTS idx_page_popular_tests_page_active ON page_popular_tests(page_identifier, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_page_popular_tests_exam_id ON page_popular_tests(exam_id);

-- Category and subcategory indexes
CREATE INDEX IF NOT EXISTS idx_exam_categories_slug ON exam_categories(slug);
CREATE INDEX IF NOT EXISTS idx_exam_subcategories_slug ON exam_subcategories(slug);
CREATE INDEX IF NOT EXISTS idx_exam_subcategories_category_id ON exam_subcategories(category_id);

-- Text search indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_exams_title_gin ON exams USING gin(to_tsvector('english', title)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_test_series_title_gin ON test_series USING gin(to_tsvector('english', title)) WHERE deleted_at IS NULL;

-- Optimize for date range queries
CREATE INDEX IF NOT EXISTS idx_exams_start_date ON exams(start_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_end_date ON exams(end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_exam_date ON exams(exam_date) WHERE deleted_at IS NULL;

-- Add statistics for better query planning
ANALYZE exams;
ANALYZE test_series;
ANALYZE exam_attempts;
ANALYZE exam_syllabus;
ANALYZE page_popular_tests;
ANALYZE exam_categories;
ANALYZE exam_subcategories;