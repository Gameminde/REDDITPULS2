-- Migration 015: add time-window baseline timestamps for idea score deltas
-- This lets scraper_job.py advance 24h and 7d baselines on real time windows
-- instead of treating every scan as a new baseline.

ALTER TABLE public.ideas
    ADD COLUMN IF NOT EXISTS last_24h_update TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_7d_update TIMESTAMPTZ;

UPDATE public.ideas
SET
    last_24h_update = COALESCE(last_24h_update, last_updated, created_at, NOW()),
    last_7d_update = COALESCE(last_7d_update, last_updated, created_at, NOW())
WHERE last_24h_update IS NULL
   OR last_7d_update IS NULL;
