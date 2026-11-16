// Stacked and Spread views: how many columns each type gets. A column's height is its number of
// card pictures (one per unique card, so "Island ×7" is one), so splitting only makes sense for the
// type that sets the row's height, and only when it's clearly taller than the rest.

/** Types with fewer card pictures than this stay in one column. */
const MIN_TO_SPLIT = 7;
/** A split has to make the row at least this many cards shorter. */
const MIN_GAIN = 3;
/** The most columns one type can take. */
const MAX_SPAN = 3;

/**
 * How many columns (1 to 3) each group gets, given each group's number of card pictures and how many
 * columns fit in the row. One spare column at a time goes to whichever type is tallest right now
 * (so a type already split in two can go to three), as long as that makes the row at least MIN_GAIN
 * cards shorter; once the tallest can't split further or it isn't worth it, stop.
 */
export function columnSpans(sizes: number[], cols: number): number[] {
  const spans = sizes.map(() => 1);
  const height = (i: number) => Math.ceil(sizes[i] / spans[i]);
  for (let spare = cols - sizes.length; spare > 0; spare--) {
    const [tallest, next] = sizes.map((_, i) => i).sort((a, z) => height(z) - height(a));
    if (tallest === undefined || spans[tallest] >= MAX_SPAN || sizes[tallest] < MIN_TO_SPLIT) break;
    const after = Math.max(Math.ceil(sizes[tallest] / (spans[tallest] + 1)), next === undefined ? 0 : height(next));
    if (height(tallest) - after < MIN_GAIN) break;
    spans[tallest]++;
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
