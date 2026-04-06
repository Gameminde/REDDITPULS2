DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'scraper_runs'
          AND column_name = 'source'
    ) THEN
        ALTER TABLE public.scraper_runs
        ALTER COLUMN source TYPE TEXT;
    END IF;
END $$;
