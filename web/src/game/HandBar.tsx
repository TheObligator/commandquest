// Your hand: upright cards in a row from the left. Drag one onto your board or double-click it to
// play it. While choosing cards to put on the bottom after a mulligan, clicking selects instead.
import { CardFace, CostOverlay, PTOverlay, previewFor, usePreview } from "./cards";
import { GainedMarks } from "./GainedMarks";
import { isMarkClick, useMarks, useMarquee } from "./marks";
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
  const marks = useMarks();
  const { onMouseDown, marquee } = useMarquee();
  return (
    <div className="hand-bar" aria-label={`Your hand, ${props.cards.length} cards`} onMouseDown={onMouseDown}>
      {marquee}
      <span className="hand-label">Hand · {props.cards.length}</span>
      <div className="hand-cards">
        {props.cards.map((c) => {
          const selected = props.selected.includes(c.id);
          // Which pick this card is (1, 2, ...), shown on it when you're choosing several.
          const pick = props.chosen?.has(c.id) && props.chosen.size > 1 ? [...props.chosen].indexOf(c.id) + 1 : 0;
          return (
            <button
              key={c.id}
              className={`hand-card${selected ? " selected" : ""}${props.selectable?.has(c.id) ? " selectable" : ""}${props.chosen?.has(c.id) ? " chosen" : ""}${!props.selecting && props.playable?.has(c.id) ? " playable" : ""}${marks.marked.has(c.id) ? " marked" : ""}`}
              data-card-ids={c.id}
              data-pick={pick || undefined}
              draggable={!props.selecting}
              aria-pressed={props.selecting ? selected : undefined}
              aria-label={props.selecting ? "Put this on the bottom" : props.onClick ? `${c.name}: click or drag to your board to play it, right-click for more` : `${c.name}: drag to your board or double-click to play`}
              onDragStart={(e) => {
                const d: DragData = { from: "hand", seat: props.viewer, ids: [c.id], types: c.types };
                setDrag(d);
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
                e.dataTransfer.effectAllowed = "move";
                setPreview(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={(e) => {
                if (props.selecting) return props.onToggleSelect(c.id);
                if (isMarkClick(e)) return marks.toggle([c.id]); // select several for one right-click menu
                props.onClick?.(c.id);
              }}
              onDoubleClick={() => !props.selecting && !props.onClick && props.onPlay(c.id)}
              onContextMenu={props.onMenu && !props.selecting ? (e) => props.onMenu!(e, { kind: "card", card: c, where: "hand" }) : undefined}
              onMouseEnter={() => setPreview(previewFor(c, props.viewer, props.nameOf))}
              onMouseLeave={() => setPreview(null)}
            >
              <CardFace card={c} />
              <CostOverlay card={c} />
              <PTOverlay card={c} />
              <GainedMarks gained={c.gained} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
