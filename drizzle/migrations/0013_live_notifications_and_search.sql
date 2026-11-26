CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS profiles_username_trgm ON public.profiles USING gin (username extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS reels_caption_trgm ON public.reels USING gin (caption extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS reels_hashtags_gin ON public.reels USING gin (hashtags);

CREATE OR REPLACE FUNCTION public.vz_notify(_user uuid, _actor uuid, _category text, _title text, _body text, _payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NULL OR _user = _actor THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.user_restrictions WHERE user_id = _user AND target_id = _actor) THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, category, title, body, payload) VALUES (_user, _category, _title, _body, _payload);
END $$;
REVOKE ALL ON FUNCTION public.vz_notify(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vz_actor_name(_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE('@' || (SELECT username FROM public.profiles WHERE id = _id), 'Someone') $$;
REVOKE ALL ON FUNCTION public.vz_actor_name(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_chat_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT user_id FROM public.chat_participants WHERE chat_id = NEW.chat_id AND user_id <> NEW.sender_id LOOP
    PERFORM public.vz_notify(r.user_id, NEW.sender_id, 'message', public.vz_actor_name(NEW.sender_id) || ' sent you a message', left(COALESCE(NEW.body, 'Media message'), 80), jsonb_build_object('chat_id', NEW.chat_id));
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chat_messages_notify ON public.chat_messages;
CREATE TRIGGER chat_messages_notify AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.notify_chat_message();

CREATE OR REPLACE FUNCTION public.notify_follow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.vz_notify(NEW.following_id, NEW.follower_id, 'follow', public.vz_actor_name(NEW.follower_id) || ' started vibing with you', NULL, jsonb_build_object('user_id', NEW.follower_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS social_connections_notify ON public.social_connections;
CREATE TRIGGER social_connections_notify AFTER INSERT ON public.social_connections FOR EACH ROW EXECUTE FUNCTION public.notify_follow();

CREATE OR REPLACE FUNCTION public.notify_reel_reaction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.vz_notify((SELECT creator_id FROM public.reels WHERE id = NEW.reel_id), NEW.user_id, 'like', public.vz_actor_name(NEW.user_id) || ' liked your Reel', NULL, jsonb_build_object('reel_id', NEW.reel_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reel_reactions_notify ON public.reel_reactions;
CREATE TRIGGER reel_reactions_notify AFTER INSERT ON public.reel_reactions FOR EACH ROW EXECUTE FUNCTION public.notify_reel_reaction();

CREATE OR REPLACE FUNCTION public.notify_reel_comment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.vz_notify((SELECT creator_id FROM public.reels WHERE id = NEW.reel_id), NEW.user_id, 'comment', public.vz_actor_name(NEW.user_id) || ' commented on your Reel', left(NEW.body, 80), jsonb_build_object('reel_id', NEW.reel_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reel_comments_notify ON public.reel_comments;
CREATE TRIGGER reel_comments_notify AFTER INSERT ON public.reel_comments FOR EACH ROW EXECUTE FUNCTION public.notify_reel_comment();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;