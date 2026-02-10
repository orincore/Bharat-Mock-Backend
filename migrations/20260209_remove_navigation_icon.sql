-- Migration: Remove icon column from navigation_links
-- Date: 2026-02-09

ALTER TABLE navigation_links
    DROP COLUMN IF EXISTS icon;
