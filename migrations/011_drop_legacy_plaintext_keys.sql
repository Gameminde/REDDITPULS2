-- Migration 011: Drop Legacy Plaintext API Keys
-- ==============================================
-- CONTEXT:
--   schema_settings.sql created a `user_settings` table with plaintext API keys.
--   fix_api_key_column.sql added a plain `api_key` column to `user_ai_config`.
--   Both are security risks — encrypted keys in `api_key_encrypted` (BYTEA) are the
--   only supported storage path going forward.
--
-- PRE-FLIGHT CHECK (run these BEFORE applying this migration):
--   SELECT count(*) FROM user_settings WHERE gemini_api_key IS NOT NULL OR groq_api_key IS NOT NULL;
--   SELECT count(*) FROM user_ai_config WHERE api_key IS NOT NULL AND api_key_encrypted IS NULL;
--
--   If either returns > 0, you must migrate those keys to encrypted storage first.
--   Use: UPDATE user_ai_config SET api_key_encrypted = pgp_sym_encrypt(api_key, current_setting('app.settings.ai_encryption_key'))
--         WHERE api_key IS NOT NULL AND api_key_encrypted IS NULL;

-- Step 1: Drop the plaintext `api_key` column from user_ai_config
-- (This was added by fix_api_key_column.sql as a "temporary fallback")
ALTER TABLE IF EXISTS user_ai_config DROP COLUMN IF EXISTS api_key;

-- Step 2: Drop the legacy user_settings table entirely
-- (Replaced by user_ai_config with encrypted storage)
DROP TABLE IF EXISTS user_settings;

-- Step 3: Recreate the safe VIEW (masks encrypted keys in browser queries)
-- Drop first to avoid column rename conflict
DROP VIEW IF EXISTS user_ai_config_safe;
CREATE VIEW user_ai_config_safe AS
SELECT
    id, 
    user_id,
    provider,
    '••••••••' AS api_key_masked,
    selected_model,
    is_active,
    priority,
    endpoint_url,
    created_at
FROM user_ai_config;

-- Step 4: Revoke direct SELECT on user_ai_config from anon/authenticated
-- (Force all browser reads through the safe VIEW)
-- NOTE: Uncomment these after verifying your app only reads through the VIEW:
-- REVOKE SELECT ON user_ai_config FROM anon;
-- REVOKE SELECT ON user_ai_config FROM authenticated;
-- GRANT SELECT ON user_ai_config_safe TO authenticated;
