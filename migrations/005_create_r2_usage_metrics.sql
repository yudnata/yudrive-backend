-- Migration: 005_create_r2_usage_metrics.sql

CREATE TABLE IF NOT EXISTS r2_usage_metrics (
  id SERIAL PRIMARY KEY,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  class_a_requests BIGINT NOT NULL DEFAULT 257,
  class_b_requests BIGINT NOT NULL DEFAULT 4720,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial record based on Cloudflare dashboard baseline
INSERT INTO r2_usage_metrics (id, period_start, period_end, class_a_requests, class_b_requests)
VALUES (
  1,
  TIMESTAMPTZ '2026-10-18 00:00:00+08',
  TIMESTAMPTZ '2026-11-18 23:59:59+08',
  257,
  4720
)
ON CONFLICT (id) DO NOTHING;
