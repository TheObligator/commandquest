// Windows over the table that show cards themselves, big enough to read:
//
// - ShownWindow: cards revealed to you (an opponent's hand, a card someone revealed, a library
//   you searched and found nothing in). The game doesn't wait; close it when you've looked.
// - OfferWindow: Forge's prompt lets you pick cards from somewhere the table doesn't show (your
//   library while you search it, the top cards you're looking at). The cards you can take come
//   first, then the rest you're looking at, which can't be taken. "Look at the board" hides it;
//   the rail has a button to bring it back.
import { useEffect, useMemo, useRef, useState } from "react";
import { cached } from "../scryfall";
import { CardBadges, CardFace, useCardData, usePreview } from "./cards";
import { compileQuery } from "./scryquery";
import type { CardView } from "./view";

/** Cards matching a name or Scryfall-syntax query (t:land o:"draw a card"); all of them for an empty or bad query. */
function useCardFilter(cards: CardView[], query: string) {
  const names = useMemo(() => [...new Set(cards.flatMap((c) => (c.name ? [c.name] : [])))].sort(), [cards]);
  useCardData(names);
  const filter = useMemo(() => compileQuery(query.trim()), [query]);
  const keep = (c: CardView) => {
    if (typeof filter !== "function" || !query.trim()) return true;
    if (!c.name) return false;
    try {
      return filter(cached({ name: c.name, quantity: 1, board: "main" }) ?? { name: c.name });
    } catch {
      return false;
    }
  };
  return { keep, error: typeof filter === "function" ? null : filter.error };
}

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

/** Forge's prompt offers cards from a hidden place: pick them here, then the prompt's buttons. */
export function OfferWindow(props: {
  title: string;
  offer: CardView[];
  seen: CardView[];
  chosen: (number | string)[];
  onPick: (id: number) => void;
  ok?: { label: string; enabled: boolean; onClick: () => void };
  cancel?: { label: string; enabled: boolean; onClick: () => void };
  onHide: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  const [query, setQuery] = useState("");
  const all = useMemo(() => [...props.offer, ...props.seen], [props.offer, props.seen]);
  const { keep, error } = useCardFilter(all, query);
  const byName = (a: CardView, b: CardView) => (a.name ?? "").localeCompare(b.name ?? "");
  const offer = props.offer.filter(keep).sort(byName);
  const seen = props.seen.filter(keep).sort(byName);
  const [title, ...rest] = props.title.split("\n");
  return (
    <dialog ref={ref} className="zone-viewer card-window" onClose={props.onHide}>
      <div className="dialog-head">
        <h3>{title || "Choose"}</h3>
        {rest.join("\n").trim() && <p className="muted small">{rest.join("\n")}</p>}
      </div>
      {all.length > 12 && (
        <div className="zv-filter">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Find a card: a name, or Scryfall search like t:creature mv<=3 o:"draw a card"'
            aria-label="Filter these cards by name or Scryfall search"
          />
          <span className={`muted small${error ? " zv-error" : ""}`}>{error ?? (query.trim() ? `${offer.length + seen.length} match${offer.length + seen.length === 1 ? "" : "es"}` : "")}</span>
        </div>
      )}
      <h4 className="cw-section">You can choose <span className="muted small">{props.offer.length} card{props.offer.length === 1 ? "" : "s"}</span></h4>
      {offer.length ? (
        <div className="zv-grid">
          {offer.map((c) => {
            const on = props.chosen.includes(c.id);
            return <Tile key={c.id} card={c} className={`playable${on ? " marked" : ""}`} onClick={() => props.onPick(c.id)} caption={on ? <small>Chosen</small> : undefined} />;
          })}
        </div>
      ) : (
        <p className="muted small">{props.offer.length ? "None match." : "None."}</p>
      )}
      {props.seen.length > 0 && (
        <>
          <h4 className="cw-section">The rest <span className="muted small">{props.seen.length} card{props.seen.length === 1 ? "" : "s"}, can't be chosen</span></h4>
          <div className="zv-grid cw-dim">
            {seen.map((c) => <Tile key={c.id} card={c} />)}
          </div>
        </>
      )}
      <div className="cw-actions">
        {props.ok?.label && (
          <button className="ar-btn primary" disabled={!props.ok.enabled} onClick={props.ok.onClick}>{props.ok.label}</button>
        )}
        {props.cancel?.label && (
          <button className="ar-btn" disabled={!props.cancel.enabled} onClick={props.cancel.onClick}>{props.cancel.label}</button>
        )}
        <span className="ask-spacer" />
        <button className="ar-btn" onClick={() => ref.current?.close()}>Look at the board</button>
      </div>
    </dialog>
  );
}
