ALTER TABLE public.idea_validations
ADD COLUMN IF NOT EXISTS progress_log JSONB DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.append_validation_progress_log(
    p_validation_id UUID,
    p_event JSONB
)
RETURNS void AS $$
BEGIN
    UPDATE public.idea_validations
    SET progress_log = COALESCE(progress_log, '[]'::jsonb) || jsonb_build_array(p_event)
    WHERE id = p_validation_id;
END;
$$ LANGUAGE plpgsql;
