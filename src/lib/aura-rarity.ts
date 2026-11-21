export const RARITIES = ["Common", "Rare", "Epic", "Legendary", "Mythic"] as const;

/** Aura Score (40–99) → rarity tier; shared by the device scan and the AI scan. */
export function rarityFor(score: number): (typeof RARITIES)[number] {
  const s = Math.max(40, Math.min(99, Math.round(score)));
  return RARITIES[Math.min(RARITIES.length - 1, Math.floor(s / 21))] ?? "Rare";
}
