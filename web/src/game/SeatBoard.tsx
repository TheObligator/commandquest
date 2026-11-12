// One player's area: header (life, poison, commander damage), the battlefield in three rows, and
// along the bottom-left their zones as card tiles: library (a card back), top of graveyard, top of
// exile and the commander, each labelled with its count, plus how many cards they hold.
//
// The three battlefield rows share the board's height, and each is a grid of cells (one card or
// pile per cell, so nothing overlaps). Cards shrink to fit so a board never scrolls until they'd
// get unreadably small. You can drag cards to any cell on any board; that only changes your view.
import { useLayoutEffect, useRef, useState } from "react";
import { CardBack, CardBadges, CardFace, CostOverlay, previewFor, usePreview } from "./cards";
import type { OpenMenu } from "./TableBoard";
import { arrange, moveCards, ROW_LABELS, usedCols, type Arrangement, type CardView, type Pile, type PlayerView, type Row } from "./view";

export type ZoneName = "graveyard" | "exile" | "command" | "library";

/** Data on a drag that started on a card. */
export interface DragData {
  from: "hand" | "battlefield";
  seat: string;
  ids: number[];
}
export const DRAG_TYPE = "application/x-commandquest-card";
let currentDrag: DragData | null = null; // dragover can't read dataTransfer contents
export const setDrag = (d: DragData | null) => (currentDrag = d);

const MIN_CW = 34;
const ROW_GAP = 6;
const CARD_GAP = 5;
/** Free cells kept at the end of each row, to drop cards into. */
const SPARE = 1;

/**
 * Picks the card width that fits every row in the box: each row gets a third of the height and
 * room for its rightmost card plus a spare cell. In `line` mode (short seats) the three rows sit
 * side by side, one line each.
 */
function fitWidth(rows: Pile[][], w: number, h: number, max: number, line = false): number {
  const cols = rows.map((r) => usedCols(r) + SPARE);
  let cw: number;
  if (line) {
    const total = cols.reduce((a, b) => a + b, 0);
    cw = Math.min(h / 1.4, (w - CARD_GAP * total - 16 * 2) / total);
  } else {
    cw = (h - ROW_GAP * 2) / 3 / 1.4;
    for (const n of cols) cw = Math.min(cw, (w - CARD_GAP * (n - 1)) / n);
  }
  return Math.max(MIN_CW, Math.min(max, Math.floor(cw)));
}

export function SeatBoard(props: {
  player: PlayerView;
  viewer: string;
  active: boolean;
  /** Biggest card width on this board, in px. */
  maxCard: number;
  arrangement: Arrangement;
  onArrange: (a: Arrangement) => void;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  onOpenZone: (owner: string, zone: ZoneName) => void;
  onPlayFromHand?: (cardId: number) => void;
  onTap?: (cardId: number) => void;
  /** Cast one of your commanders (partners are two cards). */
  onCastCommander?: (id: number) => void;
  onFocus?: () => void;
  focused?: boolean;
  /** Short seat: battlefield groups side by side instead of three rows. */
  line?: boolean;
  /** Live games: a click on any card goes to the game (Forge decides what it does). */
  onCardClick?: (cardId: number) => void;
  /** Live games: click a player's name to pick them (targets). */
  onPlayerClick?: (playerId: string) => void;
  /** Forge's prompt lets you choose this player (a target). */
  targetable?: boolean;
  /** Cards chosen so far for the current prompt. */
  chosen?: Set<number>;
  /** Cards that can be picked right now. */
  selectable?: Set<number>;
  /** Your cards you can use right now. */
  playable?: Set<number>;
  onMenu?: OpenMenu;
}) {
  const { player: p, viewer, nameOf, colorOf } = props;
  const isMe = p.id === viewer;
  const setPreview = usePreview();
  const hover = (c: CardView) => ({
    onMouseEnter: () => setPreview(previewFor(c, viewer, nameOf)),
    onMouseLeave: () => setPreview(null),
  });

  const cmdDmg = Object.entries(p.commanderDamage).filter(([, n]) => n > 0);
  const top = (cards: CardView[]) => cards[cards.length - 1];

  return (
    <section
      className={`seat-board${props.active ? " active" : ""}${isMe ? " mine" : ""}${props.focused ? " focused" : ""}`}
      style={{ "--seat": p.color } as React.CSSProperties}
      aria-label={isMe ? "Your board" : `${p.name}'s board`}
    >
      <header className="sb-head">
        {props.onPlayerClick ? (
          <button className={`sb-name sb-pick${props.targetable ? " sb-target" : ""}`} data-player-id={p.id} onClick={() => props.onPlayerClick?.(p.id)} title={`Choose ${isMe ? "yourself" : p.name}`}>
            {isMe ? `${p.name} (you)` : p.name}
          </button>
        ) : (
          <span className="sb-name" data-player-id={p.id}>{isMe ? `${p.name} (you)` : p.name}</span>
        )}
        <span className="sb-life" title="Life">{p.life}</span>
        {p.poison > 0 && <span className="sb-poison" title="Poison counters">☠ {p.poison}</span>}
        {Object.entries(p.counters ?? {}).map(([kind, n]) => (
          <span key={kind} className="sb-pcounter" title={`${n} ${kind.toLowerCase()} counter${n === 1 ? "" : "s"}`}>
            {PLAYER_COUNTER_ICON[kind.toLowerCase()] ?? "●"} {n} <small>{kind}</small>
          </span>
        ))}
        {cmdDmg.map(([from, n]) => (
          <span key={from} className="sb-cmd" style={{ "--from": colorOf(from) } as React.CSSProperties} title={`${n} commander damage from ${nameOf(from)}'s commander (21 loses)`}>
            ♛ {n}
          </span>
        ))}
        <span className="sb-spacer" />
        {props.onFocus && (
          <button className="sb-focus" onClick={props.onFocus} title={props.focused ? "Back to the table (Esc)" : "Enlarge this board"} aria-pressed={props.focused}>
            {props.focused ? "✕" : "⤢"}
          </button>
        )}
      </header>

      <div className="sb-body">
        <Battlefield {...props} hover={hover} isMe={isMe} />
        <div className="sb-zones">
          <span className="sb-hand" title={`${p.handCount} card${p.handCount === 1 ? "" : "s"} in hand`}>
            <i className="mini-card" aria-hidden />
            {p.handCount}
          </span>
          <ZoneTile label="Lib" count={p.libraryCount} back={p.libraryCount > 0} hint={`Library: ${p.libraryCount} cards`}
            onMenu={props.onMenu && ((e) => props.onMenu!(e, { kind: "zone", owner: p.id, zone: "library" }))} />
          <ZoneTile label="GY" count={p.graveyard.length} card={top(p.graveyard)} hover={hover}
            onClick={() => props.onOpenZone(p.id, "graveyard")} title="See the graveyard"
            onMenu={props.onMenu && ((e) => props.onMenu!(e, { kind: "zone", owner: p.id, zone: "graveyard" }))} />
          <ZoneTile label="Exile" count={p.exile.length} card={top(p.exile)} hover={hover}
            onClick={() => props.onOpenZone(p.id, "exile")} title="See exiled cards"
            onMenu={props.onMenu && ((e) => props.onMenu!(e, { kind: "zone", owner: p.id, zone: "exile" }))} />
          <CommandTile
            onMenu={props.onMenu}
            playable={props.playable}
            cards={p.command.some((c) => c.commander) ? p.command.filter((c) => c.commander) : p.command.slice(-1)}
            tax={p.commanderCasts ? 2 * p.commanderCasts : 0}
            hover={hover}
            onCast={isMe ? props.onCastCommander : undefined}
          />
        </div>
      </div>
    </section>
  );
}

/** The command zone: your commander, or both partners side by side, with their mana cost. */
function CommandTile(props: {
  cards: CardView[];
  tax: number;
  hover: (c: CardView) => { onMouseEnter: () => void; onMouseLeave: () => void };
  onCast?: (id: number) => void;
  onMenu?: OpenMenu;
  playable?: Set<number>;
}) {
  const { cards, tax, hover, onCast } = props;
  return (
    <div className="zone-tile" title={`Command zone${tax ? ` · commander tax +${tax}` : ""}`}>
      <span className="zt-label">
        Cmd
        {tax > 0 && <b className="zt-extra">+{tax}</b>}
      </span>
      <div className="zt-cards">
        {cards.length ? (
          cards.map((card) => {
            const Tag = onCast ? "button" : "div";
            return (
              <Tag
                key={card.id}
                className={`zt-card${props.playable?.has(card.id) ? " playable" : ""}`}
                data-card-ids={card.id}
                onClick={onCast ? () => onCast(card.id) : undefined}
                onContextMenu={props.onMenu && ((e: React.MouseEvent) => props.onMenu!(e, { kind: "card", card, where: "command" }))}
                aria-label={onCast ? `Cast ${card.name ?? "your commander"}` : card.name}
                {...hover(card)}
              >
                <CardFace card={card} knownFaceDown={card.faceDown && !card.hidden} />
                <CardBadges card={card} />
                {card.commander && <CostOverlay card={card} />}
              </Tag>
            );
          })
        ) : (
          <div className="zt-card"><div className="zt-empty">In play</div></div>
        )}
      </div>
    </div>
  );
}

function ZoneTile(props: {
  label: string;
  count?: number;
  /** Shown after the label, e.g. commander tax. */
  extra?: string;
  card?: CardView;
  back?: boolean;
  empty?: string;
  hover?: (c: CardView) => { onMouseEnter: () => void; onMouseLeave: () => void };
  onClick?: () => void;
  title?: string;
  hint?: string;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  const { card } = props;
  const Tag = props.onClick ? "button" : "div";
  return (
    <Tag className="zone-tile" onClick={props.onClick} onContextMenu={props.onMenu} {...(card && props.hover ? { "aria-label": props.title ?? props.hint } : { title: props.title ?? props.hint })} {...(card && props.hover ? props.hover(card) : {})}>
      <span className="zt-label">
        {props.label}
        {props.count !== undefined && <b>{props.count}</b>}
        {props.extra && <b className="zt-extra">{props.extra}</b>}
        {props.onClick && props.label !== "Cmd" && <i aria-hidden>⌄</i>}
      </span>
      <div className="zt-card" data-card-ids={card?.id}>
        {card ? (
          <>
            <CardFace card={card} knownFaceDown={card.faceDown && !card.hidden} />
            <CardBadges card={card} />
          </>
        ) : props.back ? (
          <CardBack label="Library" />
        ) : (
          <div className="zt-empty">{props.empty ?? ""}</div>
        )}
      </div>
    </Tag>
  );
}

function Battlefield(props: Parameters<typeof SeatBoard>[0] & { isMe: boolean; hover: (c: CardView) => object }) {
  const { player: p, arrangement, isMe, nameOf } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 600, h: 300 });
  const [dropAt, setDropAt] = useState<{ row: Row; col: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Size the cards for what's on the board, then center it in the columns that fit across: every
  // row has the same columns, so lands line up under creatures. (Side-by-side rows aren't centered.)
  const packed = arrange(p.battlefield, arrangement);
  const cw = fitWidth(packed, box.w, box.h, props.maxCard, props.line);
  const width = props.line ? 0 : Math.max(1, Math.floor((box.w - 8 + CARD_GAP) / (cw + CARD_GAP)));
  const rows = props.line ? packed : arrange(p.battlefield, arrangement, width);
  const accepts = (d: DragData | null) => !!d && ((d.from === "battlefield" && d.seat === p.id) || (d.from === "hand" && isMe));
  /** The cell under the pointer in a row's grid. */
  const cellAt = (e: React.DragEvent, el: HTMLElement) => {
    const x = e.clientX - el.getBoundingClientRect().left - 4;
    return Math.max(0, Math.floor((x + CARD_GAP / 2) / (cw + CARD_GAP)));
  };

  const onDrop = (e: React.DragEvent, row: Row) => {
    const d = currentDrag;
    const col = cellAt(e, e.currentTarget as HTMLElement);
    setDropAt(null);
    if (!accepts(d) || !d) return;
    e.preventDefault();
    // A card from hand lands in the cell you dropped it on once it's in play.
    props.onArrange(moveCards(p.battlefield, arrangement, d.ids, row, col, width));
    if (d.from === "hand") props.onPlayFromHand?.(d.ids[0]);
  };

  return (
    <div
      ref={ref}
      className={`battlefield${props.line ? " line" : ""}${cw <= MIN_CW ? " cramped" : ""}`}
      style={{ "--cw": `${cw}px` } as React.CSSProperties}
      onContextMenu={props.onMenu && ((e) => props.onMenu!(e, { kind: "board", owner: p.id }))}
    >
      {rows.map((piles, r) => {
        const cols = Math.max(width, usedCols(piles) + SPARE);
        return (
          <div
            key={r}
            className={`bf-row${piles.length ? "" : " empty"}${dropAt?.row === r ? " drop" : ""}`}
            data-label={ROW_LABELS[r]}
            style={{ "--cols": cols, flexGrow: props.line ? cols : undefined } as React.CSSProperties}
            onDragOver={(e) => {
              if (!accepts(currentDrag)) return;
              e.preventDefault();
              const col = cellAt(e, e.currentTarget);
              if (dropAt?.row !== r || dropAt.col !== col) setDropAt({ row: r as Row, col });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
            }}
            onDrop={(e) => onDrop(e, r as Row)}
          >
            {dropAt?.row === r && <div className="bf-ghost" style={{ gridColumn: dropAt.col + 1 }} aria-hidden />}
            {piles.map((pile) => {
              const c = pile.cards[0];
              const n = pile.cards.length;
              // A pile is several copies: while choosing, a click takes the next copy that can be
              // chosen and isn't yet (all chosen: it un-chooses the last), so two clicks pick two.
              const anySelectable = pile.cards.some((x) => props.selectable?.has(x.id));
              const anyChosen = pile.cards.some((x) => props.chosen?.has(x.id));
              const clickId = (() => {
                if (!anySelectable && !anyChosen) return c.id;
                const next = pile.cards.find((x) => props.selectable?.has(x.id) && !props.chosen?.has(x.id));
                return next?.id ?? [...pile.cards].reverse().find((x) => props.chosen?.has(x.id))?.id ?? c.id;
              })();
              return (
                <div
                  key={pile.key}
                  className={["slot", c.tapped && "tapped", anySelectable && "selectable", anyChosen && "chosen", props.playable?.has(c.id) && "playable"].filter(Boolean).join(" ")}
                  style={{ gridColumn: pile.col + 1 }}
                  data-card-ids={pile.cards.map((x) => x.id).join(" ")}
                  draggable
                  onDragStart={(e) => {
                    const d: DragData = { from: "battlefield", seat: p.id, ids: pile.cards.map((x) => x.id) };
                    setDrag(d);
                    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => (setDrag(null), setDropAt(null))}
                  aria-label={props.onCardClick ? `${c.name ?? "Face-down card"}: click to use or choose it, right-click for more, drag to move` : isMe && props.onTap ? `${c.name ?? "Face-down card"}: click to ${c.tapped ? "untap" : "tap"}, drag to move` : undefined}
                  onClick={() => (props.onCardClick ? props.onCardClick(clickId) : isMe && props.onTap?.(c.id))}
                  onContextMenu={props.onMenu && ((e) => props.onMenu!(e, { kind: "card", card: c, where: "battlefield" }))}
                  {...props.hover(c)}
                >
                  <div
                    className={["bf-card", n > 1 && "pile", c.sick && "sick", c.attacking && "attacking", c.blocking && "blocking"].filter(Boolean).join(" ")}
                    style={{ "--n": Math.min(n, 4) } as React.CSSProperties}
                  >
                    <CardFace card={c} knownFaceDown={c.faceDown && !c.hidden} />
                    <CardBadges card={c} />
                    {n > 1 && <span className="pile-count">×{n}</span>}
                  </div>
                  {c.blocking && <span className="blk-badge" title={`Blocking ${c.blocking}`}>🛡 {c.blocking}</span>}
                  {c.attacking && <span className="atk-badge" title={`Attacking ${nameOf(c.attacking)}`}>⚔ {c.attacking === props.viewer ? "you" : nameOf(c.attacking)}</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Icons for common player counters (anything else gets a dot and its name). */
const PLAYER_COUNTER_ICON: Record<string, string> = { energy: "⚡", experience: "★", rad: "☢", ticket: "🎟" };
