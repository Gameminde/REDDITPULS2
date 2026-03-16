-- ═══════════════════════════════════════════════════════
-- RedditPulse — Strategic Features Migration
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- Pain Stream: alerts table
CREATE TABLE IF NOT EXISTS pain_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  validation_id UUID,
  keywords TEXT[] NOT NULL,
  subreddits TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  min_score INTEGER DEFAULT 10,
  is_active BOOLEAN DEFAULT TRUE,
  last_checked TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pain Stream: matches table
CREATE TABLE IF NOT EXISTS alert_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID REFERENCES pain_alerts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  post_title TEXT,
  post_score INTEGER,
  post_url TEXT,
  subreddit TEXT,
  matched_keywords TEXT[],
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  seen BOOLEAN DEFAULT FALSE
);

-- Competitor Deathwatch
CREATE TABLE IF NOT EXISTS competitor_complaints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_title TEXT,
  post_score INTEGER,
  post_url TEXT,
  subreddit TEXT,
  competitors_mentioned TEXT[],
  complaint_signals TEXT[],
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idea Graveyard
CREATE TABLE IF NOT EXISTS graveyard_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  idea_text TEXT NOT NULL,
  verdict TEXT,
  confidence INTEGER,
  pain_level TEXT,
  competition_tier TEXT,
  evidence_summary TEXT,
  top_posts JSONB,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  is_public BOOLEAN DEFAULT TRUE
);

-- ═══════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pain_alerts_user ON pain_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_pain_alerts_active ON pain_alerts(is_active);
CREATE INDEX IF NOT EXISTS idx_alert_matches_user ON alert_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_matches_seen ON alert_matches(user_id, seen);
CREATE INDEX IF NOT EXISTS idx_alert_matches_alert ON alert_matches(alert_id);
CREATE INDEX IF NOT EXISTS idx_complaints_competitor ON competitor_complaints USING GIN(competitors_mentioned);
CREATE INDEX IF NOT EXISTS idx_graveyard_slug ON graveyard_reports(slug);
CREATE INDEX IF NOT EXISTS idx_graveyard_public ON graveyard_reports(is_public);

-- ═══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════

ALTER TABLE pain_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own alerts" ON pain_alerts;
CREATE POLICY "Users can manage own alerts" ON pain_alerts
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE alert_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own matches" ON alert_matches;
CREATE POLICY "Users can view own matches" ON alert_matches
  FOR ALL USING (auth.uid() = user_id);

-- Graveyard reports are public (no auth required for reads)
ALTER TABLE graveyard_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public graveyard reports" ON graveyard_reports;
CREATE POLICY "Public graveyard reports" ON graveyard_reports
  FOR SELECT USING (is_public = true);

-- Service role can insert/update graveyard (for seeder)
DROP POLICY IF EXISTS "Service can manage graveyard" ON graveyard_reports;
CREATE POLICY "Service can manage graveyard" ON graveyard_reports
  FOR ALL USING (true);

-- Competitor complaints are internal (service role only)
ALTER TABLE competitor_complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service can manage complaints" ON competitor_complaints;
CREATE POLICY "Service can manage complaints" ON competitor_complaints
  FOR ALL USING (true);
