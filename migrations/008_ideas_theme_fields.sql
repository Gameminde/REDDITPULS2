-- Theme-level evidence fields for Explore + Trends
ALTER TABLE ideas
ADD COLUMN IF NOT EXISTS post_count_24h INTEGER DEFAULT 0;

ALTER TABLE ideas
ADD COLUMN IF NOT EXISTS pain_count INTEGER DEFAULT 0;

ALTER TABLE ideas
ADD COLUMN IF NOT EXISTS pain_summary TEXT;
