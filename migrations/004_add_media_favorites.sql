-- Migration: 004_add_media_favorites.sql

ALTER TABLE media ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_media_is_favorite ON media (is_favorite) WHERE is_favorite = true;
