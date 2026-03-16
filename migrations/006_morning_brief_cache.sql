-- Morning Brief per-user cache
CREATE TABLE IF NOT EXISTS morning_brief_cache (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_morning_brief_cache_generated
ON morning_brief_cache(generated_at DESC);

ALTER TABLE morning_brief_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own morning brief cache" ON morning_brief_cache;
CREATE POLICY "Users can view own morning brief cache" ON morning_brief_cache
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service can manage morning brief cache" ON morning_brief_cache;
CREATE POLICY "Service can manage morning brief cache" ON morning_brief_cache
  FOR ALL USING (true);
