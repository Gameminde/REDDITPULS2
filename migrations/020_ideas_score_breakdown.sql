ALTER TABLE public.ideas
ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
