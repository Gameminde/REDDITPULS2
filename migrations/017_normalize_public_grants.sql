-- ============================================================
-- RedditPulse — Normalize Public Table Grants
-- ============================================================
--
-- Purpose:
--   Remove broad default grants for anon/authenticated and re-grant only
--   the minimum access required by the app's current RLS policies.
--
-- Safe scope:
--   - public schema app tables only
--   - no data changes
--   - no service_role revocation
--
-- ============================================================

-- Revoke broad grants from client roles on app tables
REVOKE ALL ON TABLE public.ai_analysis FROM anon, authenticated;
REVOKE ALL ON TABLE public.alert_matches FROM anon, authenticated;
REVOKE ALL ON TABLE public.competitor_complaints FROM anon, authenticated;
REVOKE ALL ON TABLE public.enrichment_cache FROM anon, authenticated;
REVOKE ALL ON TABLE public.graveyard_reports FROM anon, authenticated;
REVOKE ALL ON TABLE public.idea_history FROM anon, authenticated;
REVOKE ALL ON TABLE public.idea_validations FROM anon, authenticated;
REVOKE ALL ON TABLE public.ideas FROM anon, authenticated;
REVOKE ALL ON TABLE public.monitor_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.monitor_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.monitors FROM anon, authenticated;
REVOKE ALL ON TABLE public.morning_brief_cache FROM anon, authenticated;
REVOKE ALL ON TABLE public.pain_alerts FROM anon, authenticated;
REVOKE ALL ON TABLE public.posts FROM anon, authenticated;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.projects FROM anon, authenticated;
REVOKE ALL ON TABLE public.scans FROM anon, authenticated;
REVOKE ALL ON TABLE public.scraper_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.trend_signals FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_ai_config FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_requested_subreddits FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.validation_queue FROM anon, authenticated;
REVOKE ALL ON TABLE public.watchlists FROM anon, authenticated;

-- Public-read tables
GRANT SELECT ON TABLE public.enrichment_cache TO anon, authenticated;
GRANT SELECT ON TABLE public.graveyard_reports TO anon, authenticated;
GRANT SELECT ON TABLE public.idea_history TO anon, authenticated;
GRANT SELECT ON TABLE public.ideas TO anon, authenticated;
GRANT SELECT ON TABLE public.scraper_runs TO anon, authenticated;
GRANT SELECT ON TABLE public.user_requested_subreddits TO anon, authenticated;

-- Authenticated user-owned tables
GRANT SELECT, INSERT ON TABLE public.ai_analysis TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.alert_matches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.idea_validations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.monitor_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.monitor_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.monitors TO authenticated;
GRANT SELECT ON TABLE public.morning_brief_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pain_alerts TO authenticated;
GRANT SELECT ON TABLE public.posts TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_ai_config TO authenticated;
GRANT INSERT ON TABLE public.user_requested_subreddits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.watchlists TO authenticated;

-- Explicit service_role grants for restricted operational tables
GRANT ALL ON TABLE public.competitor_complaints TO service_role;
GRANT ALL ON TABLE public.trend_signals TO service_role;
GRANT ALL ON TABLE public.validation_queue TO service_role;
GRANT ALL ON TABLE public.morning_brief_cache TO service_role;
GRANT ALL ON TABLE public.graveyard_reports TO service_role;

-- ============================================================
-- Verification helpers
-- ============================================================
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema='public'
--   and table_name in (
--     'validation_queue','trend_signals','ideas','user_requested_subreddits',
--     'idea_validations','watchlists','profiles'
--   )
--   and grantee in ('anon','authenticated','service_role')
-- order by table_name, grantee, privilege_type;
