-- 1. Secrets: 24h expiry
ALTER TABLE public.secret_messages ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours');
UPDATE public.secret_messages SET expires_at = created_at + interval '24 hours';
DROP POLICY IF EXISTS "secrets recipient read" ON public.secret_messages;
CREATE POLICY "secrets recipient read" ON public.secret_messages FOR SELECT TO authenticated
  USING ((recipient_id = auth.uid() AND expires_at > now()) OR public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS secret_messages_recipient_expiry_idx ON public.secret_messages (recipient_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS secret_messages_sender_idx ON public.secret_messages (sender_id);
CREATE INDEX IF NOT EXISTS secret_replies_message_idx ON public.secret_replies (message_id, created_at);
CREATE INDEX IF NOT EXISTS secret_replies_author_idx ON public.secret_replies (author_id);

-- 2. Reel comments
CREATE TABLE public.reel_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reel_comments TO anon;
GRANT SELECT, INSERT, DELETE ON public.reel_comments TO authenticated;
GRANT ALL ON public.reel_comments TO service_role;
ALTER TABLE public.reel_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments read visible reels" ON public.reel_comments FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.reels r WHERE r.id = reel_id));
CREATE POLICY "comments insert own" ON public.reel_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.reels r WHERE r.id = reel_id AND r.is_published AND r.moderation_state = 'approved')
    AND NOT EXISTS (
      SELECT 1 FROM public.reels r JOIN public.user_restrictions ur ON ur.user_id = r.creator_id
      WHERE r.id = reel_id AND ur.target_id = auth.uid() AND ur.kind = 'block'
    )
  );
CREATE POLICY "comments delete own or creator" ON public.reel_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.reels r WHERE r.id = reel_id AND r.creator_id = auth.uid()));
CREATE INDEX reel_comments_reel_idx ON public.reel_comments (reel_id, created_at DESC);
CREATE INDEX reel_comments_user_idx ON public.reel_comments (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reel_comment_counts(_reel_ids uuid[])
RETURNS TABLE(reel_id uuid, comments bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$ SELECT c.reel_id, count(*)::bigint FROM public.reel_comments c WHERE c.reel_id = ANY(_reel_ids) GROUP BY c.reel_id $$;
GRANT EXECUTE ON FUNCTION public.reel_comment_counts(uuid[]) TO anon, authenticated;

-- 3. Campus Map pins (one active pin per person, 24h)
CREATE TABLE public.campus_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  emoji text NOT NULL DEFAULT '📍' CHECK (char_length(emoji) BETWEEN 1 AND 8),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 80),
  x numeric(5,2) NOT NULL CHECK (x BETWEEN 4 AND 96),
  y numeric(5,2) NOT NULL CHECK (y BETWEEN 4 AND 96),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.campus_pins TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campus_pins TO authenticated;
GRANT ALL ON public.campus_pins TO service_role;
ALTER TABLE public.campus_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pins read active" ON public.campus_pins FOR SELECT TO anon, authenticated
  USING (expires_at > now() OR user_id = auth.uid());
CREATE POLICY "pins insert own" ON public.campus_pins FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "pins update own" ON public.campus_pins FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "pins delete own" ON public.campus_pins FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX campus_pins_expiry_idx ON public.campus_pins (expires_at DESC);

-- Every (re)pin restarts its 24h window; clients cannot extend it arbitrarily.
CREATE OR REPLACE FUNCTION public.campus_pin_window()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.created_at := now();
  NEW.expires_at := now() + interval '24 hours';
  RETURN NEW;
END $$;
CREATE TRIGGER campus_pins_window BEFORE INSERT OR UPDATE ON public.campus_pins
  FOR EACH ROW EXECUTE FUNCTION public.campus_pin_window();

-- 4. Direct chats
CREATE OR REPLACE FUNCTION public.start_direct_chat(_username text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _other uuid;
  _pref text;
  _chat uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT id INTO _other FROM public.profiles WHERE lower(username) = lower(btrim(_username)) LIMIT 1;
  IF _other IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF _other = _me THEN RAISE EXCEPTION 'cannot_message_self'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_restrictions WHERE kind = 'block'
             AND ((user_id = _other AND target_id = _me) OR (user_id = _me AND target_id = _other))) THEN
    RAISE EXCEPTION 'not_accepting';
  END IF;
  SELECT c.id INTO _chat FROM public.chats c
    JOIN public.chat_participants a ON a.chat_id = c.id AND a.user_id = _me
    JOIN public.chat_participants b ON b.chat_id = c.id AND b.user_id = _other
    WHERE c.kind = 'direct' LIMIT 1;
  IF _chat IS NOT NULL THEN RETURN _chat; END IF;
  SELECT who_can_message INTO _pref FROM public.user_preferences WHERE user_id = _other;
  IF _pref = 'nobody' THEN RAISE EXCEPTION 'not_accepting'; END IF;
  IF _pref = 'vibers' AND NOT EXISTS (SELECT 1 FROM public.social_connections
       WHERE follower_id = _other AND following_id = _me AND state = 'active') THEN
    RAISE EXCEPTION 'vibers_only';
  END IF;
  INSERT INTO public.chats (kind, created_by) VALUES ('direct', _me) RETURNING id INTO _chat;
  INSERT INTO public.chat_participants (chat_id, user_id) VALUES (_chat, _me), (_chat, _other);
  RETURN _chat;
END $$;
REVOKE ALL ON FUNCTION public.start_direct_chat(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_direct_chat(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bump_chat_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.chats SET last_message_at = NEW.created_at WHERE id = NEW.chat_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bump_chat_activity() FROM public, anon, authenticated;
CREATE TRIGGER chat_messages_bump AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_chat_activity();

-- 5. Live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.campus_pins;

-- 6. Speed indexes on links and timestamps
CREATE INDEX IF NOT EXISTS chat_participants_user_idx ON public.chat_participants (user_id, chat_id);
CREATE INDEX IF NOT EXISTS chats_activity_idx ON public.chats (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS chats_created_by_idx ON public.chats (created_by);
CREATE INDEX IF NOT EXISTS chat_messages_sender_idx ON public.chat_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_unread_idx ON public.chat_messages (chat_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_messages_reply_idx ON public.chat_messages (reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS reel_reactions_user_idx ON public.reel_reactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reels_live_feed_idx ON public.reels (created_at DESC) WHERE is_published AND moderation_state = 'approved';
CREATE INDEX IF NOT EXISTS reels_trending_idx ON public.reels (views_count DESC) WHERE is_published AND moderation_state = 'approved';
CREATE INDEX IF NOT EXISTS social_follower_idx ON public.social_connections (follower_id, state);
CREATE INDEX IF NOT EXISTS user_restrictions_pair_idx ON public.user_restrictions (user_id, target_id, kind);
CREATE INDEX IF NOT EXISTS user_restrictions_target_idx ON public.user_restrictions (target_id, kind);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON public.notifications (user_id) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS vibe_feed_created_idx ON public.vibe_feed (created_at DESC);
CREATE INDEX IF NOT EXISTS vibe_feed_author_idx ON public.vibe_feed (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_reactions_user_idx ON public.feed_reactions (user_id);
CREATE INDEX IF NOT EXISTS crush_selections_crush_idx ON public.crush_selections (crush_id);
CREATE INDEX IF NOT EXISTS calls_caller_idx ON public.calls (caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_callee_idx ON public.calls (callee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aura_cards_scan_idx ON public.aura_cards (scan_id);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON public.reports (reporter_id);
CREATE INDEX IF NOT EXISTS profiles_created_idx ON public.profiles (created_at DESC);