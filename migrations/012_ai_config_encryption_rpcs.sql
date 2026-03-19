-- Migration 012: AI Config Encryption RPCs
-- Restores the encrypted-key RPC functions expected by:
--   - app/src/app/api/settings/ai/route.ts
--   - engine/multi_brain.py
--
-- Required after dropping legacy plaintext key paths so browser/server code
-- and queue workers can read and write encrypted AI provider keys safely.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.get_ai_configs_decrypted(
    p_user_id UUID,
    p_key TEXT
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    provider TEXT,
    api_key TEXT,
    selected_model TEXT,
    is_active BOOLEAN,
    priority INTEGER,
    endpoint_url TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    IF COALESCE(TRIM(p_key), '') = '' THEN
        RAISE EXCEPTION 'p_key is required';
    END IF;

    IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Not authorized to read these AI configs';
    END IF;

    RETURN QUERY
    SELECT
        c.id,
        c.user_id,
        c.provider,
        CASE
            WHEN c.api_key_encrypted IS NULL THEN NULL
            ELSE extensions.pgp_sym_decrypt(c.api_key_encrypted, p_key)
        END AS api_key,
        c.selected_model,
        c.is_active,
        c.priority,
        c.endpoint_url,
        c.created_at
    FROM public.user_ai_config c
    WHERE c.user_id = p_user_id
    ORDER BY c.priority ASC, c.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_ai_config_encrypted(
    p_user_id UUID,
    p_provider TEXT,
    p_api_key TEXT,
    p_model TEXT,
    p_priority INTEGER DEFAULT 1,
    p_endpoint_url TEXT DEFAULT NULL,
    p_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_config_id UUID;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    IF COALESCE(TRIM(p_provider), '') = '' THEN
        RAISE EXCEPTION 'p_provider is required';
    END IF;

    IF COALESCE(TRIM(p_model), '') = '' THEN
        RAISE EXCEPTION 'p_model is required';
    END IF;

    IF COALESCE(TRIM(p_api_key), '') = '' THEN
        RAISE EXCEPTION 'p_api_key is required';
    END IF;

    IF COALESCE(TRIM(p_key), '') = '' THEN
        RAISE EXCEPTION 'p_key is required';
    END IF;

    IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Not authorized to update these AI configs';
    END IF;

    SELECT c.id
    INTO v_config_id
    FROM public.user_ai_config c
    WHERE c.user_id = p_user_id
      AND c.provider = p_provider
    ORDER BY c.created_at DESC NULLS LAST, c.id DESC
    LIMIT 1;

    IF v_config_id IS NULL THEN
        INSERT INTO public.user_ai_config (
            user_id,
            provider,
            api_key_encrypted,
            selected_model,
            is_active,
            priority,
            endpoint_url
        )
        VALUES (
            p_user_id,
            p_provider,
            extensions.pgp_sym_encrypt(p_api_key, p_key),
            p_model,
            TRUE,
            COALESCE(p_priority, 1),
            p_endpoint_url
        )
        RETURNING id INTO v_config_id;
    ELSE
        UPDATE public.user_ai_config
        SET
            api_key_encrypted = extensions.pgp_sym_encrypt(p_api_key, p_key),
            selected_model = p_model,
            is_active = TRUE,
            priority = COALESCE(p_priority, 1),
            endpoint_url = p_endpoint_url
        WHERE id = v_config_id;
    END IF;

    RETURN v_config_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_configs_decrypted(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_ai_config_encrypted(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_ai_configs_decrypted(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_configs_decrypted(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_ai_config_encrypted(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_ai_config_encrypted(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO service_role;
