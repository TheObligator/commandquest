// Color symbols on the deck's cards and the colors its lands make (shown under the deck stats).

export const WUBRG = ["W", "U", "B", "R", "G"] as const;
/** The five colors and colorless ({C}: mana only a colorless source can pay, as for Eldrazi like Kozilek's Command). */
export const WUBRGC = [...WUBRG, "C"] as const;
export type Color = (typeof WUBRGC)[number];

const zero = (): Record<Color, number> => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

/**
 * Colored mana symbols in these mana costs, times each card's copies. Hybrid symbols count for
 * each of their colors ({W/U} is one W and one U), Phyrexian and two-or-color ones for their
 * color ({W/P}, {2/W}). {C} counts as colorless: it needs colorless mana. Generic and X symbols don't count.
 */
export function colorPips(cards: { quantity: number; manaCost?: string }[]): Record<Color, number> {
  const out = zero();
  for (const c of cards) {
    for (const [, sym] of (c.manaCost ?? "").matchAll(/\{([^}]+)\}/g)) {
      for (const color of WUBRGC) if (sym.split("/").includes(color)) out[color] += c.quantity;
    }
  }
  return out;
}

/**
 * The colors the deck's mana sources (lands, rocks, dorks, rituals, Treasure makers: anything
 * Scryfall says produces mana) can make: one per color a card makes, times its copies. With
 * `identity`, a card that makes any color counts only for the deck's colors (an Arcane Signet in
 * a green-white deck makes green or white). Colorless always counts: no deck's identity limits it.
 */
export function manaProduction(cards: { quantity: number; produced?: string[] }[], identity?: string[]): Record<Color, number> {
  const out = zero();
  for (const c of cards) {
    for (const color of WUBRGC) {
      if (!c.produced?.includes(color)) continue;
      if (identity && color !== "C" && !identity.includes(color)) continue;
      out[color] += c.quantity;
    }
  }
  return out;
}

/** n as a whole percentage of total ("0%" when total is 0). */
export const percent = (n: number, total: number) => `${total ? Math.round((n / total) * 100) : 0}%`;

const LAND_TYPES: Record<string, Color> = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

/** A land in the deck: its type line and the mana it makes. */
export interface DeckLand {
  typeLine: string;
  produced: string[];
}

/**
 * The colors a card can get by searching your library for a land (a fetch land, Evolving Wilds,
 * Fabled Passage...). Read from its rules text:
 * - named land types ("a Forest or Plains card") give those colors, and whatever the deck's lands
 *   with those types make (a fetched Forest can be a Breeding Pool);
 * - "basic land" gives the colors of the deck's basic lands;
 * - any other land ("a land card") gives every color the deck's lands make.
 * Searches of an opponent's library ("their library") don't count.
 */
export function fetchColors(oracle: string, lands: DeckLand[]): Set<Color> {
  const out = new Set<Color>();
  const make = (ls: DeckLand[]) => {
    for (const l of ls) for (const c of l.produced) if ((WUBRGC as readonly string[]).includes(c)) out.add(c as Color);
  };
  for (const m of oracle.matchAll(/search(?:es)? your library for ([^.;]*?)\bcards?\b/gi)) {
    const what = m[1];
    const named = Object.keys(LAND_TYPES).filter((t) => new RegExp(`\\b${t}\\b`).test(what));
    if (named.length) {
      for (const t of named) {
        out.add(LAND_TYPES[t]);
        make(lands.filter((l) => new RegExp(`\\b${t}\\b`).test(l.typeLine)));
      }
    } else if (/\bbasic land\b/i.test(what)) {
      make(lands.filter((l) => /\bBasic\b/.test(l.typeLine)));
    } else if (/\bland\b/i.test(what)) {
      make(lands);
    }
  }
  return out;
}

/**
 * For each color, the cards (times copies) that can fetch a land of that color but don't make it
 * themselves: what fetching adds to `manaProduction`. Limited to `identity` like it. The caller
 * picks which cards count (the deck shows fetch lands only, not ramp spells).
 */
export function fetchReach(cards: { quantity: number; produced?: string[]; oracle?: string }[], lands: DeckLand[], identity?: string[]): Record<Color, number> {
  const out = zero();
  for (const c of cards) {
    if (!c.oracle) continue;
    for (const color of fetchColors(c.oracle, lands)) {
      if (c.produced?.includes(color)) continue;
      if (identity && color !== "C" && !identity.includes(color)) continue;
      out[color] += c.quantity;
    }
  }
  return out;
}
