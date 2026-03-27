-- Reddit Connection Lab v1
-- Experimental, additive storage for user-connected Reddit accounts,
-- and curated source packs for validation targeting.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_reddit_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    reddit_user_id TEXT,
    reddit_username TEXT NOT NULL,
    account_mode TEXT NOT NULL DEFAULT 'personal'
        CHECK (account_mode IN ('personal', 'research')),
    status TEXT NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'needs_reauth', 'error', 'disconnected')),
    access_token_encrypted BYTEA,
    refresh_token_encrypted BYTEA,
    granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    token_expires_at TIMESTAMPTZ,
    profile_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    synced_subreddits JSONB NOT NULL DEFAULT '[]'::JSONB,
    saved_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
    multireddit_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
    last_synced_at TIMESTAMPTZ,
    last_token_refresh_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_reddit_source_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES public.user_reddit_connections(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_type IN ('synced', 'manual', 'mixed')),
    subreddits TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    saved_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
    multireddit_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
    is_default_for_validation BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reddit_connection_user
    ON public.user_reddit_connections(user_id);

CREATE INDEX IF NOT EXISTS idx_reddit_source_packs_user
    ON public.user_reddit_source_packs(user_id);

CREATE INDEX IF NOT EXISTS idx_reddit_source_packs_default
    ON public.user_reddit_source_packs(user_id, is_default_for_validation);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reddit_source_pack_default
    ON public.user_reddit_source_packs(user_id)
    WHERE is_default_for_validation = TRUE;

ALTER TABLE public.user_reddit_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reddit_source_packs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_reddit_connections FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_reddit_source_packs FROM anon, authenticated;

GRANT ALL ON TABLE public.user_reddit_connections TO service_role;
GRANT ALL ON TABLE public.user_reddit_source_packs TO service_role;

DROP POLICY IF EXISTS "reddit_connections_service_only" ON public.user_reddit_connections;
CREATE POLICY "reddit_connections_service_only" ON public.user_reddit_connections
    FOR ALL TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

DROP POLICY IF EXISTS "reddit_source_packs_service_only" ON public.user_reddit_source_packs;
CREATE POLICY "reddit_source_packs_service_only" ON public.user_reddit_source_packs
    FOR ALL TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.update_reddit_lab_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reddit_connections_updated ON public.user_reddit_connections;
CREATE TRIGGER trg_reddit_connections_updated
    BEFORE UPDATE ON public.user_reddit_connections
    FOR EACH ROW EXECUTE FUNCTION public.update_reddit_lab_timestamp();

DROP TRIGGER IF EXISTS trg_reddit_source_packs_updated ON public.user_reddit_source_packs;
CREATE TRIGGER trg_reddit_source_packs_updated
    BEFORE UPDATE ON public.user_reddit_source_packs
    FOR EACH ROW EXECUTE FUNCTION public.update_reddit_lab_timestamp();

CREATE OR REPLACE FUNCTION public.upsert_reddit_connection_encrypted(
    p_connection_id UUID,
    p_user_id UUID,
    p_reddit_user_id TEXT,
    p_reddit_username TEXT,
    p_account_mode TEXT,
    p_status TEXT,
    p_access_token TEXT,
    p_refresh_token TEXT,
    p_granted_scopes TEXT[],
    p_token_expires_at TIMESTAMPTZ,
    p_profile_metadata JSONB,
    p_synced_subreddits JSONB,
    p_saved_refs JSONB,
    p_multireddit_refs JSONB,
    p_last_synced_at TIMESTAMPTZ,
    p_last_token_refresh_at TIMESTAMPTZ,
    p_last_error TEXT,
    p_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    INSERT INTO public.user_reddit_connections (
        id,
        user_id,
        reddit_user_id,
        reddit_username,
        account_mode,
        status,
        access_token_encrypted,
        refresh_token_encrypted,
        granted_scopes,
        token_expires_at,
        profile_metadata,
        synced_subreddits,
        saved_refs,
        multireddit_refs,
        last_synced_at,
        last_token_refresh_at,
        last_error
    )
    VALUES (
        COALESCE(
            p_connection_id,
            (SELECT id FROM public.user_reddit_connections WHERE user_id = p_user_id LIMIT 1),
            gen_random_uuid()
        ),
        p_user_id,
        NULLIF(p_reddit_user_id, ''),
        p_reddit_username,
        COALESCE(NULLIF(p_account_mode, ''), 'personal'),
        COALESCE(NULLIF(p_status, ''), 'connected'),
        CASE WHEN p_access_token IS NULL OR p_access_token = '' THEN NULL ELSE extensions.pgp_sym_encrypt(p_access_token, p_key) END,
        CASE WHEN p_refresh_token IS NULL OR p_refresh_token = '' THEN NULL ELSE extensions.pgp_sym_encrypt(p_refresh_token, p_key) END,
        COALESCE(p_granted_scopes, ARRAY[]::TEXT[]),
        p_token_expires_at,
        COALESCE(p_profile_metadata, '{}'::JSONB),
        COALESCE(p_synced_subreddits, '[]'::JSONB),
        COALESCE(p_saved_refs, '[]'::JSONB),
        COALESCE(p_multireddit_refs, '[]'::JSONB),
        p_last_synced_at,
        p_last_token_refresh_at,
        p_last_error
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
        reddit_user_id = EXCLUDED.reddit_user_id,
        reddit_username = EXCLUDED.reddit_username,
        account_mode = EXCLUDED.account_mode,
        status = EXCLUDED.status,
        access_token_encrypted = COALESCE(EXCLUDED.access_token_encrypted, public.user_reddit_connections.access_token_encrypted),
        refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, public.user_reddit_connections.refresh_token_encrypted),
        granted_scopes = EXCLUDED.granted_scopes,
        token_expires_at = EXCLUDED.token_expires_at,
        profile_metadata = EXCLUDED.profile_metadata,
        synced_subreddits = EXCLUDED.synced_subreddits,
        saved_refs = EXCLUDED.saved_refs,
        multireddit_refs = EXCLUDED.multireddit_refs,
        last_synced_at = EXCLUDED.last_synced_at,
        last_token_refresh_at = EXCLUDED.last_token_refresh_at,
        last_error = EXCLUDED.last_error
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_reddit_connection_decrypted(
    p_user_id UUID,
    p_connection_id UUID,
    p_key TEXT
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    reddit_user_id TEXT,
    reddit_username TEXT,
    account_mode TEXT,
    status TEXT,
    access_token TEXT,
    refresh_token TEXT,
    granted_scopes TEXT[],
    token_expires_at TIMESTAMPTZ,
    profile_metadata JSONB,
    synced_subreddits JSONB,
    saved_refs JSONB,
    multireddit_refs JSONB,
    last_synced_at TIMESTAMPTZ,
    last_token_refresh_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT
        c.id,
        c.user_id,
        c.reddit_user_id,
        c.reddit_username,
        c.account_mode,
        c.status,
        CASE WHEN c.access_token_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(c.access_token_encrypted, p_key) END AS access_token,
        CASE WHEN c.refresh_token_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(c.refresh_token_encrypted, p_key) END AS refresh_token,
        c.granted_scopes,
        c.token_expires_at,
        c.profile_metadata,
        c.synced_subreddits,
        c.saved_refs,
        c.multireddit_refs,
        c.last_synced_at,
        c.last_token_refresh_at,
        c.last_error,
        c.created_at,
        c.updated_at
    FROM public.user_reddit_connections c
    WHERE c.user_id = p_user_id
      AND (p_connection_id IS NULL OR c.id = p_connection_id)
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.upsert_reddit_connection_encrypted(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reddit_connection_decrypted(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_reddit_connection_encrypted(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_reddit_connection_decrypted(UUID, UUID, TEXT) TO service_role;
