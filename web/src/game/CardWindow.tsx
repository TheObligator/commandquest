// Windows over the table that show cards themselves, big enough to read:
//
// - ShownWindow: cards revealed to you (an opponent's hand, a card someone revealed, a library
//   you searched and found nothing in). The game doesn't wait; close it when you've looked.
//
// Choosing cards from a library you're searching, a graveyard or exile is the pick window
// (PickDialog).
import { useEffect, useRef } from "react";
import { CardBadges, CardFace, usePreview } from "./cards";
import type { CardView } from "./view";

function Tile({ card, className, onClick, caption }: { card: CardView; className?: string; onClick?: () => void; caption?: React.ReactNode }) {
  const setPreview = usePreview();
  return (
    <figure
      className={className}
      onClick={onClick}
      onMouseEnter={() => setPreview({ card })}
      onMouseLeave={() => setPreview(null)}
    >
      <div className="zv-card">
        <CardFace card={card} knownFaceDown={card.faceDown && !card.hidden} />
        <CardBadges card={card} />
      </div>
      <figcaption>{card.hidden ? <em>Hidden card</em> : card.name}{caption}</figcaption>
    </figure>
  );
}

/** Revealed cards: look, then close. `more`: how many other reveals are waiting after this one. */
export function ShownWindow({ title, note, cards, more, onClose }: { title: string; note?: string; cards: CardView[]; more: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="zone-viewer card-window" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <h3>{title || "Revealed"} {cards.length > 1 && <span className="muted small">{cards.length} cards</span>}</h3>
      </div>
      {note && <p className="muted">{note}</p>}
      {cards.length > 0 && (
        <div className={`zv-grid${cards.length <= 3 ? " cw-big" : ""}`}>
          {cards.map((c) => <Tile key={c.id} card={c} />)}
        </div>
      )}
      <div className="cw-actions">
        <button className="ar-btn primary" autoFocus onClick={() => ref.current?.close()}>
          {more ? `Next (${more} more)` : "Close"}
        </button>
      </div>
    </dialog>
  );
}
