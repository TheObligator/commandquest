// How a deck's cards are shown, on the precon decks and in the deck editor: overlapping card
// pictures (two amounts of overlap), whole cards in a grid, or a text list. One choice for both
// pages, remembered per browser: the last one you picked, else Stacked.
import { useCallback, useEffect, useRef, useState } from "react";

export type CardView = "stacked" | "spread" | "grid" | "list";

export const CARD_VIEWS: { id: CardView; label: string; title: string }[] = [
  { id: "stacked", label: "Stacked", title: "Cards overlap so only their names show" },
  { id: "spread", label: "Spread", title: "Cards overlap so their names and art show" },
  { id: "grid", label: "Grid", title: "Whole cards, no overlap" },
  { id: "list", label: "List", title: "Card names only" },
];

const KEY = "cq.cardView";
const isView = (v: string | null): v is CardView => CARD_VIEWS.some((x) => x.id === v);

/** The saved choice, or one picked before the two pages shared it (precons first, then the editor's). */
function saved(): CardView {
  try {
    const v = localStorage.getItem(KEY);
    if (isView(v)) return v;
    const precon = localStorage.getItem("cq.preconView");
    if (isView(precon)) return precon;
    const editor = localStorage.getItem("cq.deckView");
    if (editor === "images") return "grid";
    if (editor === "list") return "list";
  } catch {
    // Storage blocked: the default.
  }
  return "stacked";
}

export function useCardView(): [CardView, (v: CardView) => void] {
  const [view, setView] = useState<CardView>(saved);
  const set = (v: CardView) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };
  return [view, set];
}

export function CardViewToggle({ view, onChange }: { view: CardView; onChange: (v: CardView) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Show the deck as">
      {CARD_VIEWS.map((v) => (
        <button key={v.id} aria-pressed={view === v.id} title={v.title} onClick={() => onChange(v.id)}>{v.label}</button>
      ))}
    </div>
  );
}

// ---- Overlapping views: a big type takes two columns when the row has room ----

/** A stack column's width and the gap between columns (`.stack-col`, `.stack-groups` in style.css). */
const COL = 150;
const GAP = 14;
/** Types with fewer cards than this stay in one column. */
const MIN_TO_SPLIT = 7;

/** How many stack columns fit across the element given the returned ref (0 until measured). */
export function useStackColumns(): [(el: HTMLElement | null) => void, number] {
  const [cols, setCols] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return;
    observer.current ??= new ResizeObserver((entries) => {
      const width = entries[entries.length - 1].contentRect.width;
      setCols(Math.max(1, Math.floor((width + GAP) / (COL + GAP))));
    });
    observer.current.observe(el);
  }, []);
  return [ref, cols];
}

/**
 * Which groups (by index) get a second column: the biggest first, one per column the row has
 * spare, and only groups of at least MIN_TO_SPLIT cards.
 */
export function doubledGroups(sizes: number[], cols: number): Set<number> {
  let spare = cols - sizes.length;
  const out = new Set<number>();
  const biggest = sizes.map((_, i) => i).sort((a, z) => sizes[z] - sizes[a]);
  for (const i of biggest) {
    if (spare <= 0 || sizes[i] < MIN_TO_SPLIT) break;
    out.add(i);
    spare--;
  }
  return out;
}

/** A group's cards as one column, or two (the first gets the extra card). */
export const columnsOf = <T,>(cards: T[], double: boolean): T[][] => (double ? [cards.slice(0, Math.ceil(cards.length / 2)), cards.slice(Math.ceil(cards.length / 2))] : [cards]);
