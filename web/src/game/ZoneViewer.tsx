// Shows every card in a public zone (graveyard, exile, command zone). Anyone can look at these.
// Face-down cards still appear, so everyone knows they're there, but only players allowed to
// look at one see its face.
import { useEffect, useRef } from "react";
import { closeOnBackdrop } from "../carddetails";
import { CardBadges, CardFace, faceDownNote, usePreview } from "./cards";
import type { OpenMenu } from "./TableBoard";
import type { CardView } from "./view";

export function ZoneViewer(props: {
  title: string;
  cards: CardView[];
  viewer: string;
  nameOf: (id: string) => string;
  onClose: () => void;
  /** Live games: click a card to use it (flashback, escape, commander…). */
  onCardClick?: (id: number) => void;
  playable?: Set<number>;
  onMenu?: OpenMenu;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const setPreview = usePreview();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const cards = [...props.cards].reverse(); // top first
  return (
    <dialog
      ref={ref}
      className="zone-viewer"
      onClose={props.onClose}
      onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}
    >
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="dialog-head">
        <h3>{props.title} <span className="muted small">{props.cards.length} card{props.cards.length === 1 ? "" : "s"} · top first</span></h3>
      </div>
      {cards.length ? (
        <div className="zv-grid">
          {cards.map((c) => {
            const note = faceDownNote(c, props.viewer, props.nameOf);
            return (
              <figure
                key={c.id}
                className={props.playable?.has(c.id) ? "playable" : undefined}
                onMouseEnter={() => setPreview({ card: c, note })}
                onMouseLeave={() => setPreview(null)}
                onContextMenu={props.onMenu ? (e) => props.onMenu!(e, { kind: "card", card: c, where: "zone" }) : undefined}
                onClick={props.onCardClick && props.playable?.has(c.id) ? () => props.onCardClick!(c.id) : undefined}
              >
                <div className="zv-card">
                  <CardFace card={c} knownFaceDown={c.faceDown && !c.hidden} />
                  <CardBadges card={c} />
                </div>
                <figcaption>{c.hidden ? <em>Face-down card</em> : c.name}{note && <small>{note}</small>}</figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="muted">Empty.</p>
      )}
    </dialog>
  );
}
