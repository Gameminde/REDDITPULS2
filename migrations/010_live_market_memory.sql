-- Live Market Memory v2
-- Persists monitor state snapshots so RedditPulse can explain what changed over time.

CREATE TABLE IF NOT EXISTS monitor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_hash TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'steady' CHECK (direction IN ('strengthening', 'weakening', 'steady', 'new')),
  state_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  delta_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_snapshots_monitor_time
ON monitor_snapshots(monitor_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitor_snapshots_user_time
ON monitor_snapshots(user_id, captured_at DESC);

ALTER TABLE monitor_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own monitor snapshots" ON monitor_snapshots;
CREATE POLICY "Users manage own monitor snapshots" ON monitor_snapshots
  FOR ALL USING (auth.uid() = user_id);
