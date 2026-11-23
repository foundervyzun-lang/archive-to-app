/**
 * Clean-language rule shared by the app and mirrored by the database's
 * `contains_blocked_words` function, which enforces it on Secrets, comments and bios.
 */
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

const BLOCKED = new RegExp(
  "\\b(f+u+c+k+\\w*|motherf\\w*|sh+i+t+(s|ty|tier|ting|head\\w*|hole\\w*)?|bullshit\\w*|b+i+t+c+h+(es|y|ing)?|cunts?|dick(s|head\\w*)?|cocks?|puss(y|ies)|assholes?|bastards?|whores?|sluts?|slutty|porn\\w*|nudes?|nudity|blowjobs?|handjobs?|dildos?|rape|raped|rapes|raping|rapists?|nigg\\w*|nigas?|fags?|faggots?|retard\\w*|kys|chinks?|spics?|kikes?|trann(y|ies)|wetbacks?)\\b|kill\\s+(yo)?ur\\s*self",
  "i",
);

export function containsBlockedWords(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  return BLOCKED.test(normalized);
}

export const BLOCKED_WORDS_MESSAGE = "Please keep it clean — that wording isn't allowed on VYZUN.";
export const RATE_LIMIT_MESSAGE = "Slow down a little — you're sending too fast. Try again in a minute.";
export const BLOCKED_USER_MESSAGE = "You can't message this person.";

/** Turns database safety refusals into friendly copy; null when the error is something else. */
export function safetyErrorMessage(error: unknown): string | null {
  const text = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "");
  if (text.includes("rate_limited")) return RATE_LIMIT_MESSAGE;
  if (text.includes("profanity_blocked")) return BLOCKED_WORDS_MESSAGE;
  if (/\bblocked\b/.test(text)) return BLOCKED_USER_MESSAGE;
  return null;
}
