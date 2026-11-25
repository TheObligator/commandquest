// How the deck list is sorted, and the colors it shows for a deck.

export const SORTS = [
  { id: "name", label: "Name" },
  { id: "colors", label: "Colors" },
  { id: "format", label: "Format" },
  { id: "cards", label: "Cards" },
  { id: "updated", label: "Updated" },
] as const;
export type SortKey = (typeof SORTS)[number]["id"];
export type SortDir = "asc" | "desc";
export interface DeckSort {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: DeckSort = { key: "updated", dir: "desc" };

/** The direction a sort starts in: newest and biggest first, everything else from A. */
export const firstDir = (key: SortKey): SortDir => (key === "updated" || key === "cards" ? "desc" : "asc");

/** Choosing a sort: the same one again reverses it. */
export const pickSort = (s: DeckSort, key: SortKey): DeckSort => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) });

export interface SortableDeck {
  name: string;
  format: string;
  bracket?: number;
  cardCount: number;
  updatedAt: number;
  /** "WUG" ("" = colorless); absent while it isn't known. */
  colors?: string;
}

export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

const WUBRG = "WUBRG";
/** Fewest colors first, then white, blue, black, red, green. */
function colorOrder(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return WUBRG.indexOf(a[i]) - WUBRG.indexOf(b[i]);
  return 0;
}

/** The decks in order. Ties go by name; decks whose colors (or bracket) aren't known come last either way. */
export function sortDecks<D extends SortableDeck>(decks: D[], { key, dir }: DeckSort): D[] {
  const sign = dir === "asc" ? 1 : -1;
  const lacking = (a: unknown, b: unknown) => Number(a === undefined) - Number(b === undefined);
  const compare = (a: D, b: D): number => {
    switch (key) {
      case "name":
        return sign * byName(a.name, b.name);
      case "colors":
        return lacking(a.colors, b.colors) || sign * colorOrder(a.colors ?? "", b.colors ?? "");
      case "format":
        return sign * byName(a.format, b.format) || lacking(a.bracket, b.bracket) || sign * ((a.bracket ?? 0) - (b.bracket ?? 0));
      case "cards":
        return sign * (a.cardCount - b.cardCount);
      case "updated":
        return sign * (a.updatedAt - b.updatedAt);
    }
  };
  return [...decks].sort((a, b) => compare(a, b) || byName(a.name, b.name));
}

/** Folders go by name, or by their newest deck when the list is sorted by date (empty ones last). */
export function sortFolders<F extends { name: string; updatedAt?: number }>(folders: F[], { key, dir }: DeckSort): F[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...folders].sort((a, b) => {
    if (key === "name") return sign * byName(a.name, b.name);
    if (key !== "updated") return byName(a.name, b.name);
    return Number(a.updatedAt === undefined) - Number(b.updatedAt === undefined) || sign * ((a.updatedAt ?? 0) - (b.updatedAt ?? 0)) || byName(a.name, b.name);
  });
}

/**
 * A deck's colors in WUBRG order, from its commanders' color identities, or without a commander, its
 * cards' colors. `cards` has undefined for cards that aren't known. Undefined when that leaves the
 * colors unknown: every commander counts, but a list of cards can do without a few.
 */
export function deckColors(cards: (string[] | undefined)[], commanders: boolean, extraColor?: string): string | undefined {
  const known = cards.filter((c) => c !== undefined);
  if (!known.length || (commanders && known.length < cards.length)) return undefined;
  const all = new Set(known.flat());
  if (extraColor) all.add(extraColor); // the color a Rulebreaker commander adds
  return [...WUBRG].filter((x) => all.has(x)).join("");
}
