-- Opportunities Board v1
-- User-owned promoted opportunity rows built on top of market ideas.

CREATE TABLE IF NOT EXISTS public.opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    primary_idea_slug TEXT NOT NULL REFERENCES public.ideas(slug) ON DELETE CASCADE,
    source_idea_slugs JSONB NOT NULL DEFAULT '[]'::JSONB,
    label TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    status TEXT NOT NULL DEFAULT 'board_ready'
        CHECK (status IN ('draft', 'board_ready', 'archived')),
    icp_summary TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_opportunities_user_primary_slug
    ON public.opportunities(user_id, primary_idea_slug);

CREATE INDEX IF NOT EXISTS idx_opportunities_user_status
    ON public.opportunities(user_id, status);

CREATE OR REPLACE FUNCTION public.update_opportunities_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opportunities_updated ON public.opportunities;
CREATE TRIGGER trg_opportunities_updated
    BEFORE UPDATE ON public.opportunities
    FOR EACH ROW EXECUTE FUNCTION public.update_opportunities_timestamp();

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own opportunities" ON public.opportunities;
CREATE POLICY "Users read own opportunities"
    ON public.opportunities
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own opportunities" ON public.opportunities;
CREATE POLICY "Users insert own opportunities"
    ON public.opportunities
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own opportunities" ON public.opportunities;
CREATE POLICY "Users update own opportunities"
    ON public.opportunities
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own opportunities" ON public.opportunities;
CREATE POLICY "Users delete own opportunities"
    ON public.opportunities
    FOR DELETE
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
