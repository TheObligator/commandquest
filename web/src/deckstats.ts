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

/**
 * True for a modal double-faced card whose front isn't a land but whose back is, like Emeria's
 * Call // Emeria, Shattered Skyclave: it can be played as a land. Transforming cards don't count,
 * since their land side can't be played from hand.
 */
export function playableLandBack(c: { layout?: string; type_line?: string; card_faces?: { type_line?: string }[] }): boolean {
  if (c.layout !== "modal_dfc" || !c.card_faces || c.card_faces.length < 2) return false;
  const isLand = (t?: string) => /\bLand\b/.test((t ?? "").split("—")[0]);
  return !isLand(c.card_faces[0].type_line) && c.card_faces.slice(1).some((f) => isLand(f.type_line));
}

/** log(n!) for the binomial coefficients below. */
const logFact: number[] = [0];
function lnFact(n: number): number {
  for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  return logFact[n];
}
const lnChoose = (n: number, k: number) => lnFact(n) - lnFact(k) - lnFact(n - k);

/**
 * The chance of drawing at least `want` of `hits` special cards (lands) among `drawn` cards from a
 * deck of `size` (hypergeometric). 1 when nothing is needed, 0 when it can't happen.
 */
export function atLeast(size: number, hits: number, drawn: number, want: number): number {
  if (want <= 0) return 1;
  drawn = Math.min(drawn, size);
  if (hits < want || drawn < want) return 0;
  let p = 0;
  for (let i = want; i <= Math.min(drawn, hits); i++) {
    if (drawn - i > size - hits) continue;
    p += Math.exp(lnChoose(hits, i) + lnChoose(size - hits, drawn - i) - lnChoose(size, drawn));
  }
  return Math.min(1, p);
}

/**
 * The chance of having `mv` lands by turn `mv` (to cast a card of that mana value on curve), with
 * `lands` lands in a library of `size` cards: on the play you've seen 7 + (turn − 1) cards, on the
 * draw one more.
 */
export function chanceOnCurve(size: number, lands: number, mv: number, onPlay: boolean): number {
  const turn = Math.max(1, mv);
  return atLeast(size, lands, OPENING_HAND + turn - (onPlay ? 1 : 0), mv);
}
