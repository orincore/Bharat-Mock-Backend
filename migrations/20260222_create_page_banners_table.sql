CREATE TABLE IF NOT EXISTS page_banners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_identifier TEXT NOT NULL,
    image_url TEXT NOT NULL,
    link_url TEXT,
    alt_text TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_banners_page_identifier
    ON page_banners (page_identifier);
