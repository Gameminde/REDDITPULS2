ALTER TABLE public.ideas
ADD COLUMN IF NOT EXISTS market_editorial JSONB;

ALTER TABLE public.ideas
ADD COLUMN IF NOT EXISTS market_editorial_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ideas_market_editorial_updated_at
ON public.ideas (market_editorial_updated_at DESC);
