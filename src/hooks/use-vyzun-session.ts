import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type VyzunProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  is_verified: boolean;
  is_private: boolean;
  vibers_count: number;
  vibing_count: number;
  language: string;
  currency: string;
  country_code: string | null;
};

export const PROFILE_FIELDS = "id, username, display_name, bio, avatar_url, is_verified, is_private, vibers_count, vibing_count, language, currency, country_code";
export const myProfileKey = (userId?: string) => ["my-profile", userId] as const;

/**
 * Real Cloud session + profile. Guest users get `session === null` and keep
 * using local state; nothing here fabricates an authenticated state.
 * The profile is cached in React Query so every screen shares one fetch and edits refresh everywhere.
 */
export function useVyzunSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setSession(next ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;
  const profile = useQuery({
    queryKey: myProfileKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select(PROFILE_FIELDS).eq("id", userId ?? "").maybeSingle();
      if (error) throw error;
      return (data as VyzunProfile | null) ?? null;
    },
  });

  return { session, profile: userId ? (profile.data ?? null) : null, loading, isAuthenticated: !!session };
}
