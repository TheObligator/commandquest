// Your hand: upright cards in a row from the left. Drag one onto your board or double-click it to
// play it. While choosing cards to put on the bottom after a mulligan, clicking selects instead.
import { CardFace, CostOverlay, PTOverlay, previewFor, usePreview } from "./cards";
import { DRAG_TYPE, setDrag, type DragData } from "./SeatBoard";
import type { OpenMenu } from "./TableBoard";
import type { CardView } from "./view";

export function HandBar(props: {
  cards: CardView[];
  viewer: string;
  nameOf: (id: string) => string;
  selecting: boolean;
  selected: number[];
  onToggleSelect: (id: number) => void;
  onPlay: (id: number) => void;
  /** Single click (live games: Forge decides what it does, e.g. play or choose the card). */
  onClick?: (id: number) => void;
  /** Cards that can be picked right now. */
  selectable?: Set<number>;
  /** Cards chosen so far for the current prompt (e.g. to put on the bottom after a mulligan). */
  chosen?: Set<number>;
  /** Cards you can use right now. */
  playable?: Set<number>;
  onMenu?: OpenMenu;
}) {
  const setPreview = usePreview();
  return (
    <div className="hand-bar" aria-label={`Your hand, ${props.cards.length} cards`}>
      <span className="hand-label">Hand · {props.cards.length}</span>
      <div className="hand-cards">
        {props.cards.map((c) => {
          const selected = props.selected.includes(c.id);
          return (
            <button
              key={c.id}
              className={`hand-card${selected ? " selected" : ""}${props.selectable?.has(c.id) ? " selectable" : ""}${props.chosen?.has(c.id) ? " chosen" : ""}${!props.selecting && props.playable?.has(c.id) ? " playable" : ""}`}
              data-card-ids={c.id}
              draggable={!props.selecting}
              aria-pressed={props.selecting ? selected : undefined}
              title={props.selecting ? "Put this on the bottom" : props.onClick ? `${c.name}: click or drag to your board to play it, right-click for more` : `${c.name}: drag to your board or double-click to play`}
              onDragStart={(e) => {
                const d: DragData = { from: "hand", seat: props.viewer, ids: [c.id] };
                setDrag(d);
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
                e.dataTransfer.effectAllowed = "move";
                setPreview(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={() => (props.selecting ? props.onToggleSelect(c.id) : props.onClick?.(c.id))}
              onDoubleClick={() => !props.selecting && !props.onClick && props.onPlay(c.id)}
              onContextMenu={props.onMenu && !props.selecting ? (e) => props.onMenu!(e, { kind: "card", card: c, where: "hand" }) : undefined}
              onMouseEnter={() => setPreview(previewFor(c, props.viewer, props.nameOf))}
              onMouseLeave={() => setPreview(null)}
            >
              <CardFace card={c} />
              <CostOverlay card={c} />
              <PTOverlay card={c} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
