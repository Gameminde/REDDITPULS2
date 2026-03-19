-- Validation Depth Modes — add depth column to idea_validations
-- Run in Supabase SQL Editor

ALTER TABLE idea_validations
ADD COLUMN IF NOT EXISTS depth TEXT DEFAULT 'quick';

COMMENT ON COLUMN idea_validations.depth IS 'Validation depth mode: quick, deep, or investigation';
