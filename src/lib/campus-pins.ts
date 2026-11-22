import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CampusPin = { id: string; user_id: string; emoji: string; note: string; x: number; y: number; expires_at: string; username?: string | undefined; avatar_url?: string | null | undefined; pending?: boolean | undefined };

export const PIN_EMOJIS = ["📍", "✨", "🔥", "💜", "👀", "🎧", "📚", "☕", "🏀", "🎉"] as const;
export const campusPinsKey = ["campus-pins"] as const;

/** Clamp a tap position (percent of the map) into the allowed pin area. */
export function clampPinPosition(value: number) {
  return Math.round(Math.min(96, Math.max(4, value)) * 100) / 100;
}

/** Live pins: initial load plus realtime refresh whenever anyone drops, moves or removes a pin. */
export function useCampusPins() {
  const cache = useQueryClient();
  const pins = useQuery({
    queryKey: campusPinsKey,
    staleTime: 30_000,
    refetchInterval: 5 * 60_000, // drops pins that pass their 24h window
    queryFn: async (): Promise<CampusPin[]> => {
      const { data, error } = await supabase.from("campus_pins").select("id,user_id,emoji,note,x,y,expires_at").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(60);
      if (error) throw error;
      const ids = [...new Set((data ?? []).map(p => p.user_id))];
      const { data: people } = ids.length ? await supabase.from("profiles").select("id,username,avatar_url").in("id", ids) : { data: [] };
      return (data ?? []).map(p => {
        const person = people?.find(x => x.id === p.user_id);
        return { ...p, x: Number(p.x), y: Number(p.y), username: person?.username, avatar_url: person?.avatar_url ?? null };
      });
    },
  });
  useEffect(() => {
    const channel = supabase
      .channel(`campus-pins-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campus_pins" }, () => { void cache.invalidateQueries({ queryKey: campusPinsKey }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [cache]);
  return pins;
}
