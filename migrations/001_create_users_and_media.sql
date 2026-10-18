-- Migration: 001_create_users_and_media.sql

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('photo', 'video')),
  object_key TEXT NOT NULL UNIQUE,
  thumb_key TEXT,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  width INT,
  height INT,
  duration_sec NUMERIC,
  taken_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  upload_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_status_taken_id ON media (status, taken_at DESC, id);
