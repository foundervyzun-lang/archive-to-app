import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PROFILE_FIELDS, type VyzunProfile } from "@/hooks/use-vyzun-session";

export const publicProfileKey = (username?: string) => ["public-profile", username?.toLowerCase()] as const;

/** Another person's public Cloud profile, looked up by username. */
export function usePublicProfile(username?: string) {
  return useQuery({
    queryKey: publicProfileKey(username),
    enabled: !!username,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select(PROFILE_FIELDS).ilike("username", (username ?? "").replace(/[%_]/g, "")).maybeSingle();
      if (error) throw error;
      return (data as VyzunProfile | null) ?? null;
    },
  });
}

/** Whether I vibe with `targetId`. Follow rows are only readable by their owner. */
export function useVibeState(myId?: string, targetId?: string) {
  const cache = useQueryClient();
  const key = ["vibing", myId, targetId] as const;
  const state = useQuery({
    queryKey: key,
    enabled: !!myId && !!targetId && myId !== targetId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("social_connections").select("id").eq("follower_id", myId ?? "").eq("following_id", targetId ?? "").maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (!myId || !targetId) throw new Error("not_signed_in");
      const { error } = next
        ? await supabase.from("social_connections").upsert({ follower_id: myId, following_id: targetId, state: "active" }, { onConflict: "follower_id,following_id" })
        : await supabase.from("social_connections").delete().eq("follower_id", myId).eq("following_id", targetId);
      if (error) throw error;
    },
    // Optimistic: flip instantly, roll back on failure.
    onMutate: async (next) => {
      await cache.cancelQueries({ queryKey: key });
      const previous = cache.getQueryData<boolean>(key);
      cache.setQueryData(key, next);
      return { previous };
    },
    onError: (_e, _next, ctx) => cache.setQueryData(key, ctx?.previous ?? false),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ["my-profile"] });
      void cache.invalidateQueries({ queryKey: ["public-profile"] });
      void cache.invalidateQueries({ queryKey: ["reel-feed"] });
    },
  });
  return { vibing: state.data ?? false, ready: state.isSuccess, toggle };
}

/** Opens (or reuses) a private 1:1 chat. Returns the chat id or a friendly error. */
export async function startDirectChat(username: string): Promise<{ chatId: string } | { error: string }> {
  const { data, error } = await supabase.rpc("start_direct_chat", { _username: username });
  if (error || !data) {
    const msg = error?.message ?? "";
    if (msg.includes("user_not_found")) return { error: "That person isn't on VYZUN yet." };
    if (msg.includes("cannot_message_self")) return { error: "That's you! Pick someone else to chat with." };
    if (msg.includes("vibers_only")) return { error: "This person only accepts messages from people they vibe with." };
    if (msg.includes("not_accepting")) return { error: "This person isn't accepting messages." };
    if (msg.includes("not_signed_in")) return { error: "Sign in to start a chat." };
    return { error: "The chat couldn't open. Please try again." };
  }
  return { chatId: data };
}
