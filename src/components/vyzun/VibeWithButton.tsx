import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { useVyzun } from "@/lib/vyzun-store";
import { useVyzunSession } from "@/hooks/use-vyzun-session";
import { usePublicProfile, useVibeState } from "@/lib/social";
import { cn } from "@/lib/utils";

/**
 * Primary social action on another user's profile.
 * Default: "+ Vibe With" (cyan → purple → pink gradient)
 * Active: "Vibing"  ·  Removing: "Unvibing"
 * VYZUN terminology: Vibers = followers, Vibing = following.
 * Signed in: real Cloud connection with an instant (optimistic) toggle. Guests: device-only list.
 */
export function VibeWithButton({
  username,
  className,
}: {
  username: string;
  className?: string;
}) {
  const { state, update } = useVyzun();
  const { session } = useVyzunSession();
  const target = usePublicProfile(session ? username : undefined);
  const live = useVibeState(session?.user.id, target.data?.id);
  const [error, setError] = useState<string | null>(null);
  const isLive = !!session && !!target.data;
  const isVibing = isLive ? live.vibing : state.vibingWith.includes(username);
  const busy = isLive && live.toggle.isPending;

  function toggle() {
    setError(null);
    if (isLive) {
      live.toggle.mutate(!isVibing, { onError: () => setError("Couldn't update. Try again.") });
      return;
    }
    if (session && target.isSuccess && !target.data) { setError("This person isn't on VYZUN yet."); return; }
    update((s) => ({
      vibingWith: isVibing ? s.vibingWith.filter((u) => u !== username) : [...s.vibingWith, username],
    }));
  }

  const label = isVibing ? "Vibing" : "Vibe With";

  return (
    <button
      onClick={toggle}
      aria-pressed={isVibing}
      title={error ?? undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold tap active:tap-active",
        isVibing
          ? "border border-glass-border text-foreground"
          : "bg-gradient-vyzun text-primary-foreground",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : isVibing ? (
        <Check className="h-4 w-4 shrink-0" />
      ) : (
        <Plus className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate">{error ?? label}</span>
    </button>
  );
}
