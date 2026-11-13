// "Let me cast it ▸ for another cost…" (free play): type a mana cost, e.g. {1}{U} for a foretell
// cost a card doesn't have in Forge. Braces are optional; hybrid is W/U.
import { useEffect, useRef, useState } from "react";

/** "{2}{U}{W/U}" or "2 u w/u" → Forge's "2 U W/U"; null if it isn't a mana cost. */
export function forgeCost(text: string): string | null {
  const s = text.replace(/\{([^}]*)\}/g, " $1 ").toUpperCase().replace(/\s+/g, " ").trim();
  return /^[0-9WUBRGCXS/ ]{1,30}$/.test(s) && /[0-9WUBRGCXS]/.test(s) ? s : null;
}

export function CostDialog({ name, onClose, onApply }: { name: string; onClose: () => void; onApply: (cost: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const cost = forgeCost(text);
  return (
    <dialog ref={ref} className="counter-dialog" onClose={onClose} aria-label="Cast it for another cost">
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>Cast {name} for another cost</h3>
      <form method="dialog" onSubmit={(e) => {
        e.preventDefault();
        if (!cost) return;
        onApply(cost);
        ref.current?.close();
      }}>
        <label>
          Mana cost, e.g. {"{1}{U}"} or 2 W W
          <input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="{1}{U}" />
        </label>
        <div className="cd-btns">
          <button type="submit" className="btn small" disabled={!cost}>Allow</button>
        </div>
        <p className="muted small">Then cast it from where it is as usual (click it). The game log tells everyone.</p>
      </form>
    </dialog>
  );
}
