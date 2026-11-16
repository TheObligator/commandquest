// Color symbols on the deck's cards and the colors its lands make (shown under the deck stats).

export const WUBRG = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof WUBRG)[number];

const zero = (): Record<Color, number> => ({ W: 0, U: 0, B: 0, R: 0, G: 0 });

/**
 * Colored mana symbols in these mana costs, times each card's copies. Hybrid symbols count for
 * each of their colors ({W/U} is one W and one U), Phyrexian and two-or-color ones for their
 * color ({W/P}, {2/W}). Generic, colorless and X symbols don't count.
 */
export function colorPips(cards: { quantity: number; manaCost?: string }[]): Record<Color, number> {
  const out = zero();
  for (const c of cards) {
    for (const [, sym] of (c.manaCost ?? "").matchAll(/\{([^}]+)\}/g)) {
      for (const color of WUBRG) if (sym.split("/").includes(color)) out[color] += c.quantity;
    }
  }
  return out;
}

/**
 * The colors the deck's mana sources (lands, rocks, dorks, rituals, Treasure makers: anything
 * Scryfall says produces mana) can make: one per color a card makes, times its copies. With
 * `identity`, a card that makes any color counts only for the deck's colors (an Arcane Signet in
 * a green-white deck makes green or white).
 */
export function manaProduction(cards: { quantity: number; produced?: string[] }[], identity?: string[]): Record<Color, number> {
  const out = zero();
  for (const c of cards) {
    for (const color of WUBRG) {
      if (!c.produced?.includes(color)) continue;
      if (identity && !identity.includes(color)) continue;
      out[color] += c.quantity;
    }
  }
  return out;
}

/** n as a whole percentage of total ("0%" when total is 0). */
export const percent = (n: number, total: number) => `${total ? Math.round((n / total) * 100) : 0}%`;
