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

/** How many lands (copies counted) can make each color, and how many lands there are. */
export function landSources(lands: { quantity: number; produced?: string[] }[]): { total: number; byColor: Record<Color, number> } {
  const byColor = zero();
  let total = 0;
  for (const l of lands) {
    total += l.quantity;
    for (const color of WUBRG) if (l.produced?.includes(color)) byColor[color] += l.quantity;
  }
  return { total, byColor };
}

/** n as a whole percentage of total ("0%" when total is 0). */
export const percent = (n: number, total: number) => `${total ? Math.round((n / total) * 100) : 0}%`;
