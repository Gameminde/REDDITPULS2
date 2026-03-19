-- Monitor Core v1
-- Unifies legacy watchlists and pain alerts into a first-class recurring monitoring layer.

CREATE TABLE IF NOT EXISTS monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_type TEXT NOT NULL CHECK (legacy_type IN ('watchlist', 'alert')),
  legacy_id UUID NOT NULL,
  monitor_type TEXT NOT NULL CHECK (monitor_type IN ('opportunity', 'validation', 'pain_theme')),
  target_ref TEXT,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quiet', 'paused')),
  trust_level TEXT DEFAULT 'MEDIUM',
  trust_score INTEGER DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monitors_user_legacy_unique
ON monitors(user_id, legacy_type, legacy_id);

CREATE INDEX IF NOT EXISTS idx_monitors_user_status
ON monitors(user_id, status, last_changed_at DESC);

CREATE TABLE IF NOT EXISTS monitor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'neutral',
  impact_level TEXT NOT NULL DEFAULT 'LOW',
  summary TEXT NOT NULL,
  source_label TEXT,
  href TEXT,
  observed_at TIMESTAMPTZ DEFAULT NOW(),
  seen BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_events_monitor
ON monitor_events(monitor_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitor_events_user_seen
ON monitor_events(user_id, seen, observed_at DESC);

ALTER TABLE monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own monitors" ON monitors;
CREATE POLICY "Users manage own monitors" ON monitors
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own monitor events" ON monitor_events;
CREATE POLICY "Users manage own monitor events" ON monitor_events
  FOR ALL USING (auth.uid() = user_id);
