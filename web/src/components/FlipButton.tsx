// Double-faced cards: a round "turn over" button at the bottom middle of the card image (like
// Scryfall's), and the state of which cards are showing their back.
import { useCallback, useState } from "react";
import * as scry from "../scryfall";

/** Which cards (by Scryfall id) are turned over to their back face. */
export function useFlips() {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const face = useCallback((c: scry.ScryCard | undefined) => (c && flipped.has(c.id) ? 1 : 0), [flipped]);
  const toggle = useCallback((c: scry.ScryCard) => setFlipped((s) => {
    const next = new Set(s);
    if (!next.delete(c.id)) next.add(c.id);
    return next;
  }), []);
  return { face, toggle };
}

/**
 * The turn-over button for a card with a back face (nothing otherwise). Put it next to the card's
 * image button, inside an element that's `position: relative` and a size container (`.flip-host`,
 * `.card-tile`, `.search-card`), so it sits over the image's bottom middle.
 */
export function FlipButton({ card, face, onFlip }: { card: scry.ScryCard | undefined; face: number; onFlip: (c: scry.ScryCard) => void }) {
  if (!card || !scry.hasBackImage(card)) return null;
  const other = card.card_faces?.[1 - face]?.name ?? "the other side";
  return (
    <button
      type="button"
      className={`flip-btn${face ? " flipped" : ""}`}
      aria-label={`Turn over: show ${other}`}
      title={`Turn over: show ${other}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onFlip(card);
      }}
    >
      <svg viewBox="0 0 24 24" width="60%" height="60%" aria-hidden="true">
        <path d="M4 12a8 8 0 0 1 13.66-5.66L20 4v6h-6l2.24-2.24A6 6 0 0 0 6 12z" fill="currentColor" />
        <path d="M20 12a8 8 0 0 1-13.66 5.66L4 20v-6h6l-2.24 2.24A6 6 0 0 0 18 12z" fill="currentColor" />
      </svg>
    </button>
  );
}
