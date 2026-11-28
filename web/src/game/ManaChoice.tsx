// What mana should this make? (A filter land's {W}{W} / {W}{U} / {U}{U}, a color for "one mana of
// any color".) A small window right by the card being tapped, one button per answer, instead of
// a question in the rail. Choices come from manaOptions.ts.
import { useLayoutEffect, useRef, useState } from "react";
import { ManaCost } from "../components/ManaCost";
import { SymText } from "./GainedMarks";
import type { ManaChoiceView } from "./manaOptions";

const GAP = 10;

export function ManaChoice({ choice, anchorId, onPick, onCancel }: {
  choice: ManaChoiceView;
  /** The card to show it by (the one being tapped); in the middle of the table when it isn't there. */
  anchorId?: number;
  onPick: (answer: number[]) => void;
  onCancel?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const box = ref.current?.getBoundingClientRect();
      const card = anchorId == null ? null : document.querySelector<HTMLElement>(`[data-card-ids~="${anchorId}"]`)?.getBoundingClientRect();
      if (!box) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!card || card.width === 0) {
        setPos({ left: (vw - box.width) / 2, top: vh * 0.3 });
        return;
      }
      // to the right of the card, else its left; level with it, kept on screen
      let left = card.right + GAP;
      if (left + box.width > vw - GAP) left = card.left - GAP - box.width;
      left = Math.max(GAP, Math.min(left, vw - box.width - GAP));
      const top = Math.max(GAP, Math.min(card.top + card.height / 2 - box.height / 2, vh - box.height - GAP));
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorId, choice]);
  return (
    <div
      ref={ref}
      className="mana-choice"
      role="dialog"
      aria-label={choice.title}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
    >
      <p className="mana-choice-title">{choice.title}</p>
      <div className="mana-choice-btns">
        {choice.choices.map((c, i) => (
          <button key={i} className={`mana-choice-btn${c.cost ? "" : " text"}`} autoFocus={i === 0}
            title={`${c.cost ? `Add ${c.cost}` : c.label}${c.note ? ` (${c.note})` : ""}`} onClick={() => onPick(c.answer)}>
            {c.cost ? <ManaCost cost={c.cost} font /> : <SymText text={c.label ?? ""} />}
            {c.note && <small className="mana-choice-note">{c.note}</small>}
          </button>
        ))}
      </div>
      {onCancel && (
        <button className="mana-choice-none" onClick={onCancel}>Cancel</button>
      )}
    </div>
  );
}
