// Stacked and Spread views: how many columns each type gets. A column's height is its number of
// card pictures (one per unique card, so "Island ×7" is one). Columns the row has room for would
// otherwise sit empty, so they go to splitting the types that make the row tall.

/** Types with fewer card pictures than this stay in one column. */
const MIN_TO_SPLIT = 7;
/** The most columns one type can take. */
const MAX_SPAN = 3;

/**
 * How many columns (1 to 3) each group gets, given each group's number of card pictures and how many
 * columns fit in the row: the shortest row those columns allow, using as few columns as that takes.
 * So every type taller than that row height splits, and nothing else does. Removing one card can
 * only keep the row the same height or make it shorter.
 */
export function columnSpans(sizes: number[], cols: number): number[] {
  const tallest = Math.max(0, ...sizes);
  /** The fewest columns per type for a row `height` cards tall, or null if it can't be done. */
  const spansFor = (height: number) => {
    const spans = sizes.map((n) => (n < MIN_TO_SPLIT ? 1 : Math.ceil(n / height)));
    const fits = spans.every((x, i) => x <= MAX_SPAN && Math.ceil(sizes[i] / x) <= height) && spans.reduce((a, b) => a + b, 0) <= cols;
    return fits ? spans : null;
  };
  let best = sizes.map(() => 1);
  for (let height = tallest - 1; height >= 1; height--) {
    const spans = spansFor(height);
    if (!spans) break; // a lower row only needs more columns
    best = spans;
  }
  return best;
}

/** A group's cards split into `span` columns, the earlier columns taking any extra cards. */
export function columnsOf<T>(cards: T[], span: number): T[][] {
  const per = Math.ceil(cards.length / span);
  const out: T[][] = [];
  for (let i = 0; i < span; i++) out.push(cards.slice(i * per, (i + 1) * per));
  return out.filter((c) => c.length > 0);
}

/** The column's class: wider for a type that spans two or three columns. */
export const stackColClass = (span: number) => (span > 1 ? `stack-col span-${span}` : "stack-col");
