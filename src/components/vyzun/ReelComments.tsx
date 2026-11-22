import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ChatAvatar } from "@/components/vyzun/ChatAvatar";
import { supabase } from "@/integrations/supabase/client";
import { postReelComment } from "@/lib/message-safety.functions";

type Comment = { id: string; body: string; user_id: string; created_at: string; username?: string | undefined; avatar_url?: string | null | undefined; status?: "sending" | undefined };

function ago(ts: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

export const reelCommentsKey = (reelId: string | null) => ["reel-comments", reelId] as const;

/** Live comments for one Reel with optimistic posting (shows instantly, rolls back if refused). */
export function ReelComments({ reelId, userId, username, avatarUrl, creatorId, onClose, onSignIn, onDelta }: {
  reelId: string | null; userId?: string; username?: string; avatarUrl?: string | null; creatorId?: string;
  onClose: () => void; onSignIn: () => void; onDelta: (reelId: string, delta: number) => void;
}) {
  const cache = useQueryClient();
  const post = useServerFn(postReelComment);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const comments = useQuery({
    queryKey: reelCommentsKey(reelId), enabled: !!reelId, staleTime: 15_000,
    queryFn: async (): Promise<Comment[]> => {
      const { data, error: e } = await supabase.from("reel_comments").select("id,body,user_id,created_at").eq("reel_id", reelId ?? "").order("created_at", { ascending: false }).limit(100);
      if (e) throw e;
      const ids = [...new Set((data ?? []).map(c => c.user_id))];
      const { data: people } = ids.length ? await supabase.from("profiles").select("id,username,avatar_url").in("id", ids) : { data: [] };
      return (data ?? []).map(c => { const p = people?.find(x => x.id === c.user_id); return { ...c, username: p?.username, avatar_url: p?.avatar_url ?? null }; });
    },
  });

  async function submit() {
    const body = draft.trim();
    if (!body || !reelId) return;
    if (!userId) { onSignIn(); return; }
    setError(null);
    const id = crypto.randomUUID();
    const key = reelCommentsKey(reelId);
    cache.setQueryData<Comment[]>(key, prev => [{ id, body, user_id: userId, created_at: new Date().toISOString(), username, avatar_url: avatarUrl ?? null, status: "sending" }, ...(prev ?? [])]);
    onDelta(reelId, 1);
    setDraft("");
    try {
      const result = await post({ data: { id, reelId, body } });
      if (!result.ok) throw new Error(result.message);
      cache.setQueryData<Comment[]>(key, prev => (prev ?? []).map(c => (c.id === id ? { ...c, status: undefined } : c)));
    } catch (e) {
      cache.setQueryData<Comment[]>(key, prev => (prev ?? []).filter(c => c.id !== id));
      onDelta(reelId, -1);
      setDraft(body);
      setError(e instanceof Error && e.message ? e.message : "Your comment wasn't posted. Try again.");
    }
  }

  async function remove(id: string) {
    if (!reelId) return;
    const key = reelCommentsKey(reelId);
    const before = cache.getQueryData<Comment[]>(key);
    cache.setQueryData<Comment[]>(key, prev => (prev ?? []).filter(c => c.id !== id));
    onDelta(reelId, -1);
    const { error: e } = await supabase.from("reel_comments").delete().eq("id", id);
    if (e) { cache.setQueryData(key, before); onDelta(reelId, 1); setError("Couldn't delete that comment."); }
  }

  const list = comments.data ?? [];
  return (
    <Drawer open={!!reelId} onOpenChange={open => { if (!open) { setError(null); onClose(); } }} shouldScaleBackground={false}>
      <DrawerContent className="max-h-[75dvh]">
        <DrawerHeader><DrawerTitle>Comments{list.length ? ` · ${list.length}` : ""}</DrawerTitle><DrawerDescription>Kind words only — every comment is AI safety-checked.</DrawerDescription></DrawerHeader>
        <div className="min-h-24 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {comments.isLoading && <div role="status" aria-label="Loading comments" className="h-12 animate-pulse rounded-xl bg-muted" />}
          {comments.isError && <p role="alert" className="text-center text-sm text-muted-foreground">Comments couldn't load. <button className="text-cyan underline" onClick={() => void comments.refetch()}>Retry</button></p>}
          {comments.isSuccess && !list.length && <div className="flex flex-col items-center gap-2 py-4 text-center"><MessageSquare className="h-8 w-8 text-cyan" /><p className="text-sm text-muted-foreground">No comments yet. Be the first!</p></div>}
          {list.map(c => (
            <div key={c.id} className={c.status ? "flex gap-2.5 opacity-60" : "flex gap-2.5"}>
              <ChatAvatar username={c.username} avatarUrl={c.avatar_url ?? null} className="h-8 w-8 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">@{c.username ?? "viber"} <span className="font-normal text-muted-foreground">· {c.status ? "posting…" : ago(c.created_at)}</span></p>
                <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
              {!c.status && (c.user_id === userId || creatorId === userId) && userId && <Button variant="ghost" size="icon" aria-label="Delete comment" className="h-8 w-8 shrink-0" onClick={() => void remove(c.id)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
        </div>
        {error && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p>}
        <form className="flex gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} aria-label="Add a comment" placeholder={userId ? "Add a comment…" : "Sign in to comment"} maxLength={300} className="min-w-0 flex-1 rounded-full border border-glass-border bg-transparent px-4 py-2 text-sm outline-none" />
          <Button type="submit" size="icon" className="rounded-full bg-gradient-secret" aria-label="Post comment" disabled={!!userId && !draft.trim()}>{comments.isFetching && !comments.isLoading ? <Loader2 className="animate-spin" /> : <Send />}</Button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
