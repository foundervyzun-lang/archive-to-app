CREATE OR REPLACE FUNCTION public.contains_blocked_words(_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(translate(lower(_text), '013457@$!', 'oieastasi'), '') ~*
    ('\m(f+u+c+k+\w*|motherf\w*|sh+i+t+(s|ty|tier|ting|head\w*|hole\w*)?|bullshit\w*|b+i+t+c+h+(es|y|ing)?|cunts?|dick(s|head\w*)?|cocks?|puss(y|ies)|assholes?|bastards?|whores?|sluts?|slutty|porn\w*|nudes?|nudity|blowjobs?|handjobs?|dildos?|rape|raped|rapes|raping|rapists?|nigg\w*|nigas?|fags?|faggots?|retard\w*|kys|chinks?|spics?|kikes?|trann(y|ies)|wetbacks?)\M'
     || '|kill\s+(yo)?ur\s*self')
$$;

CREATE OR REPLACE FUNCTION public.guard_blocked_words()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  col text;
  val text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    val := to_jsonb(NEW) ->> col;
    IF val IS NULL THEN CONTINUE; END IF;
    IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> col) IS NOT DISTINCT FROM val THEN CONTINUE; END IF;
    IF public.contains_blocked_words(val) THEN
      RAISE EXCEPTION 'profanity_blocked' USING ERRCODE = 'P0001', HINT = 'Please keep it clean.';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  n integer;
  lim integer := TG_ARGV[1]::integer;
  secs integer := TG_ARGV[2]::integer;
BEGIN
  uid := nullif(to_jsonb(NEW) ->> TG_ARGV[0], '')::uuid;
  IF uid IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1 AND created_at > now() - make_interval(secs => $2)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0])
    INTO n USING uid, secs;
  IF n >= lim THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001', HINT = 'Slow down and try again in a minute.';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_chat_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.chat_participants p
    JOIN public.user_restrictions r ON r.kind = 'block'
      AND ((r.user_id = p.user_id AND r.target_id = NEW.sender_id) OR (r.user_id = NEW.sender_id AND r.target_id = p.user_id))
    WHERE p.chat_id = NEW.chat_id AND p.user_id <> NEW.sender_id
  ) THEN
    RAISE EXCEPTION 'blocked' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS profiles_blocked_words ON public.profiles;
CREATE TRIGGER profiles_blocked_words BEFORE UPDATE OF bio, display_name, username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_blocked_words('bio', 'display_name', 'username');
DROP TRIGGER IF EXISTS reel_comments_blocked_words ON public.reel_comments;
CREATE TRIGGER reel_comments_blocked_words BEFORE INSERT OR UPDATE OF body ON public.reel_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_blocked_words('body');
DROP TRIGGER IF EXISTS secret_messages_blocked_words ON public.secret_messages;
CREATE TRIGGER secret_messages_blocked_words BEFORE INSERT ON public.secret_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_blocked_words('body');
DROP TRIGGER IF EXISTS secret_replies_blocked_words ON public.secret_replies;
CREATE TRIGGER secret_replies_blocked_words BEFORE INSERT ON public.secret_replies
  FOR EACH ROW EXECUTE FUNCTION public.guard_blocked_words('body');
DROP TRIGGER IF EXISTS vibe_feed_blocked_words ON public.vibe_feed;
CREATE TRIGGER vibe_feed_blocked_words BEFORE INSERT ON public.vibe_feed
  FOR EACH ROW EXECUTE FUNCTION public.guard_blocked_words('body');

DROP TRIGGER IF EXISTS chat_messages_rate_limit ON public.chat_messages;
CREATE TRIGGER chat_messages_rate_limit BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('sender_id', '30', '60');
DROP TRIGGER IF EXISTS reel_comments_rate_limit ON public.reel_comments;
CREATE TRIGGER reel_comments_rate_limit BEFORE INSERT ON public.reel_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('user_id', '10', '60');
DROP TRIGGER IF EXISTS secret_messages_rate_limit ON public.secret_messages;
CREATE TRIGGER secret_messages_rate_limit BEFORE INSERT ON public.secret_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('sender_id', '5', '60');
DROP TRIGGER IF EXISTS reports_rate_limit ON public.reports;
CREATE TRIGGER reports_rate_limit BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('reporter_id', '5', '60');

DROP TRIGGER IF EXISTS chat_messages_block_guard ON public.chat_messages;
CREATE TRIGGER chat_messages_block_guard BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_chat_block();

CREATE INDEX IF NOT EXISTS reports_reporter_time_idx ON public.reports (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS secret_messages_sender_time_idx ON public.secret_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creator_challenges_created_by_idx ON public.creator_challenges (created_by);
CREATE INDEX IF NOT EXISTS calls_chat_idx ON public.calls (chat_id);
CREATE INDEX IF NOT EXISTS affiliate_conversions_product_idx ON public.affiliate_conversions (product_id);
CREATE INDEX IF NOT EXISTS fan_subscriptions_creator_idx ON public.fan_subscriptions (creator_id);
CREATE INDEX IF NOT EXISTS creator_tiers_creator_idx ON public.creator_tiers (creator_id);
CREATE INDEX IF NOT EXISTS paid_interactions_creator_idx ON public.paid_interactions (creator_id);
CREATE INDEX IF NOT EXISTS paid_interactions_buyer_idx ON public.paid_interactions (buyer_id);
CREATE INDEX IF NOT EXISTS paid_interactions_payment_idx ON public.paid_interactions (payment_id);
CREATE INDEX IF NOT EXISTS brand_campaigns_owner_idx ON public.brand_campaigns (brand_owner_id);
CREATE INDEX IF NOT EXISTS campaign_applications_creator_idx ON public.campaign_applications (creator_id);
CREATE INDEX IF NOT EXISTS campaign_applications_reel_idx ON public.campaign_applications (submission_reel_id);
CREATE INDEX IF NOT EXISTS affiliate_products_creator_idx ON public.affiliate_products (creator_id);
CREATE INDEX IF NOT EXISTS challenge_submissions_creator_idx ON public.challenge_submissions (creator_id);
CREATE INDEX IF NOT EXISTS challenge_submissions_reel_idx ON public.challenge_submissions (reel_id);
CREATE INDEX IF NOT EXISTS sponsored_content_campaign_idx ON public.sponsored_content (campaign_id);
CREATE INDEX IF NOT EXISTS sponsored_content_reel_idx ON public.sponsored_content (reel_id);
CREATE INDEX IF NOT EXISTS verification_requests_user_idx ON public.verification_requests (user_id);
CREATE INDEX IF NOT EXISTS moderation_actions_report_idx ON public.moderation_actions (report_id);
CREATE INDEX IF NOT EXISTS moderation_actions_moderator_idx ON public.moderation_actions (moderator_id);
CREATE INDEX IF NOT EXISTS moderation_actions_affected_idx ON public.moderation_actions (affected_user_id);
CREATE INDEX IF NOT EXISTS appeals_action_idx ON public.appeals (action_id);
CREATE INDEX IF NOT EXISTS appeals_user_idx ON public.appeals (user_id);