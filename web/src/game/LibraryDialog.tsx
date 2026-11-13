// "Several cards…" from your library's right-click menu (free play): draw, mill, exile or look at
// the top N cards. The server does it by hand and the game log tells the table.
import { useEffect, useRef, useState } from "react";

export type LibraryCountAction = "draw" | "mill" | "exile" | "look" | "scry" | "surveil";

const ACTIONS: { action: LibraryCountAction; label: string }[] = [
  { action: "draw", label: "Draw" },
  { action: "mill", label: "Mill" },
  { action: "exile", label: "Exile" },
  { action: "look", label: "Look at" },
  { action: "scry", label: "Scry" },
  { action: "surveil", label: "Surveil" },
];

export function LibraryDialog({ size, initial, onClose, onApply }: {
  /** Cards in your library. */
  size: number;
  /** The button Enter presses. */
  initial: LibraryCountAction;
  onClose: () => void;
  onApply: (action: LibraryCountAction, n: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [count, setCount] = useState(Math.min(size, initial === "look" ? 3 : 2));
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const valid = Number.isInteger(count) && count >= 1 && count <= Math.min(99, size);
  const apply = (action: LibraryCountAction) => {
    if (!valid) return;
    onApply(action, count);
    ref.current?.close();
  };
  return (
    <dialog ref={ref} className="counter-dialog" onClose={onClose} aria-label="Top cards of your library">
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>Top cards of your library</h3>
      <form method="dialog" onSubmit={(e) => (e.preventDefault(), apply(initial))}>
        <label>
          How many ({size} in your library)
          <input type="number" min={1} max={Math.min(99, size)} value={count} onChange={(e) => setCount(Number(e.target.value))} autoFocus />
        </label>
        <div className="cd-btns" style={{ flexWrap: "wrap" }}>
          {ACTIONS.map((a) => (
            <button key={a.action} type={a.action === initial ? "submit" : "button"} className={`btn small${a.action === initial ? "" : " ghost"}`} disabled={!valid}
              onClick={a.action === initial ? undefined : () => apply(a.action)}>
              {a.label}
            </button>
          ))}
        </div>
        <p className="muted small">Done by hand: the game log tells everyone. Looking shows the cards only to you.</p>
      </form>
    </dialog>
  );
}
