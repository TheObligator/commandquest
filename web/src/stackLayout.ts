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

// ---- Stacked view: small groups share a column ---------------------------------------------------

/** A group to lay out: its number of card pictures; `whole` cards (commanders) show whole, never split. */
export interface PackGroup {
  size: number;
  whole?: boolean;
}

/** A column (or two or three side by side for a big group) and the groups in it, top to bottom. */
export interface Slot {
  groups: number[];
  span: number;
}

/** Heights in card widths: a card is 1.393 tall; the heading over a group; the space between groups in a column. */
const CARD = 680 / 488;
const HEAD = 0.22;
const BETWEEN = 0.12;

/** How tall a group is, in card widths, split into `span` columns. `strip`: how much of a covered card shows. */
export function groupHeight(g: PackGroup, span: number, strip: number): number {
  if (g.whole) return HEAD + g.size * CARD + Math.max(0, g.size - 1) * 0.1;
  return HEAD + (Math.ceil(g.size / span) - 1) * strip + CARD;
}

/**
 * The Stacked view's columns: groups in order, each in its own column unless it fits under the
 * group before it without making the row taller than its tallest group. Like columnSpans, big
 * groups take two or three columns when the row has room, aiming for the shortest row that fits
 * in `cols` columns (using as few columns as that takes).
 */
export function packStacks(groups: PackGroup[], cols: number, strip: number): Slot[] {
  const tallest = Math.max(0, ...groups.filter((g) => !g.whole).map((g) => g.size));
  const pack = (spans: number[]) => {
    const limit = Math.max(0, ...groups.map((g, i) => groupHeight(g, spans[i], strip)));
    const slots: Slot[] = [];
    let open: { slot: Slot; height: number } | null = null;
    groups.forEach((g, i) => {
      const h = groupHeight(g, spans[i], strip);
      if (spans[i] > 1) {
        slots.push({ groups: [i], span: spans[i] });
        open = null;
      } else if (open && open.height + BETWEEN + h <= limit + 1e-9) {
        open.slot.groups.push(i);
        open.height += BETWEEN + h;
      } else {
        open = { slot: { groups: [i], span: 1 }, height: h };
        slots.push(open.slot);
      }
    });
    return { slots, limit, width: slots.reduce((n, s) => n + s.span, 0) };
  };

  let best = pack(groups.map(() => 1));
  for (let height = tallest - 1; height >= 1; height--) {
    const spans = groups.map((g) => (g.whole || g.size < MIN_TO_SPLIT ? 1 : Math.ceil(g.size / height)));
    if (spans.some((x, i) => x > MAX_SPAN || Math.ceil(groups[i].size / x) > height)) break;
    const p = pack(spans);
    if (p.width > cols) continue; // stacking may still fit at a lower height
    if (best.width > cols || p.limit < best.limit - 1e-9 || (Math.abs(p.limit - best.limit) < 1e-9 && p.width < best.width)) best = p;
  }
  return best.slots;
}
