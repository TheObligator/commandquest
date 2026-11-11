// Reading cards on the table:
// - HoverZoom: rest the pointer on a card and, after a moment, a large image of it pops up beside
//   the pointer (so the left rail doesn't need a permanent preview).
// - CardInspect: "View oracle text" from a card's right-click menu: the card image with its
//   Scryfall oracle text next to it (every face), plus what's on it in this game.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { manaCost, rulesText } from "../dom";
import { cached, imageUrl, type CardFace } from "../scryfall";
import { CardBack, tokenImage, type Preview } from "./cards";
import type { CardDetails } from "./useLiveGame";
import type { CardView } from "./view";

/** How long the pointer rests on a card before it's shown large. */
export const HOVER_ZOOM_MS = 1200;

function bigImage(card: CardView): string | undefined {
  if (card.hidden) return undefined;
  if (card.token) return tokenImage(card);
  const sc = card.name ? cached({ name: card.name, quantity: 1, board: "main" }) : undefined;
  return sc && imageUrl(sc, "large");
}

export function HoverZoom({ preview }: { preview: Preview | null }) {
  const [shown, setShown] = useState<Preview | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => (pointer.current = { x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  // A new card restarts the wait; leaving the card hides it. Same card id: keep showing it.
  const id = preview?.card.id;
  useEffect(() => {
    setShown(null);
    setPos(null);
    if (!preview) return;
    const t = window.setTimeout(() => setShown(preview), HOVER_ZOOM_MS);
    const hide = () => setShown(null);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("dragstart", hide, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("dragstart", hide, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const r = el.getBoundingClientRect();
    const { x, y } = pointer.current;
    const left = x + 24 + r.width < innerWidth - 8 ? x + 24 : Math.max(8, x - 24 - r.width);
    const top = Math.max(8, Math.min(y - r.height / 2, innerHeight - r.height - 8));
    setPos({ left, top });
  }, [shown]);

  if (!shown) return null;
  const card = shown.card;
  const src = bigImage(card);
  return (
    <div ref={ref} className="hover-zoom" style={pos ?? { left: -9999, top: 0 }} aria-hidden>
      {card.hidden ? (
        <CardBack />
      ) : src ? (
        <img src={src} alt="" />
      ) : (
        <div className="hz-tile">
          <strong>{card.name}</strong>
          <span>{card.token ? "Token " : ""}{card.types?.join(" ")}</span>
          {card.power !== undefined && <b>{card.power}/{card.toughness}</b>}
        </div>
      )}
      {shown.note && <p className="hz-note">{shown.note}</p>}
    </div>
  );
}

/** Rules text with mana symbols, from the DOM helpers the deck editor uses. */
function Rules({ text }: { text?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(rulesText(text));
  }, [text]);
  return <div ref={ref} />;
}
function Cost({ cost }: { cost?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(manaCost(cost));
  }, [cost]);
  return <span ref={ref} />;
}

/**
 * Card details: the card beside its text and everything that's different about it in this game
 * (power/toughness now, counters, summoning sickness, tapped, kept from untapping). In live games
 * the text is Forge's (`loadDetails`): the rules text plus what's been added, like granted
 * abilities or "cast from the command zone N times". Otherwise Scryfall's oracle text.
 */
export function CardInspect({ card, loadDetails, ownerName, onClose }: {
  card: CardView;
  loadDetails?: (id: number) => Promise<CardDetails>;
  ownerName: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<CardDetails | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  // Ask again when what's on the card changes (counters, tapped, zone…).
  const stateKey = JSON.stringify([card.zone, card.counters, card.tapped, card.power, card.toughness, card.untapLock]);
  useEffect(() => {
    let live = true;
    void loadDetails?.(card.id).then((d) => live && setDetails(d));
    return () => {
      live = false;
    };
    // `loadDetails` is a new function on every game update; the card and its state decide when to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, stateKey]);

  const sc = card.name && !card.token ? cached({ name: card.name, quantity: 1, board: "main" }) : undefined;
  const faces: CardFace[] = sc ? (sc.card_faces?.length ? sc.card_faces : [sc as CardFace]) : [];
  const src = bigImage(card);
  const counters = Object.entries(card.counters ?? {});
  const inPlay = card.zone === "battlefield";
  const isCreature = card.types?.includes("Creature");
  const printed = faces[0];
  const pt = inPlay && isCreature && card.power !== undefined ? `${card.power}/${card.toughness}` : undefined;
  const ptDiff = pt && printed?.power !== undefined && pt !== `${printed.power}/${printed.toughness}`;
  const facts: string[] = [];
  if (details?.sick ?? card.sick) facts.push("Summoning sick");
  if (card.tapped) facts.push("Tapped");
  if (card.untapLock === "never") facts.push("Never untaps by itself");
  else if (card.untapLock === "next") facts.push("Doesn't untap during its next untap step");
  if (card.faceDown) facts.push("Face down");
  const forgeText = details?.text?.trim();
  return (
    <dialog
      ref={ref}
      className="card-inspect"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-label={card.name ?? "Card"}
    >
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <div className="ci-grid">
        <div className="ci-image">{src ? <img src={src} alt={card.name} /> : card.hidden ? <CardBack /> : <div className="hz-tile"><strong>{card.name}</strong></div>}</div>
        <div className="ci-text">
          <div className="ci-head">
            <h2>{card.hidden ? "Face-down card" : card.name}</h2>
            <Cost cost={printed?.mana_cost} />
          </div>
          <p className="ci-type">{printed?.type_line ?? sc?.type_line ?? `${card.token ? "Token " : ""}${card.types?.join(" ") ?? ""}`}</p>
          {forgeText ? (
            <div className="ci-forge"><Rules text={forgeText} /></div>
          ) : faces.length ? (
            faces.map((f, i) => (
              <section key={i} className="ci-face">
                {faces.length > 1 && <h3 className="ci-facename">{f.name} <Cost cost={f.mana_cost} /></h3>}
                {faces.length > 1 && <p className="ci-type">{f.type_line}</p>}
                <Rules text={f.oracle_text} />
              </section>
            ))
          ) : (
            <p className="muted">{card.token ? "A token: it has what the card that made it gave it." : "No rules text found."}</p>
          )}
          {(pt || (printed?.power !== undefined && !inPlay)) && (
            <div className="ci-pt-row">
              <span className={`ci-pt${ptDiff ? " changed" : ""}`} title={printed?.power !== undefined ? `Printed ${printed.power}/${printed.toughness}` : undefined}>
                {pt ?? `${printed!.power}/${printed!.toughness}`}
              </span>
            </div>
          )}
          {counters.length > 0 && (
            <section className="ci-sec">
              <h3>Counters</h3>
              {counters.map(([k, n]) => (
                <div key={k} className="ci-kv"><span>{k}</span><b>{n}</b></div>
              ))}
            </section>
          )}
          {facts.length > 0 && (
            <section className="ci-sec">
              {facts.map((f) => <h3 key={f}>{f}</h3>)}
            </section>
          )}
          <p className="ci-owner">
            Owner: {ownerName}
            {details?.commanderCasts !== undefined && ` · Commander, cast from the command zone ${details.commanderCasts} time${details.commanderCasts === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>
    </dialog>
  );
}
