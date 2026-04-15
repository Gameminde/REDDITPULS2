-- Monitor bridge normalization
-- Makes opportunity-backed native monitors valid and backfills native rows for legacy watchlists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'monitors'
      AND constraint_name = 'monitors_legacy_type_check'
  ) THEN
    ALTER TABLE public.monitors DROP CONSTRAINT monitors_legacy_type_check;
  END IF;
END $$;

ALTER TABLE public.monitors
  ADD CONSTRAINT monitors_legacy_type_check
  CHECK (legacy_type IN ('watchlist', 'alert', 'opportunity'));

CREATE OR REPLACE FUNCTION public.backfill_watchlist_monitors()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
  supports_validation_id BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'watchlists'
      AND column_name = 'validation_id'
  )
  INTO supports_validation_id;

  IF supports_validation_id THEN
    WITH candidate_rows AS (
      SELECT
        w.id AS watchlist_id,
        w.user_id,
        w.idea_id,
        w.validation_id,
        w.alert_threshold,
        COALESCE(w.notes, '') AS notes,
        w.added_at,
        i.id AS joined_idea_id,
        i.topic,
        i.slug,
        i.category,
        i.current_score,
        i.last_updated,
        v.id AS joined_validation_id,
        v.idea_text,
        v.confidence,
        v.created_at AS validation_created_at,
        v.completed_at AS validation_completed_at
      FROM public.watchlists w
      LEFT JOIN public.ideas i ON i.id = w.idea_id
      LEFT JOIN public.idea_validations v ON v.id = w.validation_id
    ),
    inserted AS (
      INSERT INTO public.monitors (
        user_id,
        legacy_type,
        legacy_id,
        monitor_type,
        target_ref,
        title,
        subtitle,
        status,
        trust_level,
        trust_score,
        last_checked_at,
        last_changed_at,
        metadata
      )
      SELECT
        c.user_id,
        'watchlist',
        c.watchlist_id,
        CASE
          WHEN c.validation_id IS NOT NULL THEN 'validation'
          ELSE 'opportunity'
        END,
        CASE
          WHEN c.validation_id IS NOT NULL THEN '/dashboard/reports/' || c.validation_id::TEXT
          WHEN c.slug IS NOT NULL AND c.slug <> '' THEN '/dashboard/idea/' || c.slug
          ELSE '/dashboard/saved'
        END,
        CASE
          WHEN c.validation_id IS NOT NULL THEN LEFT(COALESCE(NULLIF(c.idea_text, ''), 'Validation monitor'), 120)
          ELSE LEFT(COALESCE(NULLIF(c.topic, ''), 'Saved opportunity'), 120)
        END,
        CASE
          WHEN c.validation_id IS NOT NULL THEN 'Validation monitor'
          ELSE 'Opportunity monitor'
        END,
        'active',
        CASE
          WHEN c.validation_id IS NOT NULL THEN
            CASE
              WHEN COALESCE(c.confidence, 0) >= 75 THEN 'HIGH'
              WHEN COALESCE(c.confidence, 0) >= 45 THEN 'MEDIUM'
              ELSE 'LOW'
            END
          ELSE 'MEDIUM'
        END,
        CASE
          WHEN c.validation_id IS NOT NULL THEN LEAST(GREATEST(COALESCE(c.confidence, 0), 0), 100)
          ELSE LEAST(GREATEST(COALESCE(c.current_score, 0), 0), 100)
        END,
        COALESCE(c.validation_completed_at, c.validation_created_at, c.last_updated, c.added_at, NOW()),
        COALESCE(c.validation_completed_at, c.validation_created_at, c.last_updated, c.added_at, NOW()),
        jsonb_build_object(
          'summary',
          CASE
            WHEN c.validation_id IS NOT NULL
              THEN 'Backfilled validation monitor. Refresh through the app to capture full report metadata.'
            ELSE 'Backfilled saved opportunity monitor. Refresh through the app to capture full market memory.'
          END,
          'tags',
          jsonb_build_array(COALESCE(NULLIF(c.category, ''), CASE WHEN c.validation_id IS NOT NULL THEN 'validation' ELSE 'opportunity' END)),
          'metrics',
          jsonb_build_array(),
          'data',
          jsonb_strip_nulls(jsonb_build_object(
            'watchlist_id', c.watchlist_id,
            'idea_id', c.idea_id,
            'validation_id', c.validation_id,
            'alert_threshold', c.alert_threshold,
            'notes', c.notes,
            'backfilled_from_watchlist', TRUE
          ))
        )
      FROM candidate_rows c
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.monitors m
        WHERE m.user_id = c.user_id
          AND m.legacy_type = 'watchlist'
          AND m.legacy_id = c.watchlist_id
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO inserted_count FROM inserted;
  ELSE
    WITH candidate_rows AS (
      SELECT
        w.id AS watchlist_id,
        w.user_id,
        w.idea_id,
        w.alert_threshold,
        COALESCE(w.notes, '') AS notes,
        w.added_at,
        i.topic,
        i.slug,
        i.category,
        i.current_score,
        i.last_updated
      FROM public.watchlists w
      LEFT JOIN public.ideas i ON i.id = w.idea_id
    ),
    inserted AS (
      INSERT INTO public.monitors (
        user_id,
        legacy_type,
        legacy_id,
        monitor_type,
        target_ref,
        title,
        subtitle,
        status,
        trust_level,
        trust_score,
        last_checked_at,
        last_changed_at,
        metadata
      )
      SELECT
        c.user_id,
        'watchlist',
        c.watchlist_id,
        'opportunity',
        CASE
          WHEN c.slug IS NOT NULL AND c.slug <> '' THEN '/dashboard/idea/' || c.slug
          ELSE '/dashboard/saved'
        END,
        LEFT(COALESCE(NULLIF(c.topic, ''), 'Saved opportunity'), 120),
        'Opportunity monitor',
        'active',
        'MEDIUM',
        LEAST(GREATEST(COALESCE(c.current_score, 0), 0), 100),
        COALESCE(c.last_updated, c.added_at, NOW()),
        COALESCE(c.last_updated, c.added_at, NOW()),
        jsonb_build_object(
          'summary', 'Backfilled saved opportunity monitor. Refresh through the app to capture full market memory.',
          'tags', jsonb_build_array(COALESCE(NULLIF(c.category, ''), 'opportunity')),
          'metrics', jsonb_build_array(),
          'data', jsonb_strip_nulls(jsonb_build_object(
            'watchlist_id', c.watchlist_id,
            'idea_id', c.idea_id,
            'alert_threshold', c.alert_threshold,
            'notes', c.notes,
            'backfilled_from_watchlist', TRUE
          ))
        )
      FROM candidate_rows c
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.monitors m
        WHERE m.user_id = c.user_id
          AND m.legacy_type = 'watchlist'
          AND m.legacy_id = c.watchlist_id
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO inserted_count FROM inserted;
  END IF;

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_watchlist_monitors() TO authenticated;
