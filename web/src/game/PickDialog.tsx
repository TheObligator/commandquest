// Choosing cards from a pile (a graveyard, exile, a library you're searching): the pile opens in a
// window with the cards you can choose lit up, the rest of it dimmed, and a "Chosen" tray below.
// Click or drag a card into the tray to choose it, and back out to change your mind, then OK.
// Forge keeps the choice: each move is the same click you'd make on the table, and the tray shows
// what Forge says is chosen.
import { useEffect, useMemo, useRef, useState } from "react";
import { cached } from "../scryfall";
import { CardBadges, CardFace, useCardData, usePreview } from "./cards";
import type { PickPile } from "./pickZones";
import { PressButton } from "./PressButton";
import { compileQuery } from "./scryquery";
import { useHotkeys } from "./useHotkeys";
import type { Sent } from "./sending";
import type { LiveAsk, LiveButton } from "./useLiveGame";
import type { CardView } from "./view";

export function PickDialog(props: {
  /** Forge's prompt ("Select up to 3 target instant cards"). */
  message: string;
  piles: PickPile[];
  chosen: Set<number>;
  ok: LiveButton;
  cancel: LiveButton;
  /** You can also choose players or cards on the table for this prompt. */
  alsoTable?: boolean;
  /** How many to choose, when the question says (asks). */
  need?: { min: number; max: number };
  onPick: (id: number) => void;
  onOk: () => void;
  onCancel: () => void;
  /** Close the window without answering (to look at the table); the prompt panel brings it back. */
  onHide: () => void;
  /** The button the game server hasn't answered yet. */
  sent?: Sent | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const setPreview = usePreview();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const [over, setOver] = useState<"tray" | "pile" | null>(null);
  const [title, ...rest] = props.message.split("\n");

  const all = props.piles.flatMap((p) => [...p.choosable, ...p.others]);
  const names = useMemo(() => [...new Set(all.flatMap((c) => (c.name ? [c.name] : [])))].sort(), [all.map((c) => c.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useCardData(names);
  // A big pile (a whole library) gets a filter, by name or Scryfall syntax.
  const [query, setQuery] = useState("");
  const filter = useMemo(() => compileQuery(query.trim()), [query]);
  const shown = (c: CardView) => {
    if (typeof filter !== "function" || !query.trim()) return true;
    if (!c.name) return false;
    try {
      return filter(cached({ name: c.name, quantity: 1, board: "main" }) ?? { name: c.name });
    } catch {
      return false;
    }
  };
  const tray = all.filter((c) => props.chosen.has(c.id));

  const drop = (to: "tray" | "pile") => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData("text/x-card-id"));
    if (!id) return;
    if ((to === "tray") !== props.chosen.has(id)) props.onPick(id);
  };
  const dropZone = (to: "tray" | "pile") => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/x-card-id")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(to);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
    },
    onDrop: drop(to),
  });

  const tile = (c: CardView, can: boolean, inTray = false) => {
    return (
      <figure
        key={c.id}
        className={`pick-card ${can ? "can" : "cant"}`}
        draggable={can}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-card-id", String(c.id));
          e.dataTransfer.effectAllowed = "move";
          setPreview(null);
        }}
        onClick={() => can && props.onPick(c.id)}
        onMouseEnter={() => setPreview({ card: c })}
        onMouseLeave={() => setPreview(null)}
        title={inTray ? "Click or drag back up to un-choose" : can ? "Click or drag down to choose" : "Can't be chosen for this"}
      >
        <div className="pick-img">
          <CardFace card={c} knownFaceDown={c.faceDown && !c.hidden} />
          <CardBadges card={c} />
        </div>
        <figcaption>{c.hidden ? <em>Face-down card</em> : c.name}</figcaption>
      </figure>
    );
  };

  return (
    <dialog
      ref={ref}
      className="zone-viewer pick-dialog"
      aria-label={title}
      onCancel={(e) => (e.preventDefault(), props.onHide())}
    >
      <button className="dialog-close" aria-label="Hide (look at the table)" title="Hide: look at the table" onClick={props.onHide}>×</button>
      <div className="dialog-head">
        <div>
          <h3>{title || "Choose cards"}</h3>
          {rest.length > 0 && <p className="muted small pick-sub">{rest.join("\n")}</p>}
          {props.need && (
            <p className="muted small pick-sub">
              Choose {props.need.min === props.need.max ? props.need.min : props.need.min ? `${props.need.min} to ${props.need.max}` : `up to ${props.need.max}`}
            </p>
          )}
          {props.alsoTable && <p className="muted small pick-sub">You can also choose on the table: hide this window to click there.</p>}
        </div>
      </div>
      {all.length > 12 && (
        <div className="zv-filter">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Find a card: a name, or Scryfall search like t:creature mv<=3'
            aria-label="Filter these cards by name or Scryfall search"
          />
          {typeof filter !== "function" && <span className="muted small zv-error">{filter.error}</span>}
        </div>
      )}
      <div className={`pick-piles${over === "pile" ? " over" : ""}`} {...dropZone("pile")}>
        {props.piles.map((p) => {
          // A chosen card moves down to the tray.
          const can = p.choosable.filter((c) => !props.chosen.has(c.id) && shown(c));
          const cant = p.others.filter((c) => !props.chosen.has(c.id) && shown(c));
          return (
            <section key={p.key} className="pick-pile">
              <h4>
                {p.title}{" "}
                <span className="muted small">
                  {p.choosable.length} you can choose{p.others.length ? ` · ${p.others.length} other${p.others.length === 1 ? "" : "s"}` : ""}
                </span>
              </h4>
              <div className="pick-row">
                {can.map((c) => tile(c, true))}
                {cant.map((c) => tile(c, false))}
                {!can.length && !cant.length && <p className="muted small">{query.trim() ? "No cards match." : "All chosen."}</p>}
              </div>
            </section>
          );
        })}
      </div>
      <section className={`pick-tray${over === "tray" ? " over" : ""}`} {...dropZone("tray")} aria-label="Chosen cards">
        <h4>Chosen <span className="muted small">{tray.length}</span></h4>
        <div className="pick-row">
          {tray.map((c) => tile(c, true, true))}
          {!tray.length && <p className="muted small pick-empty">Click or drag cards here.</p>}
        </div>
      </section>
      <div className="cd-btns pick-btns">
        {props.ok.label && (
          <PressButton what="ok" sent={props.sent ?? null} className="btn small" disabled={!props.ok.enabled} onClick={props.onOk}>{props.ok.label}</PressButton>
        )}
        {props.cancel.label && (
          <PressButton what="cancel" sent={props.sent ?? null} className="btn small ghost" disabled={!props.cancel.enabled} onClick={props.onCancel}>{props.cancel.label}</PressButton>
        )}
        <button className="btn small ghost" onClick={props.onHide}>Look at the table</button>
      </div>
    </dialog>
  );
}

/**
 * A question whose options are cards in piles (a tutor, "return a card from your graveyard"…): the
 * pick window keeps your choice until OK, which answers it. One-card questions wait for OK too.
 */
export function AskPick(props: {
  ask: LiveAsk;
  /** The ask's options' cards, in option order. */
  cards: CardView[];
  piles: PickPile[];
  onAnswer: (indexes: number[]) => void;
  onHide: () => void;
}) {
  const { ask, cards } = props;
  const [picked, setPicked] = useState<number[]>(() => (ask.selected ?? []).flatMap((i) => (cards[i] ? [cards[i].id] : [])));
  const pick = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : ask.max === 1 ? [id] : p.length < ask.max ? [...p, id] : p));
  const enabled = picked.length >= ask.min && picked.length <= ask.max;
  const answer = () => props.onAnswer(picked.map((id) => cards.findIndex((c) => c.id === id)));
  useHotkeys({ ok: () => (enabled ? answer() : false) });
  return (
    <PickDialog
      message={ask.title ? `${ask.title}\n${ask.message}` : ask.message}
      piles={props.piles}
      chosen={new Set(picked)}
      ok={{ label: "OK", enabled }}
      cancel={{ label: "", enabled: false }}
      need={{ min: ask.min, max: ask.max }}
      onPick={pick}
      onOk={answer}
      onCancel={() => {}}
      onHide={props.onHide}
    />
  );
}
