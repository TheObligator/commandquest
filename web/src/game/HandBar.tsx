// Your hand: upright cards in a row from the left. Drag one onto your board or double-click it to
// play it. While choosing cards to put on the bottom after a mulligan, clicking selects instead.
import { CardFace, previewFor, usePreview } from "./cards";
import { DRAG_TYPE, setDrag, type DragData } from "./SeatBoard";
import type { CardView } from "./view";

export function HandBar(props: {
  cards: CardView[];
  viewer: string;
  nameOf: (id: string) => string;
  selecting: boolean;
  selected: number[];
  onToggleSelect: (id: number) => void;
  onPlay: (id: number) => void;
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
              className={`hand-card${selected ? " selected" : ""}`}
              draggable={!props.selecting}
              aria-pressed={props.selecting ? selected : undefined}
              title={props.selecting ? "Put this on the bottom" : `${c.name}: drag to your board or double-click to play`}
              onDragStart={(e) => {
                const d: DragData = { from: "hand", seat: props.viewer, ids: [c.id] };
                setDrag(d);
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
                e.dataTransfer.effectAllowed = "move";
                setPreview(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={() => props.selecting && props.onToggleSelect(c.id)}
              onDoubleClick={() => !props.selecting && props.onPlay(c.id)}
              onMouseEnter={() => setPreview(previewFor(c, props.viewer, props.nameOf))}
              onMouseLeave={() => setPreview(null)}
            >
              <CardFace card={c} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
