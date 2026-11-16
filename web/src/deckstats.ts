// Averages shown beside the mana curve (Stats in src/pages/Editor.tsx). Main deck only, like the curve.

export interface StatEntry {
  quantity: number;
  /** Mana value. */
  cmc: number;
  land: boolean;
}

export const OPENING_HAND = 7;

export function deckAverages(entries: StatEntry[]): {
  /** Average mana value counting lands (as 0); undefined for an empty deck. */
  withLands?: number;
  /** Average mana value of nonland cards; undefined when there are none. */
  withoutLands?: number;
  /** Expected lands in a 7-card opening hand: 7 × lands ÷ cards. */
  landsPerHand?: number;
} {
  let cards = 0, lands = 0, mv = 0;
  for (const e of entries) {
    cards += e.quantity;
    if (e.land) lands += e.quantity;
    else mv += e.cmc * e.quantity;
  }
  const spells = cards - lands;
  return {
    withLands: cards ? mv / cards : undefined,
    withoutLands: spells ? mv / spells : undefined,
    landsPerHand: cards ? (Math.min(OPENING_HAND, cards) * lands) / cards : undefined,
  };
}
