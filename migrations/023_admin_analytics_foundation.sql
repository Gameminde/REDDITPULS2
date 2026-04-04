ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_role_check'
    ) THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_role_check
        CHECK (role IN ('user', 'moderator', 'admin'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

CREATE TABLE IF NOT EXISTS public.analytics_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('marketing', 'auth', 'product', 'admin')),
    route TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id TEXT,
    anonymous_id TEXT,
    referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    device_type TEXT,
    country_code TEXT,
    ip_hash TEXT,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON public.analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_scope ON public.analytics_events(scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON public.analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON public.analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON public.analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_anon ON public.analytics_events(anonymous_id);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages analytics events" ON public.analytics_events;
CREATE POLICY "Service role manages analytics events"
    ON public.analytics_events
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.analytics_events TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
    message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_admin_events_created_at ON public.admin_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_actor ON public.admin_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_action ON public.admin_events(action, created_at DESC);

ALTER TABLE public.admin_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages admin events" ON public.admin_events;
CREATE POLICY "Service role manages admin events"
    ON public.admin_events
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.admin_events TO service_role;

CREATE TABLE IF NOT EXISTS public.runtime_settings (
    singleton_key TEXT PRIMARY KEY DEFAULT 'default',
    scrapers_paused BOOLEAN NOT NULL DEFAULT FALSE,
    validations_paused BOOLEAN NOT NULL DEFAULT FALSE,
    default_validation_depth TEXT NOT NULL DEFAULT 'quick'
        CHECK (default_validation_depth IN ('quick', 'deep', 'investigation')),
    maintenance_note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.runtime_settings (singleton_key)
VALUES ('default')
ON CONFLICT (singleton_key) DO NOTHING;

ALTER TABLE public.runtime_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages runtime settings" ON public.runtime_settings;
CREATE POLICY "Service role manages runtime settings"
    ON public.runtime_settings
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.runtime_settings TO service_role;
