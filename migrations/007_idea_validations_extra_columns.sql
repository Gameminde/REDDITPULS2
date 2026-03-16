-- Idea validation extra columns used by validate_idea.py second PATCH
ALTER TABLE idea_validations
ADD COLUMN IF NOT EXISTS verdict_source TEXT DEFAULT 'unknown';

ALTER TABLE idea_validations
ADD COLUMN IF NOT EXISTS synthesis_method TEXT;

ALTER TABLE idea_validations
ADD COLUMN IF NOT EXISTS debate_mode TEXT DEFAULT 'single';

ALTER TABLE idea_validations
ADD COLUMN IF NOT EXISTS platform_breakdown JSONB DEFAULT '{}'::jsonb;
