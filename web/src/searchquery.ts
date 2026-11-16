// Helpers for the deck search's query: the player's saved search additions, and whether a query is
// one our local matcher (game/scryquery.ts) reads exactly like Scryfall does. Pure logic, so
// `node --test` runs it.

/** Scryfall keywords that only change how results are shown, not which cards match. */
const DISPLAY_KEY = /^-?(order|direction|dir|unique|prefer|display):\S+$/i;

/** Splits a query on spaces outside quotes. */
const words = (q: string) => q.match(/-?\w+[:<>=!]+"[^"]*"|"[^"]*"|\S+/g) ?? [];

/** The query without display keywords (order:, unique:, ...). */
export function stripDisplay(q: string): string {
  return words(q).filter((w) => !DISPLAY_KEY.test(w)).join(" ");
}

/** Just the display keywords of a query (order:, unique:, ...). */
export function displayTerms(q: string): string {
  return words(q).filter((w) => DISPLAY_KEY.test(w)).join(" ");
}

/** Does the query pick its own order? */
export function hasOrder(q: string): boolean {
  return words(q).some((w) => /^(order):/i.test(w));
}

/** Joins the parts of a query, each in parentheses when it holds more than one term. */
export function joinQuery(...parts: string[]): string {
  const real = parts.map((p) => p.trim()).filter(Boolean);
  if (real.length === 1) return real[0];
  return real.map((p) => (/\s/.test(p) ? `(${p})` : p)).join(" ");
}

// Keys and is: values game/scryquery.ts handles the way Scryfall does. Anything else (set:, f:,
// is:fetchland, ...) it would guess at, so such a query isn't run locally.
const LOCAL_KEYS = new Set([
  "name", "t", "type", "o", "oracle", "fo", "c", "color", "colors", "id", "ci", "identity", "commander",
  "m", "mana", "mv", "cmc", "pow", "power", "tou", "toughness", "loy", "loyalty", "r", "rarity", "kw", "keyword",
]);
const LOCAL_IS = new Set([
  "permanent", "spell", "multicolored", "multicolor", "colorless", "commander", "vanilla", "historic",
  "artifact", "creature", "enchantment", "land", "planeswalker", "battle", "instant", "sorcery", "legendary",
]);

/**
 * Filters every card on an EDHREC commander page already passes (paper Commander cards), so the
 * local check can skip them.
 */
const POOL_FILTER = /^(game:paper|-is:digital|is:paper|-game:(arena|mtgo)|(f|format|legal):(c|commander|edh))$/i;

/** The query without display keywords and without filters EDHREC's cards all pass. */
export function forEdhrecCards(q: string): string {
  return words(stripDisplay(q)).filter((w) => !POOL_FILTER.test(w)).join(" ");
}

/** Can the local matcher run this query (display keywords removed) exactly? */
export function locallyReadable(q: string): boolean {
  for (const m of stripDisplay(q).matchAll(/(?:^|[\s(-])(\w+)(?::|<=|>=|!=|=|<|>)("[^"]*"|[^\s)]*)/g)) {
    const key = m[1].toLowerCase();
    if (!LOCAL_KEYS.has(key) && key !== "is") return false;
    if (key === "is" && !LOCAL_IS.has(m[2].replace(/"/g, "").toLowerCase())) return false;
  }
  return true;
}

export const MAX_ADDITIONS = 300;
