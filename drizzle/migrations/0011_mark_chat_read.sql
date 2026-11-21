CREATE OR REPLACE FUNCTION public.mark_chat_read(_chat_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.chat_messages SET read_at = now()
  WHERE chat_id = _chat_id AND read_at IS NULL AND sender_id <> auth.uid()
    AND public.is_chat_member(_chat_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.mark_chat_read(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_chat_read(uuid) TO authenticated;