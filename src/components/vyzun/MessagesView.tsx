import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, BadgeCheck, Crown, MapPin, Phone, ScanFace, Search, Send, Video } from "lucide-react";
import { Logo } from "./Logo";
import { ChatAvatar } from "@/components/vyzun/ChatAvatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useVyzunSession } from "@/hooks/use-vyzun-session";
import { askVyzunAI } from "@/lib/companion.functions";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { NAV_DESTINATIONS, parseNavIntent, type NavTarget } from "@/lib/vyzun-nav";
import { startDirectChat } from "@/lib/social";
import { ChatComposer } from "./ChatComposer";
import { ActionDialog } from "./ActionDialog";
import { PaidActionSheet, type PaidAction } from "./PaidActionSheet";
import { GUIDE_ANSWERS, GUIDE_STARTERS, type GuideAction } from "@/lib/vyzun-guide";

const VIP_HALO: PaidAction = { title: "VIP Halo", price: "$4.99/mo", description: "A glowing VIP Halo on your Campus Map pin and profile. It appears only after a verified payment." };

function GuideActions({ actions, onHalo }: { actions: GuideAction[]; onHalo: () => void }) {
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick actions">{actions.map(action => {
    if (action === "map") return <Button key={action} asChild size="sm" variant="aiCta"><Link to="/secrets" search={{ tab: "map" }}><MapPin />Open Campus Map</Link></Button>;
    if (action === "scan") return <Button key={action} asChild size="sm" variant="aiCta"><Link to="/"><ScanFace />Scan Face Now</Link></Button>;
    if (action === "halo") return <Button key={action} size="sm" variant="aiCtaPremium" onClick={onHalo}><Crown />Buy VIP Halo</Button>;
    if (action === "reels") return <Button key={action} asChild size="sm" variant="aiCta"><Link to="/reels" search={{}}>Open Reels</Link></Button>;
    return <Button key={action} asChild size="sm" variant="aiCta"><Link to="/secrets" search={{}}>Open Secrets</Link></Button>;
  })}</div>;
}

const TASKS = [{ key: "guide", label: "App guide" }, { key: "hooks", label: "Video hooks" }, { key: "scripts", label: "Scripts" }, { key: "bio", label: "Bio" }, { key: "safety", label: "Brand safety" }] as const;
type Task = typeof TASKS[number]["key"];

const ICEBREAKERS = GUIDE_STARTERS;

type ChatRow = { id: string; kind: string; last_message_at: string | null };
type ChatMsg = { id: string; body: string | null; sender_id: string; created_at: string; status?: "sending" | "failed" };
type PeopleMap = Record<string, { username: string; avatar_url: string | null }>;

function ago(ts: string | null) {
  if (!ts) return "";
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Shared full-screen and sheet content. No fabricated threads, unread counts or delivery states. */
export function MessagesView({ startWith }: { startWith?: string } = {}) {
  const { session } = useVyzunSession();
  const ask = useServerFn(askVyzunAI);
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [task, setTask] = useState<Task>("guide");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [answers, setAnswers] = useState<{ prompt: string; text: string; actions?: GuideAction[]; nav?: NavTarget }[]>([]);
  const [search, setSearch] = useState("");
  const [battle, setBattle] = useState(false);
  const [paid, setPaid] = useState<PaidAction | null>(null);
  const threads = useQuery({
    queryKey: ["direct-chats", session?.user.id], enabled: !!session, retry: 1, staleTime: 15_000,
    queryFn: async () => {
      const uid = session?.user.id ?? "";
      const { data: chatRows, error } = await supabase.from("chats").select("id,kind,last_message_at").order("last_message_at", { ascending: false }).limit(30);
      if (error) throw error;
      const chats: ChatRow[] = chatRows ?? [];
      const ids = chats.map(chat => chat.id);
      if (!ids.length) return { chats, people: {} as PeopleMap, unread: {} as Record<string, number> };
      const [participants, unreadRows] = await Promise.all([
        supabase.from("chat_participants").select("chat_id,user_id").in("chat_id", ids).neq("user_id", uid),
        supabase.from("chat_messages").select("chat_id").in("chat_id", ids).neq("sender_id", uid).is("read_at", null).limit(500),
      ]);
      if (participants.error) throw participants.error;
      if (unreadRows.error) throw unreadRows.error;
      const memberIds = [...new Set((participants.data ?? []).map(row => row.user_id))];
      const { data: profiles, error: profileError } = memberIds.length
        ? await supabase.from("profiles").select("id,username,avatar_url").in("id", memberIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const people: PeopleMap = {};
      for (const row of participants.data ?? []) {
        const profile = profiles?.find(item => item.id === row.user_id);
        if (profile) people[row.chat_id] = { username: profile.username, avatar_url: profile.avatar_url };
      }
      const unread: Record<string, number> = {};
      for (const row of unreadRows.data ?? []) unread[row.chat_id] = (unread[row.chat_id] ?? 0) + 1;
      return { chats, people, unread };
    },
  });
  const chatKey = (chatId: string | null) => ["direct-chat", session?.user.id, chatId] as const;
  const messages = useQuery({ queryKey: chatKey(active), enabled: !!session && !!active && active !== "ai", retry: 1, staleTime: Infinity,
    queryFn: async (): Promise<ChatMsg[]> => {
      const { data, error } = await supabase.from("chat_messages").select("id,body,sender_id,created_at").eq("chat_id", active ?? "").is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []).reverse();
    },
  });

  // Open a chat requested from a profile ("Message" button).
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!startWith || !session || started.current === startWith) return;
    started.current = startWith;
    void startDirectChat(startWith).then(result => {
      if ("error" in result) { setNotice(result.error); return; }
      setActive(result.chatId);
      void cache.invalidateQueries({ queryKey: ["direct-chats", session.user.id] });
    });
  }, [startWith, session, cache]);

  // Live delivery: one subscription; RLS only streams messages from my own chats.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    const channel = supabase
      .channel(`chat-messages-${uid}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const row = payload.new as ChatMsg & { chat_id: string };
        cache.setQueryData<ChatMsg[]>(["direct-chat", uid, row.chat_id], (prev) => {
          if (!prev) return prev;
          if (prev.some(m => m.id === row.id)) return prev.map(m => (m.id === row.id ? { ...m, status: undefined } : m));
          return [...prev, { id: row.id, body: row.body, sender_id: row.sender_id, created_at: row.created_at }];
        });
        void cache.invalidateQueries({ queryKey: ["direct-chats", uid] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session?.user.id, cache]);

  // Mark received messages read while the chat is open.
  const lastId = messages.data?.[messages.data.length - 1]?.id;
  useEffect(() => {
    if (!session || !active || active === "ai" || !lastId) return;
    void supabase.rpc("mark_chat_read", { _chat_id: active }).then(() => cache.invalidateQueries({ queryKey: ["direct-chats", session.user.id] }));
  }, [session, active, lastId, cache]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [lastId, answers.length, active]);

  /** Optimistic send: shows instantly, confirms on save, marks failed on error. */
  async function sendChat(text: string): Promise<boolean> {
    const uid = session?.user.id;
    if (!uid || !active || active === "ai") return false;
    const chatId = active;
    const id = crypto.randomUUID();
    const optimistic: ChatMsg = { id, body: text, sender_id: uid, created_at: new Date().toISOString(), status: "sending" };
    cache.setQueryData<ChatMsg[]>(chatKey(chatId), prev => [...(prev ?? []), optimistic]);
    const { error } = await supabase.from("chat_messages").insert({ id, chat_id: chatId, sender_id: uid, body: text });
    cache.setQueryData<ChatMsg[]>(chatKey(chatId), prev => (prev ?? []).map(m => (m.id === id ? { ...m, status: error ? "failed" : undefined } : m)));
    if (!error) void cache.invalidateQueries({ queryKey: ["direct-chats", uid] });
    return !error;
  }

  async function retry(message: ChatMsg) {
    if (!active) return;
    cache.setQueryData<ChatMsg[]>(chatKey(active), prev => (prev ?? []).filter(m => m.id !== message.id));
    await sendChat(message.body ?? "");
  }

  function goTo(target: NavTarget) {
    const dest = NAV_DESTINATIONS[target];
    window.setTimeout(() => { void navigate({ to: dest.to, search: (dest.search ?? {}) as never }); }, 650);
  }

  const visibleChats = useMemo(() => {
    const query = search.trim().toLowerCase();
    const chats = threads.data?.chats ?? [];
    if (!query) return chats;
    return chats.filter(chat => (threads.data?.people[chat.id]?.username ?? "").toLowerCase().includes(query));
  }, [search, threads.data]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    setNotice(null);
    // Smart Action Navigation: obvious "take me to…" requests route instantly, even for guests.
    const intent = parseNavIntent(prompt);
    if (intent) {
      setAnswers(items => [...items, { prompt, text: `Taking you to ${NAV_DESTINATIONS[intent].label} ✨`, nav: intent }]);
      setDraft("");
      goTo(intent);
      return;
    }
    if (!session) { setNotice("Sign in to talk with VYZUN AI."); return; }
    setBusy(true);
    try {
      const history = answers.slice(-4).flatMap(a => [{ role: "user" as const, content: a.prompt.slice(0, 2000) }, { role: "assistant" as const, content: a.text.slice(0, 2000) }]);
      const result = await ask({ data: { prompt, context: task, history } });
      if (result.ok) {
        setAnswers(items => [...items, { prompt, text: result.text, ...(result.navigate ? { nav: result.navigate } : {}) }]);
        setDraft("");
        if (result.navigate) goTo(result.navigate);
      }
      else setNotice(result.text);
    } catch { setNotice("VYZUN AI could not connect. Your prompt is still here."); }
    finally { setBusy(false); }
  }

  function openAI(prompt?: string) {
    setActive("ai");
    setNotice(null);
    if (!prompt) return;
    const guide = GUIDE_ANSWERS[prompt as keyof typeof GUIDE_ANSWERS];
    if (guide) { setTask("guide"); setAnswers(items => [...items, { prompt, text: guide.text, actions: guide.actions }]); }
    else setDraft(prompt);
  }

  return <section className="space-y-4">
    {!active ? <>
      <button onClick={() => openAI()} className="glass-card relative w-full p-4 text-left shadow-[var(--glow-neon)] tap active:tap-active">
        <span aria-hidden className="bg-gradient-secret absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider text-primary-foreground">PINNED ›</span>
        <div className="flex items-center gap-3">
          <Logo className="h-14 w-14 shrink-0 rounded-[24%] object-cover" />
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold">✨ VYZUN AI <BadgeCheck className="h-4 w-4 text-cyan" /></span>
            <span className="block text-xs text-muted-foreground">Verified Vibe Guide · always pinned first</span>
          </span>
        </div>
      </button>
      <div className="flex flex-wrap gap-2" aria-label="Icebreaker prompts">{ICEBREAKERS.map(prompt => <button key={prompt} onClick={() => openAI(prompt)} className="rounded-full border border-glass-border px-3 py-1.5 text-xs tap active:tap-active hover:border-cyan/60">{prompt}</button>)}</div>
      <label className="flex items-center gap-2 rounded-xl border border-glass-border px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" aria-label="Search chats" maxLength={30} className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>
      {!session && <p className="text-sm text-muted-foreground">Sign in to see your private chats.</p>}
      {threads.isLoading && <div role="status" aria-label="Loading chats" className="h-16 animate-pulse rounded-xl bg-muted" />}
      {threads.isError && <div role="alert" className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Your chats couldn’t connect.</p><Button variant="outline" onClick={() => void threads.refetch()}>Retry</Button></div>}
      {session && threads.isSuccess && visibleChats.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{search.trim() ? "No chats match that name." : "No active chats yet."}</p>}
      {visibleChats.map((thread, i) => {
        const person = threads.data?.people[thread.id];
        const unread = threads.data?.unread[thread.id] ?? 0;
        return <Button key={thread.id} variant="outline" onClick={() => { setActive(thread.id); setNotice(null); }} className="h-auto w-full justify-start gap-3 p-3">
          <ChatAvatar username={person?.username} avatarUrl={person?.avatar_url} />
          <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{person?.username ? `@${person.username}` : `Private chat ${i + 1}`}</span>{thread.last_message_at && <span className="block text-[11px] text-muted-foreground">Active {ago(thread.last_message_at)} ago</span>}</span>
          {unread > 0 && <span aria-label={`${unread} unread`} className="bg-gradient-secret grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-primary-foreground">{unread > 9 ? "9+" : unread}</span>}
        </Button>;
      })}
    </> : <>
      <div className="flex items-center justify-between gap-3"><Button variant="ghost" size="sm" onClick={() => { setActive(null); setNotice(null); }}><ArrowLeft className="h-4 w-4" />All chats</Button><h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">{active === "ai" ? <><Logo className="h-9 w-9 shrink-0 rounded-[24%] object-cover" /><span className="truncate">VYZUN AI</span></> : <><ChatAvatar username={threads.data?.people[active]?.username} avatarUrl={threads.data?.people[active]?.avatar_url} className="h-9 w-9 text-sm" /><span className="truncate">{threads.data?.people[active]?.username ? `@${threads.data.people[active]!.username}` : "Private chat"}</span></>}</h2>{active !== "ai" && <div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Audio call" onClick={() => setNotice("Calling is not connected yet. No call was placed.")}><Phone className="h-4 w-4" /></Button><Button variant="outline" size="icon" aria-label="Video call" onClick={() => setNotice("Video calling is not connected yet. No call was placed.")}><Video className="h-4 w-4" /></Button></div>}</div>
      {active === "ai" ? <>
        <div className="chat-ambience rounded-lg border border-magenta/30 p-4"><p className="text-sm leading-relaxed">Hey, I’m VYZUN AI ✨ your Verified Vibe Guide. Ask me anything — or say “take me to the map”, “open reels” or “go to my profile” and I’ll take you there.</p><div className="mt-3 flex flex-wrap gap-2">{ICEBREAKERS.map(prompt => <Button key={prompt} size="sm" variant="outline" className="h-auto whitespace-normal rounded-full text-left text-xs" onClick={() => openAI(prompt)}>{prompt}</Button>)}</div><GuideActions actions={["map", "scan", "halo"]} onHalo={() => setPaid(VIP_HALO)} /></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="AI task">{TASKS.map(t => <Button key={t.key} size="sm" variant={task === t.key ? "default" : "outline"} onClick={() => setTask(t.key)}>{t.label}</Button>)}</div>
        <div className="min-h-40 space-y-4" aria-live="polite">{answers.map((answer, i) => <div key={i} className="space-y-2"><p className="ml-auto max-w-[90%] rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground">{answer.prompt}</p><div className="rounded-xl border border-glass-border px-4 py-3"><p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.text}</p>{answer.actions && <GuideActions actions={answer.actions} onHalo={() => setPaid(VIP_HALO)} />}{answer.nav && <Button size="sm" variant="aiCta" className="mt-3" onClick={() => goTo(answer.nav!)}>Open {NAV_DESTINATIONS[answer.nav].label}</Button>}</div></div>)}{busy && <p role="status" className="animate-pulse text-sm text-cyan">VYZUN AI is thinking…</p>}<div ref={bottom} /></div>
        <form onSubmit={e => { e.preventDefault(); void send(); }} className="flex items-end gap-2"><textarea value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} rows={2} aria-label="Message VYZUN AI" placeholder={task === "guide" ? "Ask anything — or say “open reels”…" : "What are you creating?"} className="min-w-0 flex-1 resize-none rounded-xl border border-glass-border bg-background px-3 py-2 text-sm" /><Button type="submit" aria-label="Send to VYZUN AI" disabled={busy || !draft.trim()} className="bg-gradient-secret h-11 w-11 shrink-0 p-0"><Send className="h-4 w-4" /></Button></form>
      </> : <>
        <div className="chat-ambience rounded-lg border border-cyan/30 p-3"><p className="text-xs font-semibold text-cyan">Aura Match · —</p><div className="mt-2 h-1 rounded-full bg-muted" /><p className="mt-2 text-[11px] text-muted-foreground">Compatibility needs both participants’ shared Aura Cards.</p></div>
        <Button variant="outline" className="h-auto w-full whitespace-normal border-magenta/40 py-3" onClick={() => setPaid({ title: "Instant Identity Unmask", price: "$4.99", description: "Identity is revealed only with both participants’ consent and verified payment. No verified mutual match is available." })}>$4.99 · Instant Identity Unmask</Button>
        {messages.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading messages…</p>}
        {messages.isError && <p role="alert" className="text-sm text-destructive">Messages could not be loaded.</p>}
        {messages.isSuccess && messages.data.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Say hi 👋 Messages arrive live.</p>}
        <div className="space-y-2" aria-live="polite">{messages.data?.map(message => {
          const mine = message.sender_id === session?.user.id;
          return <div key={message.id} className={cn("flex max-w-[90%] flex-col", mine && "ml-auto items-end")}>
            <p className={cn("whitespace-pre-wrap rounded-xl border border-glass-border px-4 py-3 text-sm", mine && "bg-primary text-primary-foreground", message.status === "sending" && "opacity-70")}>{message.body ?? "Media message"}</p>
            {mine && message.status === "failed" ? <button onClick={() => void retry(message)} className="mt-1 text-[11px] text-destructive underline">Not sent · Tap to retry</button> : <span className="mt-0.5 text-[10px] text-muted-foreground">{message.status === "sending" ? "Sending…" : ago(message.created_at)}</span>}
          </div>;
        })}<div ref={bottom} /></div>
        <ChatComposer onSend={sendChat} onBattle={() => setBattle(true)} onLoot={() => setPaid({ title: "Secret Loot Box", price: "$1.99", description: "Self-destructing secrets require encrypted delivery, recipient consent and 24-hour expiry. Reward odds must be disclosed before any verified purchase. Delivery is not activated." })} />
      </>}
    </>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <ActionDialog title={battle ? "Aura Battle" : null} description="A holographic duel needs both participants’ shared Aura Cards and consent. No opponent score or match is available yet." onClose={() => setBattle(false)}><Button asChild className="bg-gradient-vyzun"><Link to="/">Create your Aura Card</Link></Button></ActionDialog>
    <PaidActionSheet action={paid} onClose={() => setPaid(null)} />
  </section>;
}
