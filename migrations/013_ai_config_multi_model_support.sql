-- Migration 013: Allow multiple AI configs per provider
-- Fixes the encrypted upsert RPC so saving a second model for the same
-- provider creates a second row instead of overwriting the first one.
--
-- Behavior:
-- - if p_config_id is provided, update that exact config
-- - otherwise, update only an exact provider+model match for that user
-- - otherwise, insert a new config row

DROP FUNCTION IF EXISTS public.upsert_ai_config_encrypted(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.upsert_ai_config_encrypted(
    p_config_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_provider TEXT DEFAULT NULL,
    p_api_key TEXT DEFAULT NULL,
    p_model TEXT DEFAULT NULL,
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

    IF p_config_id IS NOT NULL THEN
        SELECT c.id
        INTO v_config_id
        FROM public.user_ai_config c
        WHERE c.id = p_config_id
          AND c.user_id = p_user_id
        LIMIT 1;
    ELSE
        SELECT c.id
        INTO v_config_id
        FROM public.user_ai_config c
        WHERE c.user_id = p_user_id
          AND c.provider = p_provider
          AND c.selected_model = p_model
        ORDER BY c.created_at DESC NULLS LAST, c.id DESC
        LIMIT 1;
    END IF;

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
            provider = p_provider,
            selected_model = p_model,
            is_active = TRUE,
            priority = COALESCE(p_priority, 1),
            endpoint_url = p_endpoint_url
        WHERE id = v_config_id;
    END IF;

    RETURN v_config_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_ai_config_encrypted(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_ai_config_encrypted(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_ai_config_encrypted(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO service_role;
