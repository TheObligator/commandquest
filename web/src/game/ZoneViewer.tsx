// Shows every card in a public zone (graveyard, exile, command zone). Anyone can look at these.
// Face-down cards still appear, so everyone knows they're there, but only players allowed to
// look at one see its face.
import { useEffect, useMemo, useRef, useState } from "react";
import { closeOnBackdrop } from "../carddetails";
import { cached } from "../scryfall";
import { CardBadges, CardFace, faceDownNote, useCardData, usePreview } from "./cards";
import { isMarkClick, useMarks, useMarquee } from "./marks";
import { compileQuery } from "./scryquery";
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
  /** `cards` are already top first (a library listing); otherwise the last card is the top. */
  topFirst?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const setPreview = usePreview();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const all = props.topFirst ? props.cards : [...props.cards].reverse(); // top first
  const marks = useMarks();
  const { onMouseDown, marquee } = useMarquee();
  // Filter by name, or with Scryfall's syntax (t:creature o:"draw a card" mv<=3), on the cards' Scryfall data.
  const [query, setQuery] = useState("");
  const names = useMemo(() => [...new Set(props.cards.flatMap((c) => (c.name ? [c.name] : [])))].sort(), [props.cards]);
  useCardData(names);
  const filter = useMemo(() => compileQuery(query.trim()), [query]);
  const cards = typeof filter !== "function" || !query.trim()
    ? all
    : all.filter((c) => {
        if (!c.name) return false;
        try {
          return filter(cached({ name: c.name, quantity: 1, board: "main" }) ?? { name: c.name });
        } catch {
          return false;
        }
      });
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
      {props.cards.length > 1 && (
        <div className="zv-filter">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Find a card: a name, or Scryfall search like t:creature mv<=3 o:"draw a card"'
            aria-label="Filter these cards by name or Scryfall search"
            autoFocus={props.cards.length > 12}
          />
          <span className={`muted small${typeof filter === "function" ? "" : " zv-error"}`}>
            {typeof filter !== "function" ? filter.error : query.trim() ? `${cards.length} match${cards.length === 1 ? "" : "es"}` : "Shift-click or drag a box to select several"}
          </span>
        </div>
      )}
      {cards.length ? (
        <div className="zv-grid" onMouseDown={onMouseDown}>
          {marquee}
          {cards.map((c) => {
            const note = faceDownNote(c, props.viewer, props.nameOf);
            return (
              <figure
                key={c.id}
                data-card-ids={c.id}
                className={[props.playable?.has(c.id) && "playable", marks.marked.has(c.id) && "marked"].filter(Boolean).join(" ") || undefined}
                onMouseEnter={() => setPreview({ card: c, note })}
                onMouseLeave={() => setPreview(null)}
                onContextMenu={props.onMenu ? (e) => props.onMenu!(e, { kind: "card", card: c, where: "zone" }) : undefined}
                onClick={(e) => {
                  if (isMarkClick(e)) return marks.toggle([c.id]);
                  if (props.onCardClick && props.playable?.has(c.id)) props.onCardClick(c.id);
                }}
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
        <p className="muted">{query.trim() && props.cards.length ? "No cards match." : "Empty."}</p>
      )}
    </dialog>
  );
}
