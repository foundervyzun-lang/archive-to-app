/**
 * Smart Action Navigation for VYZUN AI. Pure and browser-safe so the chat can
 * route instantly (no AI round-trip) when a message is clearly a "take me to" request.
 */
export type NavTarget = "map" | "scan" | "reels" | "profile" | "secrets" | "inbox" | "feed" | "messages" | "settings" | "privacy" | "terms";

export type NavDestination = {
  to: "/" | "/reels" | "/profile" | "/secrets" | "/messages" | "/privacy" | "/terms";
  search?: Record<string, string>;
  label: string;
};

export const NAV_DESTINATIONS: Record<NavTarget, NavDestination> = {
  map: { to: "/secrets", search: { tab: "map" }, label: "Campus Map" },
  scan: { to: "/", label: "Scanner" },
  reels: { to: "/reels", label: "Reels" },
  profile: { to: "/profile", label: "your Profile" },
  secrets: { to: "/secrets", label: "Secrets" },
  inbox: { to: "/secrets", search: { tab: "inbox" }, label: "your Anonymous Inbox" },
  feed: { to: "/secrets", search: { tab: "feed" }, label: "the Vibe Feed" },
  messages: { to: "/messages", label: "Messages" },
  settings: { to: "/profile", search: { settings: "1" }, label: "Settings" },
  privacy: { to: "/privacy", label: "the Privacy Policy" },
  terms: { to: "/terms", label: "the Terms" },
};

export const NAV_TARGETS = Object.keys(NAV_DESTINATIONS) as NavTarget[];

const VERB = /\b(take|bring|send|go|goto|open|show|launch|start|navigate|jump|switch|head|move|visit|lead|get)\b/;
const WHERE = /\b(to|into|me|my|the|on|at)\b/;

// Ordered: more specific screens first.
const TARGET_WORDS: [NavTarget, RegExp][] = [
  ["map", /\b(campus\s*map|map|radar|campus|pins?)\b/],
  ["inbox", /\b(inbox|anonymous\s*(messages?|inbox)|my\s*secrets)\b/],
  ["feed", /\b(vibe\s*feed|feed)\b/],
  ["settings", /\b(settings?|preferences|privacy\s*settings)\b/],
  ["privacy", /\b(privacy\s*policy)\b/],
  ["terms", /\b(terms(\s*of\s*(service|use))?)\b/],
  ["scan", /\b(scan(ner)?|face\s*scan|aura\s*(scan|card)|camera)\b/],
  ["reels", /\b(reels?|videos?|for\s*you)\b/],
  ["messages", /\b(messages|chats?|dms?|direct\s*messages?)\b/],
  ["profile", /\b(profile|my\s*page|account)\b/],
  ["secrets", /\b(secrets?)\b/],
];

/** Returns the screen the user asked to be taken to, or null when it is not a navigation request. */
export function parseNavIntent(input: string): NavTarget | null {
  const text = input.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 120) return null;
  // Questions about a feature ("how do I pin on the map?") are answered, not routed.
  if (/^(how|what|why|when|who|which|can|does|do|is|are|should|explain|tell)\b/.test(text) && !/^(can|could) you (take|open|show|bring|send)\b/.test(text)) return null;
  const words = text.split(" ").length;
  const hasVerb = VERB.test(text);
  if (!hasVerb && words > 3) return null;
  if (hasVerb && !WHERE.test(text) && words > 6) return null;
  for (const [target, pattern] of TARGET_WORDS) if (pattern.test(text)) return target;
  return null;
}

/** Strip a trailing [[nav:target]] marker from an AI reply and return the target if valid. */
export function extractNavMarker(reply: string): { text: string; target: NavTarget | null } {
  const match = reply.match(/\[\[nav:([a-z]+)\]\]\s*$/i);
  if (!match) return { text: reply.trim(), target: null };
  const raw = (match[1] ?? "").toLowerCase();
  const target = (NAV_TARGETS as string[]).includes(raw) ? (raw as NavTarget) : null;
  return { text: reply.slice(0, match.index).trim(), target };
}
