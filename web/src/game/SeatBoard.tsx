// One player's area: header (life, commander damage, counts), their public zones (commander,
// top of graveyard, top of exile, library) and the battlefield in three rows.
//
// Cards shrink to fit the seat so a board never scrolls until cards would get unreadably small.
// You can drag cards to another row or position on any board; that only changes your own view.
import { useLayoutEffect, useRef, useState } from "react";
import { CardBack, CardBadges, CardFace, previewFor, usePreview } from "./cards";
import { arrange, moveCards, ROW_LABELS, type Arrangement, type CardView, type Pile, type PlayerView, type Row } from "./view";

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
const unitsOf = (p: Pile) => (p.cards[0].tapped ? 1.4 : 1) + Math.min(p.cards.length - 1, 3) * 0.08;

/**
 * Picks the card width that fits every row in the box. In `line` mode (short seats) the three
 * groups sit side by side and may wrap onto a few lines.
 */
function fitWidth(rows: Pile[][], w: number, h: number, max: number, line = false): number {
  if (line) {
    const piles = rows.flat();
    if (!piles.length) return max;
    const units = piles.reduce((s, p) => s + unitsOf(p), 0);
    const gaps = CARD_GAP * piles.length + 16 * 2;
    let best = 0;
    for (let lines = 1; lines <= 4; lines++) {
      const byHeight = (h - ROW_GAP * (lines - 1)) / (lines * 1.4);
      const byWidth = ((w * lines - gaps) / units) * (lines > 1 ? 0.9 : 1); // wrapping wastes some room
      best = Math.max(best, Math.min(byHeight, byWidth));
    }
    return Math.max(MIN_CW, Math.min(max, Math.floor(best)));
  }
  const filled = rows.filter((r) => r.length);
  const empties = rows.length - filled.length;
  if (!filled.length) return max;
  let cw = (h - ROW_GAP * (rows.length - 1) - empties * 14) / (filled.length * 1.4);
  for (const r of filled) {
    const units = r.reduce((s, p) => s + unitsOf(p), 0);
    cw = Math.min(cw, (w - CARD_GAP * (r.length - 1)) / units);
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
  onCastCommander?: () => void;
  onFocus?: () => void;
  focused?: boolean;
  /** Short seat: battlefield groups side by side instead of three rows. */
  line?: boolean;
  /** Live games: a click on any card goes to the game (Forge decides what it does). */
  onCardClick?: (cardId: number) => void;
  /** Live games: click a player's name to pick them (targets). */
  onPlayerClick?: (playerId: string) => void;
  /** Cards that can be picked right now. */
  selectable?: Set<number>;
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
          <button className="sb-name sb-pick" onClick={() => props.onPlayerClick?.(p.id)} title={`Choose ${isMe ? "yourself" : p.name}`}>
            {isMe ? `${p.name} (you)` : p.name}
          </button>
        ) : (
          <span className="sb-name">{isMe ? `${p.name} (you)` : p.name}</span>
        )}
        <span className="sb-life" title="Life">{p.life}</span>
        {p.poison > 0 && <span className="sb-poison" title="Poison counters">☠ {p.poison}</span>}
        {cmdDmg.map(([from, n]) => (
          <span key={from} className="sb-cmd" style={{ "--from": colorOf(from) } as React.CSSProperties} title={`${n} commander damage from ${nameOf(from)}'s commander (21 loses)`}>
            ♛ {n}
          </span>
        ))}
        <span className="sb-spacer" />
        <span className="sb-count" title="Cards in hand">✋ {p.handCount}</span>
        {props.onFocus && (
          <button className="sb-focus" onClick={props.onFocus} title={props.focused ? "Back to the table (Esc)" : "Enlarge this board"} aria-pressed={props.focused}>
            {props.focused ? "✕" : "⤢"}
          </button>
        )}
      </header>

      <div className="sb-body">
        <div className="sb-zones">
          <ZoneTile label={`Cmdr · +${2 * p.commanderCasts}`} card={top(p.command)} empty="On battlefield" hover={hover} hint="Command zone · commander tax"
            onClick={isMe && p.command.length ? props.onCastCommander : undefined} title={isMe && p.command.length ? "Cast your commander" : undefined} />
          <ZoneTile label={`GY · ${p.graveyard.length}`} card={top(p.graveyard)} hover={hover}
            onClick={() => props.onOpenZone(p.id, "graveyard")} title="See the graveyard" />
          <ZoneTile label={`Exile · ${p.exile.length}`} card={top(p.exile)} hover={hover}
            onClick={() => props.onOpenZone(p.id, "exile")} title="See exiled cards" />
          <ZoneTile label={`Lib · ${p.libraryCount}`} back={p.libraryCount > 0} />
        </div>
        <Battlefield {...props} hover={hover} isMe={isMe} />
      </div>
    </section>
  );
}

function ZoneTile(props: {
  label: string;
  card?: CardView;
  back?: boolean;
  empty?: string;
  hover?: (c: CardView) => { onMouseEnter: () => void; onMouseLeave: () => void };
  onClick?: () => void;
  title?: string;
  hint?: string;
}) {
  const { card } = props;
  const Tag = props.onClick ? "button" : "div";
  return (
    <Tag className="zone-tile" onClick={props.onClick} title={props.title ?? props.hint} {...(card && props.hover ? props.hover(card) : {})}>
      <div className="zt-card">
        {card ? (
          <>
            <CardFace card={card} size="small" knownFaceDown={card.faceDown && !card.hidden} />
            <CardBadges card={card} />
          </>
        ) : props.back ? (
          <CardBack label="Library" />
        ) : (
          <div className="zt-empty">{props.empty ?? ""}</div>
        )}
      </div>
      <span className="zt-label">{props.label}</span>
    </Tag>
  );
}

function Battlefield(props: Parameters<typeof SeatBoard>[0] & { isMe: boolean; hover: (c: CardView) => object }) {
  const { player: p, arrangement, isMe, nameOf } = props;
  const rows = arrange(p.battlefield, arrangement);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 600, h: 300 });
  const [dropAt, setDropAt] = useState<{ row: Row; before?: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cw = fitWidth(rows, box.w, box.h, props.maxCard, props.line);
  const accepts = (d: DragData | null) => !!d && ((d.from === "battlefield" && d.seat === p.id) || (d.from === "hand" && isMe));

  const onDrop = (e: React.DragEvent, row: Row) => {
    const d = currentDrag;
    setDropAt(null);
    if (!accepts(d) || !d) return;
    e.preventDefault();
    if (d.from === "hand") props.onPlayFromHand?.(d.ids[0]);
    else props.onArrange(moveCards(p.battlefield, arrangement, d.ids, row, dropAt?.row === row ? dropAt.before : undefined));
  };

  return (
    <div ref={ref} className={`battlefield${props.line ? " line" : ""}${cw <= MIN_CW ? " cramped" : ""}`} style={{ "--cw": `${cw}px` } as React.CSSProperties}>
      {rows.map((piles, r) => (
        <div
          key={r}
          className={`bf-row${piles.length ? "" : " empty"}${dropAt?.row === r ? " drop" : ""}`}
          data-label={ROW_LABELS[r]}
          onDragOver={(e) => {
            if (!accepts(currentDrag)) return;
            e.preventDefault();
            if (dropAt?.row !== r || (e.target as HTMLElement) === e.currentTarget) setDropAt({ row: r as Row, before: (e.target as HTMLElement) === e.currentTarget ? undefined : dropAt?.before });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
          }}
          onDrop={(e) => onDrop(e, r as Row)}
        >
          {piles.map((pile) => {
            const c = pile.cards[0];
            const n = pile.cards.length;
            return (
              <div
                key={pile.key}
                className={["slot", c.tapped && "tapped", props.selectable?.has(c.id) && "selectable", dropAt?.row === r && dropAt.before === c.id && "drop-before"].filter(Boolean).join(" ")}
                draggable
                onDragStart={(e) => {
                  const d: DragData = { from: "battlefield", seat: p.id, ids: pile.cards.map((x) => x.id) };
                  setDrag(d);
                  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => (setDrag(null), setDropAt(null))}
                onDragOver={(e) => {
                  if (!accepts(currentDrag)) return;
                  e.preventDefault();
                  if (dropAt?.row !== r || dropAt.before !== c.id) setDropAt({ row: r as Row, before: c.id });
                }}
                title={props.onCardClick ? `${c.name ?? "Face-down card"}: click to use or choose it, drag to move` : isMe && props.onTap ? `${c.name ?? "Face-down card"}: click to ${c.tapped ? "untap" : "tap"}, drag to move` : undefined}
                onClick={() => (props.onCardClick ? props.onCardClick(c.id) : isMe && props.onTap?.(c.id))}
                {...props.hover(c)}
              >
                <div
                  className={["bf-card", n > 1 && "pile", c.sick && "sick", c.attacking && "attacking"].filter(Boolean).join(" ")}
                  style={{ "--n": Math.min(n, 4) } as React.CSSProperties}
                >
                  <CardFace card={c} size={cw > 120 ? "normal" : "small"} knownFaceDown={c.faceDown && !c.hidden} />
                  <CardBadges card={c} />
                  {n > 1 && <span className="pile-count">×{n}</span>}
                </div>
                {c.attacking && <span className="atk-badge" title={`Attacking ${nameOf(c.attacking)}`}>⚔ {c.attacking === props.viewer ? "you" : nameOf(c.attacking)}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
