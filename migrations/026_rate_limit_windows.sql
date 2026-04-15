-- Shared durable rate limits
-- Adds a fixed-window counter table plus an atomic RPC for server routes.

CREATE TABLE IF NOT EXISTS public.rate_limit_windows (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, scope, window_seconds, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_scope_time
  ON public.rate_limit_windows (user_id, scope, updated_at DESC);

ALTER TABLE public.rate_limit_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own rate limit windows" ON public.rate_limit_windows;
CREATE POLICY "Users manage own rate limit windows" ON public.rate_limit_windows
  FOR ALL USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.consume_rate_limit_window(
  p_user_id UUID,
  p_scope TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  allowed BOOLEAN,
  current_count INTEGER,
  remaining_count INTEGER,
  window_started_at TIMESTAMPTZ,
  window_ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF COALESCE(TRIM(p_scope), '') = '' THEN
    RAISE EXCEPTION 'p_scope is required';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 THEN
    RAISE EXCEPTION 'p_limit must be positive';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'p_window_seconds must be positive';
  END IF;

  v_window_start := TO_TIMESTAMP(
    FLOOR(EXTRACT(EPOCH FROM p_now) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_windows (
    user_id,
    scope,
    window_seconds,
    window_started_at,
    hit_count,
    updated_at
  )
  VALUES (
    p_user_id,
    p_scope,
    p_window_seconds,
    v_window_start,
    1,
    p_now
  )
  ON CONFLICT (user_id, scope, window_seconds, window_started_at)
  DO UPDATE
    SET hit_count = public.rate_limit_windows.hit_count + 1,
        updated_at = p_now
  RETURNING public.rate_limit_windows.hit_count
  INTO v_current_count;

  DELETE FROM public.rate_limit_windows
  WHERE user_id = p_user_id
    AND scope = p_scope
    AND window_seconds = p_window_seconds
    AND window_started_at < (p_now - INTERVAL '30 days');

  RETURN QUERY
  SELECT
    v_current_count <= p_limit,
    v_current_count,
    GREATEST(p_limit - v_current_count, 0),
    v_window_start,
    v_window_start + MAKE_INTERVAL(secs => p_window_seconds);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_rate_limit_window(UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ) TO authenticated;
