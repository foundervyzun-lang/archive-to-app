import { memo, useState } from "react";
import { Ban, Flag, MoreHorizontal, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ActionDialog } from "./ActionDialog";
import { useVyzunSession } from "@/hooks/use-vyzun-session";
import { REPORT_REASONS, submitReport, useBlockActions, useMyBlocks, type ReportKind, type ReportReason } from "@/lib/safety-actions";
import { cn } from "@/lib/utils";

type Props = {
  userId?: string | null | undefined;
  username?: string | null | undefined;
  reelId?: string | undefined;
  chatId?: string | undefined;
  onBlocked?: (() => void) | undefined;
  triggerClassName?: string | undefined;
};

/** Report User / Report Reel / Block User — required by the App Store and Google Play. */
export const SafetyMenu = memo(function SafetyMenu({ userId, username, reelId, chatId, onBlocked, triggerClassName }: Props) {
  const { session } = useVyzunSession();
  const me = session?.user.id;
  const blocks = useMyBlocks(me);
  const { setBlocked } = useBlockActions(me);
  const [report, setReport] = useState<{ kind: ReportKind; targetId: string } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isBlocked = !!userId && !!blocks.data?.has(userId);
  const handle = username ? `@${username}` : "this person";
  if (userId && userId === me) return null;

  function need(fn: () => void) { if (!me) { setNotice("Sign in to report or block."); return; } fn(); }

  async function sendReport(reason: ReportReason) {
    if (!me || !report) return;
    setBusy(true);
    const result = await submitReport(me, report.kind, report.targetId, reason);
    setBusy(false);
    setReport(null);
    setNotice(result.ok ? "Thanks — our safety team will review this. We won't tell them who reported." : result.message);
  }

  async function toggleBlock(next: boolean) {
    if (!userId) return;
    setBusy(true);
    const err = await setBlocked(userId, next);
    setBusy(false);
    setConfirmBlock(false);
    if (err) { setNotice(err); return; }
    setNotice(next ? `${handle} is blocked. They can't message you, and you won't see their Reels.` : `${handle} is unblocked.`);
    if (next) onBlocked?.();
  }

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Report or block" title="Report or block" className={cn("shrink-0", triggerClassName)}><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {reelId && <DropdownMenuItem onSelect={() => need(() => setReport({ kind: "reel", targetId: reelId }))}><Flag />Report Reel</DropdownMenuItem>}
        {chatId && <DropdownMenuItem onSelect={() => need(() => setReport({ kind: "chat", targetId: chatId }))}><Flag />Report chat</DropdownMenuItem>}
        {userId && <DropdownMenuItem onSelect={() => need(() => setReport({ kind: "user", targetId: userId }))}><Flag />Report {handle}</DropdownMenuItem>}
        {userId && (isBlocked
          ? <DropdownMenuItem onSelect={() => need(() => void toggleBlock(false))}><ShieldCheck />Unblock {handle}</DropdownMenuItem>
          : <DropdownMenuItem onSelect={() => need(() => setConfirmBlock(true))} className="text-destructive"><Ban />Block {handle}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    <ActionDialog title={report ? (report.kind === "reel" ? "Report Reel" : report.kind === "chat" ? "Report chat" : `Report ${handle}`) : null} description="Why are you reporting this? Reports are private." onClose={() => setReport(null)}>
      <div className="grid gap-2">{REPORT_REASONS.map((r) => <Button key={r.key} variant="outline" disabled={busy} className="justify-start" onClick={() => void sendReport(r.key)}>{r.label}</Button>)}</div>
    </ActionDialog>
    <ActionDialog title={confirmBlock ? `Block ${handle}?` : null} description="They won't be able to message you, and their Reels will be hidden from you. They aren't notified." onClose={() => setConfirmBlock(false)}>
      <Button variant="destructive" disabled={busy} onClick={() => void toggleBlock(true)}><Ban />Block</Button>
    </ActionDialog>
    <ActionDialog title={notice ? "Safety" : null} description={notice ?? undefined} onClose={() => setNotice(null)} />
  </>;
});
