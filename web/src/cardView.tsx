// How a deck's cards are shown, on the precon decks and in the deck editor: overlapping card
// pictures (two amounts of overlap), whole cards in a grid, or a text list. One choice for both
// pages, remembered per browser: the last one you picked, else Stacked.
import { useState } from "react";

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
