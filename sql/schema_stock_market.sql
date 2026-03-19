-- ══════════════════════════════════════════════════════════════
-- Opportunity Engine — Idea Stock Market Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. LIVE IDEA SCORES (the "stock prices")
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ideas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic VARCHAR(255) NOT NULL UNIQUE,
    slug VARCHAR(255) NOT NULL UNIQUE,
    
    -- Live score (0-100, moves like a stock price)
    current_score FLOAT NOT NULL DEFAULT 0,
    score_24h_ago FLOAT DEFAULT 0,
    score_7d_ago FLOAT DEFAULT 0,
    score_30d_ago FLOAT DEFAULT 0,
    
    -- Deltas (how much the score moved)
    change_24h FLOAT DEFAULT 0,
    change_7d FLOAT DEFAULT 0,
    change_30d FLOAT DEFAULT 0,
    
    -- Trend
    trend_direction VARCHAR(10) DEFAULT 'new',  -- rising, falling, stable, new
    
    -- Confidence
    confidence_level VARCHAR(20) DEFAULT 'LOW',
    
    -- Volume metrics
    post_count_total INTEGER DEFAULT 0,
    post_count_24h INTEGER DEFAULT 0,
    post_count_7d INTEGER DEFAULT 0,
    source_count INTEGER DEFAULT 0,
    sources JSONB DEFAULT '[]',
    
    -- Individual score components
    reddit_velocity FLOAT DEFAULT 0,
    google_trend_score FLOAT DEFAULT 0,
    google_trend_growth FLOAT DEFAULT 0,
    competition_score FLOAT DEFAULT 0,
    cross_platform_multiplier FLOAT DEFAULT 1.0,
    
    -- Intelligence data
    icp_data JSONB DEFAULT '{}',
    competition_data JSONB DEFAULT '{}',
    pain_count INTEGER DEFAULT 0,
    pain_summary TEXT,
    top_posts JSONB DEFAULT '[]',
    keywords JSONB DEFAULT '[]',
    
    -- Category
    category VARCHAR(100) DEFAULT 'general',
    
    -- Timestamps
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_24h_update TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_7d_update TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ────────────────────────────────────────
-- 2. HISTORICAL PRICE DATA (for charts)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idea_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    score FLOAT NOT NULL,
    post_count INTEGER DEFAULT 0,
    google_trend FLOAT DEFAULT 0,
    source_count INTEGER DEFAULT 0,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ────────────────────────────────────────
-- 3. USER WATCHLISTS (portfolio tracking)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
    validation_id UUID REFERENCES idea_validations(id) ON DELETE CASCADE,
    alert_threshold FLOAT,
    notes TEXT DEFAULT '',
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT watchlists_item_check CHECK (idea_id IS NOT NULL OR validation_id IS NOT NULL)
);

-- ────────────────────────────────────────
-- 4. SCRAPER RUN LOG
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scraper_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(50) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    posts_collected INTEGER DEFAULT 0,
    ideas_updated INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'running',
    error_text TEXT,
    duration_seconds FLOAT
);

-- ────────────────────────────────────────
-- 5. INDEXES (performance)
-- ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ideas_score ON ideas(current_score DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_change_24h ON ideas(change_24h DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_change_7d ON ideas(change_7d DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_trend ON ideas(trend_direction);
CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);
CREATE INDEX IF NOT EXISTS idx_ideas_slug ON ideas(slug);
CREATE INDEX IF NOT EXISTS idx_idea_history_lookup ON idea_history(idea_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_user_idea_unique ON watchlists(user_id, idea_id) WHERE idea_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_user_validation_unique ON watchlists(user_id, validation_id) WHERE validation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scraper_runs_status ON scraper_runs(status, started_at DESC);

-- ────────────────────────────────────────
-- 6. ROW LEVEL SECURITY
-- ────────────────────────────────────────

-- Ideas: public read, no public write
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ideas are publicly readable"
    ON ideas FOR SELECT USING (true);

-- Idea history: public read
ALTER TABLE idea_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Idea history is publicly readable"
    ON idea_history FOR SELECT USING (true);

-- Watchlists: users see only their own
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own watchlist"
    ON watchlists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own watchlist"
    ON watchlists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own watchlist"
    ON watchlists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own watchlist"
    ON watchlists FOR DELETE USING (auth.uid() = user_id);

-- Scraper runs: public read (transparency)
ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Scraper runs are publicly readable"
    ON scraper_runs FOR SELECT USING (true);

-- ────────────────────────────────────────
-- 7. HELPER FUNCTION: slug generator
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_slug(topic TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN lower(regexp_replace(regexp_replace(topic, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ────────────────────────────────────────
-- Done! Tables ready for Idea Stock Market.
-- ────────────────────────────────────────
