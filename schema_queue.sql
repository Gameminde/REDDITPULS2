-- ═══════════════════════════════════════════════════════
-- RedditPulse — Validation Job Queue
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- Queue table — serializes validation jobs
CREATE TABLE IF NOT EXISTS validation_queue (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    validation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    config_path text NOT NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'timeout')),
    created_at timestamptz DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    error text,
    attempts int DEFAULT 0
);

-- Index for polling: grab oldest pending job fast
CREATE INDEX IF NOT EXISTS idx_queue_pending
    ON validation_queue(status, created_at)
    WHERE status = 'pending';

-- Index for user's active jobs
CREATE INDEX IF NOT EXISTS idx_queue_user_active
    ON validation_queue(user_id, status)
    WHERE status IN ('pending', 'running');

-- Cleanup: auto-delete completed jobs older than 24h (optional cron)
-- SELECT cron.schedule('cleanup-queue', '0 */6 * * *',
--     $$DELETE FROM validation_queue WHERE status IN ('done', 'failed') AND completed_at < now() - interval '24 hours'$$
-- );
