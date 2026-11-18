// Questions about cards you can't see on the table (the top of your library, cards revealed to
// you, scry and surveil) open in a window with the cards themselves:
//
// - choose / info: the cards in a grid. Click to pick (one pick answers straight away).
// - arrange: a row per pile ("Top of library", "Graveyard"…). Drag cards between and within
//   piles, or use the buttons under each card. Drag a box over several cards to select them, then
//   drag or move them together. Ordered piles read left to right.
//
// "Look at the board" hides the window; the rail has a button to bring it back.
import { useEffect, useRef, useState } from "react";
import { boxSelection, useBoxSelect } from "./boxSelect";
import { CardBadges, CardFace, faceDownNote, usePreview } from "./cards";
import type { AskPile, LiveAsk, LiveGame } from "./useLiveGame";

/** Whether `ask` opens in a window: arranging cards, or picking among cards that aren't on the battlefield. */
export function isPopupAsk(ask: LiveAsk): boolean {
  if (ask.kind === "arrange") return true;
  const opts = ask.options ?? [];
  return (ask.kind === "choose" || ask.kind === "info") && opts.length > 0
    && opts.every((o) => o.card) && opts.some((o) => o.card!.zone !== "battlefield");
}

export function AskDialog(props: { ask: LiveAsk; game: LiveGame; nameOf: (id: string) => string; onHide: () => void }) {
  const { ask } = props;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    // showModal focuses the first button (a card's ◀); Enter should confirm instead.
    ref.current?.querySelector<HTMLButtonElement>(".ask-actions .primary")?.focus();
  }, []);
  const [title, ...rest] = (ask.title ? [ask.title, ask.message] : ask.message.split("\n"));
  return (
    <dialog ref={ref} className="ask-dialog" onClose={props.onHide}>
      <div className="dialog-head">
        <h3>{title || "Choose"}</h3>
        {rest.join("\n").trim() && <p className="muted">{rest.join("\n")}</p>}
      </div>
      {ask.kind === "arrange" ? <Arrange {...props} /> : <Choose {...props} />}
    </dialog>
  );
}

/** A card in the window, with its name under it. */
function Tile(props: {
  ask: LiveAsk;
  i: number;
  viewer: string;
  nameOf: (id: string) => string;
  on?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  drag?: { onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; onDragEnd: () => void };
  children?: React.ReactNode;
}) {
  const o = props.ask.options![props.i];
  const setPreview = usePreview();
  const c = o.card;
  const note = c && faceDownNote(c, props.viewer, props.nameOf);
  return (
    <figure
      className={`ask-tile${props.on ? " on" : ""}${props.onClick ? " clickable" : ""}`}
      data-sel={props.i}
      draggable={!!props.drag}
      {...props.drag}
      onClick={props.onClick}
      onMouseEnter={() => c && setPreview({ card: c, note })}
      onMouseLeave={() => setPreview(null)}
    >
      <div className="zv-card">
        {c ? (
          <>
            <CardFace card={c} knownFaceDown={c.faceDown && !c.hidden} />
            <CardBadges card={c} />
          </>
        ) : (
          <div className="ask-tile-text">{o.label}</div>
        )}
      </div>
      <figcaption>{c?.hidden ? <em>Hidden card</em> : o.label}</figcaption>
      {props.children}
    </figure>
  );
}

function Choose({ ask, game, nameOf, onHide }: Parameters<typeof AskDialog>[0]) {
  const [picked, setPicked] = useState<number[]>(ask.selected ?? []);
  const info = ask.kind === "info";
  const single = ask.max === 1;
  const ok = picked.length >= ask.min && picked.length <= ask.max;
  const viewer = game.view?.viewer ?? "";
  const base = useRef(new Set<number>());
  const box = useBoxSelect((ids, additive) => {
    if (info || single) return;
    setPicked([...boxSelection(base.current, ids, additive)].slice(0, ask.max));
  });
  const toggle = (i: number) => {
    if (info) return;
    if (single) return game.answer(ask.id, [i]);
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < ask.max ? [...p, i] : p));
  };
  return (
    <>
      {!single && !info && (
        <p className="ar-sub">
          Choose {ask.min === ask.max ? ask.min : ask.min ? `${ask.min} to ${ask.max}` : `up to ${ask.max}`} · {picked.length} chosen
        </p>
      )}
      <div className="zv-grid ask-grid" onPointerDown={(e) => ((base.current = new Set(picked)), box.onPointerDown(e))}>
        {box.overlay}
        {ask.options!.map((_, i) => (
          <Tile key={i} ask={ask} i={i} viewer={viewer} nameOf={nameOf} on={picked.includes(i)} onClick={info ? undefined : () => toggle(i)} />
        ))}
      </div>
      <div className="ask-actions">
        {info && <button className="ar-btn primary" autoFocus onClick={() => game.answer(ask.id, [])}>OK</button>}
        {!single && !info && (
          <button className="ar-btn primary" autoFocus disabled={!ok} onClick={() => game.answer(ask.id, picked)}>Confirm</button>
        )}
        {ask.min === 0 && !info && (
          <button className="ar-btn" onClick={() => game.answer(ask.id, [])}>{single ? "Cancel" : "Choose none"}</button>
        )}
        <span className="ask-spacer" />
        <button className="ar-btn" onClick={onHide}>Look at the board</button>
      </div>
    </>
  );
}

/** How to read an ordered pile, left to right. */
function orderHint(p: AskPile): string {
  if (!p.ordered) return "";
  if (/^top of/i.test(p.label)) return "leftmost goes on top";
  if (/^bottom of/i.test(p.label)) return "leftmost is highest";
  return "in order, left first";
}

function countHint(p: AskPile): string {
  if (p.max >= 0 && p.min === p.max) return `${p.min} card${p.min === 1 ? "" : "s"}`;
  if (p.max >= 0 && p.min > 0) return `${p.min} to ${p.max} cards`;
  if (p.max >= 0) return `up to ${p.max}`;
  if (p.min > 0) return `at least ${p.min}`;
  return "";
}

const fits = (p: AskPile, n: number) => n >= p.min && (p.max < 0 || n <= p.max);

function Arrange({ ask, game, nameOf, onHide }: Parameters<typeof AskDialog>[0]) {
  const specs = ask.piles ?? [];
  const startPiles = () => specs.map((_, k) => [...(ask.start?.[k] ?? [])]);
  const [piles, setPiles] = useState<number[][]>(startPiles);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dropAt, setDropAt] = useState<{ pile: number; at: number } | null>(null);
  const drag = useRef<number[] | null>(null);
  const base = useRef(sel);
  const box = useBoxSelect((ids, additive) => setSel(boxSelection(base.current, ids, additive)));
  const viewer = game.view?.viewer ?? "";
  const ok = piles.every((p, k) => fits(specs[k], p.length));

  /** The cards a move of card `i` takes: every selected card if it's selected, in table order. */
  const moving = (i: number) => (sel.has(i) ? piles.flat().filter((x) => sel.has(x)) : [i]);

  /** Moves `cards` into pile `to` before position `at` (counted without the moved cards). */
  const move = (cards: number[], to: number, at?: number) =>
    setPiles((ps) => {
      const anchor = at === undefined ? undefined : ps[to].filter((x, j) => j < at && !cards.includes(x)).length;
      const next = ps.map((p) => p.filter((x) => !cards.includes(x)));
      next[to].splice(anchor ?? next[to].length, 0, ...cards);
      return next;
    });

  /** Moves card `i` one place left (-1) or right (+1) in its pile. */
  const nudge = (k: number, j: number, d: -1 | 1) =>
    setPiles((ps) => {
      const next = ps.map((p) => [...p]);
      const p = next[k];
      const t = j + d;
      if (t < 0 || t >= p.length) return ps;
      [p[j], p[t]] = [p[t], p[j]];
      return next;
    });

  /** Drop position from the pointer: before the card under it, or after it past its middle. */
  const slotAt = (e: React.DragEvent, k: number, j: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { pile: k, at: e.clientX > r.left + r.width / 2 ? j + 1 : j };
  };

  const short = (p: AskPile) => p.label.replace(/ of (your )?library$/i, "");

  return (
    <>
      <div className="arrange" onPointerDown={(e) => ((base.current = sel), box.onPointerDown(e))}>
        {box.overlay}
        {specs.map((spec, k) => (
          <section
            key={k}
            className={`arrange-pile${dropAt?.pile === k ? " drop" : ""}${fits(spec, piles[k].length) ? "" : " bad"}`}
            onDragOver={(e) => {
              if (!drag.current) return;
              e.preventDefault();
              if (e.target === e.currentTarget || (e.target as Element).closest(".arrange-cards") === e.target) {
                if (dropAt?.pile !== k || dropAt.at !== piles[k].length) setDropAt({ pile: k, at: piles[k].length });
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag.current) move(drag.current, k, dropAt?.pile === k ? dropAt.at : undefined);
              drag.current = null;
              setDropAt(null);
            }}
          >
            <header>
              <h4>{spec.label}</h4>
              <span className="muted small">
                {[`${piles[k].length} card${piles[k].length === 1 ? "" : "s"}`, countHint(spec) && `needs ${countHint(spec)}`, orderHint(spec)].filter(Boolean).join(" · ")}
              </span>
              {sel.size > 0 && (
                <button className="ar-btn small" onClick={() => (move(piles.flat().filter((x) => sel.has(x)), k), setSel(new Set()))}>
                  Move selected here
                </button>
              )}
            </header>
            <div className="arrange-cards">
              {piles[k].length === 0 && <p className="muted small arrange-empty">Drag cards here</p>}
              {piles[k].map((i, j) => (
                <div key={i} className={`arrange-slot${dropAt?.pile === k && dropAt.at === j ? " before" : ""}${dropAt?.pile === k && dropAt.at === j + 1 && j === piles[k].length - 1 ? " after" : ""}`}>
                  <Tile
                    ask={ask}
                    i={i}
                    viewer={viewer}
                    nameOf={nameOf}
                    on={sel.has(i)}
                    onClick={(e) =>
                      setSel((s) => {
                        const n = new Set(e.shiftKey || e.ctrlKey || e.metaKey ? s : []);
                        if (s.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                    drag={{
                      onDragStart: (e) => {
                        drag.current = moving(i);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(i));
                      },
                      onDragOver: (e) => {
                        if (!drag.current) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const s = slotAt(e, k, j);
                        if (dropAt?.pile !== s.pile || dropAt.at !== s.at) setDropAt(s);
                      },
                      onDrop: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (drag.current) move(drag.current, k, slotAt(e, k, j).at);
                        drag.current = null;
                        setDropAt(null);
                      },
                      onDragEnd: () => ((drag.current = null), setDropAt(null)),
                    }}
                  >
                    <div className="arrange-moves">
                      {spec.ordered && piles[k].length > 1 && (
                        <>
                          <button title="Move left" disabled={j === 0} onClick={(e) => (e.stopPropagation(), nudge(k, j, -1))}>◀</button>
                          <button title="Move right" disabled={j === piles[k].length - 1} onClick={(e) => (e.stopPropagation(), nudge(k, j, 1))}>▶</button>
                        </>
                      )}
                      {specs.map((other, t) =>
                        t === k ? null : (
                          <button
                            key={t}
                            title={`Put ${sel.has(i) && sel.size > 1 ? "the selected cards" : "it"} in ${other.label}`}
                            onClick={(e) => (e.stopPropagation(), move(moving(i), t), setSel(new Set()))}
                          >
                            → {short(other)}
                          </button>
                        ),
                      )}
                    </div>
                  </Tile>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="ask-actions">
        <button className="ar-btn primary" autoFocus disabled={!ok} onClick={() => game.answer(ask.id, piles)}>Confirm</button>
        <button className="ar-btn" onClick={() => (setPiles(startPiles()), setSel(new Set()))}>Reset</button>
        <span className="ask-spacer" />
        <span className="muted small">Drag a box to select several cards</span>
        <button className="ar-btn" onClick={onHide}>Look at the board</button>
      </div>
    </>
  );
}
