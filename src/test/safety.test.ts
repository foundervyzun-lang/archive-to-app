import { describe, expect, it } from "vitest";
import { containsBlockedWords, safetyErrorMessage, RATE_LIMIT_MESSAGE, BLOCKED_WORDS_MESSAGE, BLOCKED_USER_MESSAGE } from "@/lib/safety";

describe("clean-language filter", () => {
  it("blocks strong profanity, including disguised spellings", () => {
    expect(containsBlockedWords("what the fuck")).toBe(true);
    expect(containsBlockedWords("you're a b1tch")).toBe(true);
    expect(containsBlockedWords("FUUUCK this")).toBe(true);
  });
  it("blocks explicit sexual words and self-harm taunts", () => {
    expect(containsBlockedWords("send nudes")).toBe(true);
    expect(containsBlockedWords("just kill yourself")).toBe(true);
  });
  it("allows normal words that merely contain a blocked word", () => {
    expect(containsBlockedWords("grapes and a cocktail at Scunthorpe")).toBe(false);
    expect(containsBlockedWords("Dickson loves shiitake mushrooms")).toBe(false);
    expect(containsBlockedWords("You have such a kind vibe ✨")).toBe(false);
  });
});

describe("safety error messages", () => {
  it("maps the spam cap refusal", () => { expect(safetyErrorMessage({ message: "rate_limited" })).toBe(RATE_LIMIT_MESSAGE); });
  it("maps the clean-language refusal", () => { expect(safetyErrorMessage({ message: "profanity_blocked" })).toBe(BLOCKED_WORDS_MESSAGE); });
  it("maps the block refusal", () => { expect(safetyErrorMessage({ message: "blocked" })).toBe(BLOCKED_USER_MESSAGE); });
  it("ignores unrelated errors", () => { expect(safetyErrorMessage({ message: "network down" })).toBeNull(); });
});
