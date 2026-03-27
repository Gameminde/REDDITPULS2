-- ============================================================
-- RedditPulse — Schema Cleanup, Lockdown, and Repair
-- REVIEW ONLY: do not auto-run
--
-- Purpose:
--   1. Remove foreign tables accidentally created from another project
--   2. Lock down publicly exposed RedditPulse tables
--   3. Restore the missing user_requested_subreddits table
--
-- Based on:
--   - SUPABASE_SCHEMA_AUDIT.md
--   - sql/schema_retention.sql
--   - schema_queue.sql
--
-- Notes:
--   - This file is intentionally split into numbered sections so it can be
--     reviewed and run manually in pieces if needed.
--   - No rollback section is included by request.
-- ============================================================

-- ============================================================
-- 1) CLEAN UP FOREIGN TABLES FROM THE OTHER PROJECT
-- ============================================================
--
-- These tables do not belong to RedditPulse. They are from a separate
-- content publishing / social automation app and were identified as schema
-- contamination during audit.
--
-- Current live foreign tables:
--   activation_codes
--   managed_pages
--   processed_content
--   published_posts
--   raw_articles
--   scheduled_posts
--   system_status
--   telegram_connections
--   users
--
-- Most are empty. system_status currently contains 3 rows and should be
-- archived first if you want to keep a copy.

DROP TABLE IF EXISTS public.activation_codes CASCADE;
DROP TABLE IF EXISTS public.managed_pages CASCADE;
DROP TABLE IF EXISTS public.processed_content CASCADE;
DROP TABLE IF EXISTS public.published_posts CASCADE;
DROP TABLE IF EXISTS public.raw_articles CASCADE;
DROP TABLE IF EXISTS public.scheduled_posts CASCADE;
DROP TABLE IF EXISTS public.telegram_connections CASCADE;
DROP TABLE IF EXISTS public.system_status CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- ============================================================
-- 2) LOCK DOWN APP-OWNED TABLES THAT ARE CURRENTLY PUBLIC
-- ============================================================
--
-- Audit confirmed anon REST read access on:
--   validation_queue
--   trend_signals
--
-- Goal:
--   - Keep these usable by service-role / backend workers
--   - Remove direct anon/authenticated access
--   - Enable RLS explicitly
--
-- We do NOT add public policies here.

ALTER TABLE IF EXISTS public.validation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trend_signals ENABLE ROW LEVEL SECURITY;

-- Remove broad client-role privileges
REVOKE ALL ON TABLE public.validation_queue FROM anon, authenticated;
REVOKE ALL ON TABLE public.trend_signals FROM anon, authenticated;

-- Keep service role access explicit
GRANT ALL ON TABLE public.validation_queue TO service_role;
GRANT ALL ON TABLE public.trend_signals TO service_role;

-- Remove any accidental public policies if they exist
DROP POLICY IF EXISTS "validation_queue_public_read" ON public.validation_queue;
DROP POLICY IF EXISTS "validation_queue_public_write" ON public.validation_queue;
DROP POLICY IF EXISTS "trend_signals_public_read" ON public.trend_signals;
DROP POLICY IF EXISTS "trend_signals_public_write" ON public.trend_signals;

-- Optional hardening:
-- If you later need authenticated server-side access without service_role,
-- add narrowly scoped SELECT policies here. For now, the safe default is no
-- anon/authenticated access at all.

-- ============================================================
-- 3) RESTORE MISSING user_requested_subreddits TABLE
-- ============================================================
--
-- RedditPulse expects this table in:
--   - scraper_job.py
--   - validate_idea.py
--   - sql/schema_retention.sql
--
-- The live database is missing it.

CREATE TABLE IF NOT EXISTS public.user_requested_subreddits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subreddit TEXT UNIQUE NOT NULL,
    requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    keywords TEXT[] DEFAULT '{}',
    added_at TIMESTAMPTZ DEFAULT NOW(),
    times_requested INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_user_requested_subreddits_added
    ON public.user_requested_subreddits(added_at DESC);

ALTER TABLE public.user_requested_subreddits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User requested subreddits are publicly readable"
    ON public.user_requested_subreddits;
CREATE POLICY "User requested subreddits are publicly readable"
    ON public.user_requested_subreddits
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert requested subreddits"
    ON public.user_requested_subreddits;
CREATE POLICY "Authenticated users can insert requested subreddits"
    ON public.user_requested_subreddits
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Explicit grants for Supabase client roles
GRANT SELECT ON TABLE public.user_requested_subreddits TO anon, authenticated;
GRANT INSERT ON TABLE public.user_requested_subreddits TO authenticated;
GRANT ALL ON TABLE public.user_requested_subreddits TO service_role;

-- ============================================================
-- 4) POST-RUN VERIFICATION QUERIES
-- ============================================================
--
-- Run these manually after applying the migration:
--
-- select tablename
-- from pg_tables
-- where schemaname = 'public'
-- order by tablename;
--
-- select table_name, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and table_name in ('validation_queue', 'trend_signals', 'user_requested_subreddits')
-- order by table_name, policyname;
--
-- select c.relname, c.relrowsecurity
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('validation_queue', 'trend_signals', 'user_requested_subreddits')
-- order by c.relname;
--
-- select *
-- from public.user_requested_subreddits
-- limit 5;
