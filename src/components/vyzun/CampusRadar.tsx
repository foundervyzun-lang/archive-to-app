import { Bell, Crown, Gift, Ghost, Megaphone, MapPin, Radio, Sparkles, Store, Swords, Minus, Plus, RotateCcw } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { PaidAction } from "./PaidActionSheet";
import { ActionDialog } from "./ActionDialog";
import { useVyzunSession } from "@/hooks/use-vyzun-session";
import { supabase } from "@/integrations/supabase/client";
import { campusPinsKey, clampPinPosition, PIN_EMOJIS, useCampusPins, type CampusPin } from "@/lib/campus-pins";
import { cn } from "@/lib/utils";

function hoursLeft(expires: string) {
  const h = Math.max(0, (new Date(expires).getTime() - Date.now()) / 3_600_000);
  return h >= 1 ? `${Math.floor(h)}h left` : `${Math.max(1, Math.round(h * 60))}m left`;
}

const TRINKETS = [
  { emoji: "🌸", name: "Secret Vibe", price: "$0.10", x: 22, y: 30 },
  { emoji: "🔥", name: "Neon Flame", price: "$0.25", x: 70, y: 24 },
  { emoji: "👑", name: "Ghost Crown", price: "$0.50", x: 30, y: 66 },
  { emoji: "💎", name: "Aura Crystal", price: "$0.99", x: 76, y: 62 },
];

const STORES = [
  { name: "Campus Café", x: 54, y: 40 },
  { name: "Late Night Bites", x: 26, y: 48 },
];

export function CampusRadar({ onPay }: { onPay: (a: PaidAction) => void }) {
  const [zoom, setZoom] = useState(1);
  const { session, profile } = useVyzunSession();
  const cache = useQueryClient();
  const pins = useCampusPins();
  const [placing, setPlacing] = useState(false);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [emoji, setEmoji] = useState<string>(PIN_EMOJIS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<CampusPin | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mine = pins.data?.find(p => p.user_id === session?.user.id);
  const place = (v: number) => 50 + (v - 50) * (1 + (zoom - 1) * 0.3);

  function startPinning() {
    if (!session) { setNotice("Sign in to drop your pin on the Campus Map."); return; }
    setPlacing(true);
    setNotice(null);
  }

  function pickSpot(e: MouseEvent<HTMLDivElement>) {
    if (!placing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = 1 + (zoom - 1) * 0.3; // undo the zoom spread so the pin lands where tapped
    const rawX = ((e.clientX - rect.left) / rect.width) * 100;
    const rawY = ((e.clientY - rect.top) / rect.height) * 100;
    setSpot({ x: clampPinPosition(50 + (rawX - 50) / scale), y: clampPinPosition(50 + (rawY - 50) / scale) });
    setEmoji(mine?.emoji ?? PIN_EMOJIS[0]);
    setNote(mine?.note ?? "");
    setPlacing(false);
  }

  async function savePin() {
    if (!session || !spot) return;
    setSaving(true);
    const previous = cache.getQueryData<CampusPin[]>(campusPinsKey);
    const optimistic: CampusPin = { id: mine?.id ?? crypto.randomUUID(), user_id: session.user.id, emoji, note: note.trim(), x: spot.x, y: spot.y, expires_at: new Date(Date.now() + 86_400_000).toISOString(), username: profile?.username, avatar_url: profile?.avatar_url ?? null, pending: true };
    cache.setQueryData<CampusPin[]>(campusPinsKey, prev => [optimistic, ...(prev ?? []).filter(p => p.user_id !== session.user.id)]);
    setSpot(null);
    const { error } = await supabase.from("campus_pins").upsert({ user_id: session.user.id, emoji, note: note.trim().slice(0, 80), x: optimistic.x, y: optimistic.y }, { onConflict: "user_id" });
    setSaving(false);
    if (error) { cache.setQueryData(campusPinsKey, previous); setNotice("Your pin couldn't be saved. Try again."); return; }
    void cache.invalidateQueries({ queryKey: campusPinsKey });
  }

  async function removePin(pin: CampusPin) {
    const previous = cache.getQueryData<CampusPin[]>(campusPinsKey);
    cache.setQueryData<CampusPin[]>(campusPinsKey, prev => (prev ?? []).filter(p => p.id !== pin.id));
    setSelected(null);
    const { error } = await supabase.from("campus_pins").delete().eq("id", pin.id);
    if (error) { cache.setQueryData(campusPinsKey, previous); setNotice("Couldn't remove your pin."); }
  }

  return (
    <section className="space-y-3">
      <button
        onClick={() =>
          onPay({
            title: "Inter-Campus Battle Pass",
            price: "$1.99",
            description: "Join an inter-campus Aura event. Participation activates only after verified payment; no global individual leaderboard.",
          })
        }
        className="glass-card flex w-full items-center gap-3 px-4 py-3 text-left tap active:tap-active"
      >
        <Swords className="h-5 w-5 shrink-0 text-magenta" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Inter-Campus Battle Pass</span>
          <span className="text-xs text-muted-foreground">Join your campus rivalry for $1.99</span>
        </span>
        <span className="rounded-full bg-gradient-vyzun px-2.5 py-1 text-[11px] font-bold text-primary-foreground">JOIN</span>
      </button>

      <button
        onClick={() =>
          onPay({
            title: "Daily Clout Crown Auction",
            price: "$10 – $500",
            description: "Bid for today's top spot on your campus map. Highest bid at midnight wins the crown for 24 hours.",
          })
        }
        className="glass-card flex w-full items-center gap-3 px-4 py-3 text-left tap active:tap-active"
      >
        <Crown className="h-5 w-5 shrink-0 text-gold" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Daily Clout Crown Auction</span>
          <span className="text-xs text-muted-foreground">Bid $10 – $500 for campus priority</span>
        </span>
        <span className="rounded-full bg-gradient-gold px-2.5 py-1 text-[11px] font-bold text-background">BID</span>
      </button>

      <div onClick={pickSpot} className={cn("radar-perspective relative h-[65dvh] min-h-[460px] overflow-hidden rounded-3xl border border-glass-border bg-radar-grid", placing && "cursor-crosshair ring-2 ring-cyan")}>
        <div aria-hidden className="pointer-events-none absolute inset-0 origin-center transition-transform" style={{ transform: `scale(${zoom})` }}>
          <svg viewBox="0 0 400 600" preserveAspectRatio="none" className="h-full w-full text-cyan/20"><path d="M70 0V600 M300 0V600 M0 170H400 M0 430H400 M0 600L400 0" fill="none" stroke="currentColor" strokeWidth="12" /><path d="M130 200H250V360H130Z M20 260H55V340H20Z M320 460H380V540H320Z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        </div>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="anim-radar-ping absolute left-1/2 top-1/2 h-[140%] w-[140%] rounded-full border border-cyan/40"
            style={{ animationDelay: `${i * 1.05}s` }}
          />
        ))}
        <span aria-hidden className="anim-sweep absolute inset-[-25%] rounded-full bg-radar-sweep" />
        <span aria-hidden className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan shadow-[var(--glow-cyan)]" />
        <div className="absolute right-3 top-16 z-10 flex flex-col gap-1">
          <Button variant="outline" size="icon" aria-label="Zoom campus radar in" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2, z + 0.25))} className="h-8 w-8 bg-background/80"><Plus className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" aria-label="Zoom campus radar out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - 0.25))} className="h-8 w-8 bg-background/80"><Minus className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" aria-label="Reset campus radar" onClick={() => setZoom(1)} className="h-8 w-8 bg-background/80"><RotateCcw className="h-4 w-4" /></Button>
        </div>

        <button
          onClick={() =>
            onPay({
              title: "Campus Takeover",
              price: "$199/hr",
              description: "Replace the campus banner and audio for one hour with your own message.",
            })
          }
          className="absolute left-3 top-3 flex w-[calc(55%-1rem)] items-center gap-1 rounded-xl border border-magenta/50 bg-background/70 px-2 py-1.5 text-[10px] font-semibold backdrop-blur-md tap active:tap-active"
        >
          <Radio className="h-3.5 w-3.5 text-magenta" /> Campus Takeover · $199/hr
        </button>

        <button
          onClick={() =>
            onPay({
              title: "VIP Aura Halo",
              price: "$4.99/mo",
              description: "A glowing halo around your pin on every campus map.",
            })
          }
          className="absolute right-3 top-3 flex w-[calc(45%-1rem)] items-center gap-1 rounded-xl border border-gold/50 bg-background/70 px-2 py-1.5 text-[10px] font-semibold backdrop-blur-md tap active:tap-active"
        >
          <Sparkles className="h-3.5 w-3.5 text-gold" /> VIP Halo · $4.99/mo
        </button>

        {TRINKETS.map((t, i) => (
          <button
            key={t.name}
            onClick={() =>
              onPay({
                title: `Drop a ${t.name}`,
                price: t.price,
                description: "Leave this micro-drop on the map. Someone nearby finds it and sees your hint.",
              })
            }
            className="anim-float absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center tap active:tap-active"
            style={{ left: `${50 + (t.x - 50) * (1 + (zoom - 1) * 0.3)}%`, top: `${50 + (t.y - 50) * (1 + (zoom - 1) * 0.3)}%`, animationDelay: `${i * 0.6}s` }}
            aria-label={`${t.name}, ${t.price}`}
          >
            <span className="radar-trinket grid h-12 w-12 place-items-center rounded-2xl border border-glass-border bg-background/60 text-2xl shadow-[var(--glow-neon)] backdrop-blur-md">
              {t.emoji}
            </span>
            <span className="mt-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold">{t.price}</span>
          </button>
        ))}

        {STORES.map((s) => (
          <button
            key={s.name}
            onClick={() =>
              onPay({
                title: "Sponsored Store Pin",
                price: "$99/mo",
                description: `Local businesses like ${s.name} appear as glowing pins with a deal for students nearby.`,
              })
            }
            className="absolute flex max-w-[48%] -translate-x-1/2 -translate-y-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-emerald/50 bg-background/75 px-2 py-1 text-[10px] font-semibold backdrop-blur-md tap active:tap-active"
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
          >
            <Store className="h-3 w-3 text-emerald" /> {s.name}
            <span className="text-muted-foreground">· Ad $99/mo</span>
          </button>
        ))}

        {(pins.data ?? []).map((pin) => (
          <button
            key={pin.id}
            onClick={(e) => { e.stopPropagation(); if (!placing) setSelected(pin); }}
            className={cn("absolute z-[5] flex -translate-x-1/2 -translate-y-full flex-col items-center tap active:tap-active", pin.pending && "opacity-70")}
            style={{ left: `${place(pin.x)}%`, top: `${place(pin.y)}%` }}
            aria-label={`Pin by @${pin.username ?? "viber"}${pin.note ? `: ${pin.note}` : ""}`}
          >
            <span className={cn("grid h-11 w-11 place-items-center overflow-hidden rounded-[30%] border-2 bg-background/80 text-xl shadow-[var(--glow-neon)] backdrop-blur-md", pin.user_id === session?.user.id ? "border-gold" : "border-cyan")}>
              {pin.avatar_url ? <img src={pin.avatar_url} alt="" className="h-full w-full object-cover" /> : pin.emoji}
            </span>
            {pin.avatar_url && <span aria-hidden className="-mt-3 text-base">{pin.emoji}</span>}
            <span aria-hidden className="h-2 w-0.5 bg-cyan" />
          </button>
        ))}
        {placing && <p role="status" className="absolute inset-x-6 top-14 z-10 rounded-xl bg-background/85 px-3 py-2 text-center text-xs font-semibold backdrop-blur-md">Tap any spot to drop your pin · <button className="text-cyan underline" onClick={(e) => { e.stopPropagation(); setPlacing(false); }}>Cancel</button></p>}
        {pins.isSuccess && <span className="absolute bottom-16 left-3 z-[6] rounded-full bg-background/80 px-2.5 py-1 text-[10px] font-semibold backdrop-blur-md">● Live · {pins.data.length} {pins.data.length === 1 ? "pin" : "pins"}</span>}

        <div className="absolute inset-x-3 bottom-3 grid grid-cols-2 gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); startPinning(); }}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-vyzun py-2.5 text-sm font-semibold text-primary-foreground tap active:tap-active"
          >
            <MapPin className="h-4 w-4" /> {mine ? "Move Pin" : "Pin Yours"} · Free
          </button>
          <button
            onClick={() =>
              onPay({ title: "Mystery Loot Box", price: "$1.99", description: "Spin for a random animated trinket. Exact odds are shown before you pay." })
            }
            className="flex items-center justify-center gap-1.5 rounded-xl border border-glass-border bg-background/70 py-2.5 text-sm font-semibold backdrop-blur-md tap active:tap-active"
          >
            <Gift className="h-4 w-4 text-magenta" /> Loot Box · $1.99
          </button>
        </div>
      </div>
      <ActionDialog title={spot ? (mine ? "Move your pin" : "Drop your pin") : null} description="Visible to everyone on the Campus Map for 24 hours." onClose={() => setSpot(null)}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pin emoji">
          {PIN_EMOJIS.map(e => <Button key={e} type="button" variant={emoji === e ? "default" : "outline"} size="icon" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</Button>)}
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={80} placeholder="Add a short note (optional)" aria-label="Pin note" className="w-full rounded-xl border border-glass-border bg-transparent px-3 py-2 text-sm outline-none" />
        <Button className="bg-gradient-vyzun" disabled={saving} onClick={() => void savePin()}><MapPin />{saving ? "Pinning…" : "Drop pin"}</Button>
      </ActionDialog>
      <ActionDialog title={selected ? `${selected.emoji} @${selected.username ?? "viber"}` : null} description={selected ? `${selected.note || "Dropped a pin here."} · ${hoursLeft(selected.expires_at)}` : undefined} onClose={() => setSelected(null)}>
        {selected && (selected.user_id === session?.user.id
          ? <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => { setSelected(null); startPinning(); }}>Move pin</Button><Button variant="outline" className="border-destructive/60 text-destructive" onClick={() => void removePin(selected)}>Remove pin</Button></div>
          : selected.username && <div className="grid grid-cols-2 gap-2"><Button asChild variant="outline"><Link to="/profile" search={{ u: selected.username }}>View profile</Link></Button><Button asChild className="bg-gradient-secret"><Link to="/messages" search={{ to: selected.username }}>Message</Link></Button></div>)}
      </ActionDialog>
      <ActionDialog title={notice ? "Campus Map" : null} description={notice ?? undefined} onClose={() => setNotice(null)} />
      <Button variant="outline" onClick={() => onPay({ title: "Drop a Ghost Vibe", price: "$0.10 – $0.99", description: "Choose a flower, flame, crown or crystal micro-drop. Placement requires verified payment and approximate-location consent." })} className="h-auto w-full border-magenta/50 py-3"><Ghost className="h-4 w-4 text-magenta" />Drop a Ghost Vibe</Button>

      <button
        onClick={() =>
          onPay({
            title: "Mega Blast",
            price: "$49.99",
            description: "Send one moderated message as a notification to up to 5,000 students on your campus who allow campus alerts.",
          })
        }
        className="glass-card flex w-full items-center gap-3 px-4 py-3 text-left tap active:tap-active"
      >
        <Megaphone className="h-5 w-5 shrink-0 text-cyan" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Mega Blast</span>
          <span className="text-xs text-muted-foreground">Up to 5,000 opted-in campus alerts</span>
        </span>
        <span className="flex items-center gap-1 text-sm font-bold">
          <Bell className="h-3.5 w-3.5" /> $49.99
        </span>
      </button>
    </section>
  );
}
