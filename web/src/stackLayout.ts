// Stacked and Spread views: which types get a second column. A column's height is its number of
// card pictures (one per unique card, so "Island ×7" is one), so splitting only makes sense for the
// type that sets the row's height, and only when it's clearly taller than the rest.

/** Types with fewer card pictures than this stay in one column. */
const MIN_TO_SPLIT = 7;
/** A split has to make the row at least this many cards shorter. */
const MIN_GAIN = 3;

/**
 * Which groups (by index) get a second column, given each group's number of card pictures and how
 * many columns fit in the row. One per spare column: each time, the tallest column splits if that
 * makes the row at least MIN_GAIN cards shorter; once the tallest is split or isn't worth it, stop.
 */
export function doubledGroups(sizes: number[], cols: number): Set<number> {
  const out = new Set<number>();
  const height = (i: number) => (out.has(i) ? Math.ceil(sizes[i] / 2) : sizes[i]);
  for (let spare = cols - sizes.length; spare > 0; spare--) {
    const order = sizes.map((_, i) => i).sort((a, z) => height(z) - height(a));
    const [tallest, next] = order;
    if (tallest === undefined || out.has(tallest) || sizes[tallest] < MIN_TO_SPLIT) break;
    const after = Math.max(Math.ceil(sizes[tallest] / 2), next === undefined ? 0 : height(next));
    if (sizes[tallest] - after < MIN_GAIN) break;
    out.add(tallest);
  }
  return out;
}

/** A group's cards as one column, or two (the first gets the extra card). */
export const columnsOf = <T>(cards: T[], double: boolean): T[][] =>
  double ? [cards.slice(0, Math.ceil(cards.length / 2)), cards.slice(Math.ceil(cards.length / 2))] : [cards];
