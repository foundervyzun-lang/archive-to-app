CREATE OR REPLACE FUNCTION public.sync_vibe_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ids uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN _ids := ARRAY[OLD.follower_id, OLD.following_id];
  ELSIF TG_OP = 'INSERT' THEN _ids := ARRAY[NEW.follower_id, NEW.following_id];
  ELSE _ids := ARRAY[NEW.follower_id, NEW.following_id, OLD.follower_id, OLD.following_id];
  END IF;
  UPDATE public.profiles p SET
    vibers_count = (SELECT count(*) FROM public.social_connections c WHERE c.following_id = p.id AND c.state = 'active'),
    vibing_count = (SELECT count(*) FROM public.social_connections c WHERE c.follower_id = p.id AND c.state = 'active')
  WHERE p.id = ANY(_ids);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sync_vibe_counts() FROM public, anon, authenticated;
CREATE TRIGGER social_connections_counts AFTER INSERT OR UPDATE OR DELETE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.sync_vibe_counts();
UPDATE public.profiles p SET
  vibers_count = (SELECT count(*) FROM public.social_connections c WHERE c.following_id = p.id AND c.state = 'active'),
  vibing_count = (SELECT count(*) FROM public.social_connections c WHERE c.follower_id = p.id AND c.state = 'active');