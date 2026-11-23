import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { safetyErrorMessage } from "@/lib/safety";

export const REPORT_REASONS = [
  { key: "spam", label: "Spam or scam" },
  { key: "harassment", label: "Bullying or harassment" },
  { key: "hate", label: "Hate speech" },
  { key: "sexual", label: "Nudity or sexual content" },
  { key: "violence", label: "Violence or threats" },
  { key: "self_harm", label: "Self-harm or suicide" },
  { key: "impersonation", label: "Pretending to be someone" },
  { key: "underage", label: "May be under 13" },
  { key: "other", label: "Something else" },
] as const;
export type ReportReason = typeof REPORT_REASONS[number]["key"];
export type ReportKind = "user" | "reel" | "chat";

export const myBlocksKey = (userId?: string) => ["my-blocks", userId] as const;

/** People I blocked (my own rows only). */
export function useMyBlocks(userId?: string) {
  return useQuery({
    queryKey: myBlocksKey(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_restrictions").select("target_id").eq("user_id", userId ?? "").eq("kind", "block");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.target_id));
    },
  });
}

export async function submitReport(reporterId: string, kind: ReportKind, targetId: string, reason: ReportReason): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("reports").insert({ reporter_id: reporterId, target_kind: kind, target_id: targetId, reason });
  if (error) return { ok: false, message: safetyErrorMessage(error) ?? "Report couldn't be sent. Try again." };
  return { ok: true };
}

export function useBlockActions(userId?: string) {
  const cache = useQueryClient();
  const key = myBlocksKey(userId);
  async function setBlocked(targetId: string, blocked: boolean): Promise<string | null> {
    if (!userId) return "Sign in to block people.";
    if (targetId === userId) return "You can't block yourself.";
    const before = cache.getQueryData<Set<string>>(key);
    const next = new Set(before ?? []);
    if (blocked) next.add(targetId); else next.delete(targetId);
    cache.setQueryData(key, next); // optimistic
    const { error } = blocked
      ? await supabase.from("user_restrictions").upsert({ user_id: userId, target_id: targetId, kind: "block" }, { onConflict: "user_id,target_id,kind" })
      : await supabase.from("user_restrictions").delete().eq("user_id", userId).eq("target_id", targetId).eq("kind", "block");
    if (error) { cache.setQueryData(key, before); return "That didn't save. Try again."; }
    if (blocked) {
      void supabase.from("social_connections").delete().eq("follower_id", userId).eq("following_id", targetId);
      void cache.invalidateQueries({ queryKey: ["reel-feed"] });
      void cache.invalidateQueries({ queryKey: ["direct-chats", userId] });
    }
    return null;
  }
  return { setBlocked };
}
