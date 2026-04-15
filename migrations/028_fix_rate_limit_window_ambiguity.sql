-- Fix ambiguous output-column references inside consume_rate_limit_window()
-- The RETURNS TABLE column names are visible as PL/pgSQL variables, so any
-- unqualified use of window_started_at/current_count/etc inside the function
-- can collide with table column names once the function is executed.

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
  ON CONFLICT ON CONSTRAINT rate_limit_windows_pkey
  DO UPDATE
    SET hit_count = public.rate_limit_windows.hit_count + 1,
        updated_at = p_now
  RETURNING public.rate_limit_windows.hit_count
  INTO v_current_count;

  DELETE FROM public.rate_limit_windows AS rlw
  WHERE rlw.user_id = p_user_id
    AND rlw.scope = p_scope
    AND rlw.window_seconds = p_window_seconds
    AND rlw.window_started_at < (p_now - INTERVAL '30 days');

  RETURN QUERY
  SELECT
    v_current_count <= p_limit AS allowed,
    v_current_count AS current_count,
    GREATEST(p_limit - v_current_count, 0) AS remaining_count,
    v_window_start AS window_started_at,
    v_window_start + MAKE_INTERVAL(secs => p_window_seconds) AS window_ends_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_rate_limit_window(UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ) TO authenticated;
