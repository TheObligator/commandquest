// Windows over the table that show cards themselves, big enough to read:
//
// - ShownWindow: cards revealed to you (an opponent's hand, a card someone revealed, a library
//   you searched and found nothing in), in a small window you can move and resize. The game
//   doesn't wait; close it when you've looked.
//
// Choosing cards from a library you're searching, a graveyard or exile is the pick window
// (PickDialog).
import { CardBadges, CardFace, usePreview } from "./cards";
import { useFloatingBox } from "./floatingBox";
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

const REVEAL_KEY = "cq.reveal.box";
/** First time: a small window at the top right, clear of the stack window on the left. */
const revealDefault = () => {
  const w = 300;
  return { x: Math.max(0, window.innerWidth - w - 24), y: 80, w, h: 340 };
};

/**
 * Revealed cards in a small window floating over the table: drag it by its title bar, resize it
 * from the corner (both remembered). The table stays usable while it's open. `more`: how many
 * other reveals are waiting after this one.
 */
export function ShownWindow({ title, note, cards, more, onClose }: { title: string; note?: string; cards: CardView[]; more: number; onClose: () => void }) {
  const { box, ref, startDrag, onResizeEnd } = useFloatingBox(REVEAL_KEY, revealDefault);
  return (
    <div
      ref={ref}
      className="reveal-window"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerUp={onResizeEnd}
      role="dialog"
      aria-label={title || "Revealed"}
    >
      <header className="stk-head" onPointerDown={startDrag} title="Drag to move. Resize from the bottom-right corner.">
        <span className="stk-grip" aria-hidden>⠿</span>
        <h3>{title || "Revealed"}</h3>
        {cards.length > 1 && <span className="stk-count">{cards.length}</span>}
        {more > 0 && (
          <button className="rw-next" onClick={onClose} title="Close this and show the next reveal">
            Next ({more})
          </button>
        )}
        <button className="rw-close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className="rw-body">
        {note && <p className="muted small">{note}</p>}
        {cards.length > 0 && (
          <div className="zv-grid">
            {cards.map((c) => <Tile key={c.id} card={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}
