// "Other counters…" from a permanent's right-click menu: any kind of counter, any number, added
// or removed by hand. The server checks the name and logs the change for everyone.
import { useEffect, useRef, useState } from "react";

const COMMON = ["+1/+1", "-1/-1", "Loyalty", "Charge", "Shield", "Stun", "Lore", "Oil", "Time", "Fade", "Age", "Quest", "Energy", "Experience", "Finality", "Flying", "Deathtouch", "Lifelink", "Menace", "Trample", "Vigilance", "Indestructible", "Hexproof", "First strike", "Reach"];

export function CounterDialog({ name, onClose, onApply }: {
  /** The card's name, or "3 cards" for several selected. */
  name: string;
  onClose: () => void; onApply: (type: string, delta: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState("+1/+1");
  const [count, setCount] = useState(1);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const valid = /^[A-Za-z0-9+/\- ]{1,24}$/.test(type.trim()) && count >= 1 && count <= 99;
  const apply = (sign: 1 | -1) => {
    if (!valid) return;
    onApply(type.trim(), sign * count);
    ref.current?.close();
  };
  return (
    <dialog ref={ref} className="counter-dialog" onClose={onClose} aria-label={`Counters on ${name}`}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>Counters on {name}</h3>
      <form method="dialog" onSubmit={(e) => (e.preventDefault(), apply(1))}>
        <label>
          Kind
          <input list="counter-kinds" value={type} onChange={(e) => setType(e.target.value)} maxLength={24} autoFocus />
          <datalist id="counter-kinds">
            {COMMON.map((k) => <option key={k} value={k} />)}
          </datalist>
        </label>
        <label>
          How many
          <input type="number" min={1} max={99} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <div className="cd-btns">
          <button type="submit" className="btn small" disabled={!valid}>Add</button>
          <button type="button" className="btn small ghost" disabled={!valid} onClick={() => apply(-1)}>Remove</button>
        </div>
        <p className="muted small">Changes made by hand show in the log for everyone.</p>
      </form>
    </dialog>
  );
}
