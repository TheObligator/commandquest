// Stacked and Spread views: how many columns each type gets. A column's height is its number of
// card pictures (one per unique card, so "Island ×7" is one), so splitting only makes sense for the
// type that sets the row's height, and only when it's clearly taller than the rest.

/** Types with fewer card pictures than this stay in one column. */
const MIN_TO_SPLIT = 7;
/** Each extra column has to make the row at least this many cards shorter. */
const MIN_GAIN = 3;
/** The most columns one type can take. */
const MAX_SPAN = 3;

/**
 * How many columns (1 to 3) each group gets, given each group's number of card pictures and how many
 * columns fit in the row. Spare columns go to the types that set the row's height, in steps: each
 * step takes the fewest columns that make the row at least MIN_GAIN cards shorter per column used.
 * Usually that's one column for the tallest type, but when two types are about as tall, splitting
 * just one doesn't shorten the row, so both split together. Stops once no step is worth it.
 */
export function columnSpans(sizes: number[], cols: number): number[] {
  let spans = sizes.map(() => 1);
  const heightOf = (s: number[]) => Math.max(0, ...sizes.map((n, i) => Math.ceil(n / s[i])));
  const used = (s: number[]) => s.reduce((a, b) => a + b, 0);
  for (;;) {
    const spare = cols - used(spans);
    const height = heightOf(spans);
    if (spare <= 0) break;
    // For each number of extra columns, the shortest row it can buy: aim for each lower row height
    // in turn, splitting every type that's taller than it.
    const bestFor = new Map<number, number[]>();
    for (let target = height - 1; target >= 1; target--) {
      if (sizes.some((n, i) => n < MIN_TO_SPLIT && Math.ceil(n / spans[i]) > target)) break; // can't split
      const next = sizes.map((n, i) => (n < MIN_TO_SPLIT ? spans[i] : Math.max(spans[i], Math.ceil(n / target))));
      if (next.some((x) => x > MAX_SPAN)) break;
      const extra = used(next) - used(spans);
      if (extra > spare) break;
      bestFor.set(extra, next); // lower targets overwrite: the shortest row for that many columns
    }
    const step = [...bestFor.entries()]
      .sort(([a], [z]) => a - z)
      .find(([extra, next]) => extra > 0 && height - heightOf(next) >= MIN_GAIN * extra);
    if (!step) break;
    spans = step[1];
  }
  return spans;
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
