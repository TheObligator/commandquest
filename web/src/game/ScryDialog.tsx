// Scry or surveil by hand (free play): the top cards of your library, each kept on top (in the
// order shown, left is the top card) or put away (to the bottom for scry, the graveyard for
// surveil). The server does it as Forge's own scry or surveil, so triggers on them happen.
import { useEffect, useRef, useState } from "react";
import { CardFace } from "./cards";
import type { CardView } from "./view";

export type ArrangeKind = "scry" | "surveil";

export function ScryDialog({ kind, cards, onClose, onApply }: {
  kind: ArrangeKind;
  /** The top cards of your library, top first. */
  cards: CardView[];
  onClose: () => void;
  onApply: (top: number[], away: number[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [top, setTop] = useState<number[]>(() => cards.map((c) => c.id));
  const [away, setAway] = useState<number[]>([]);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const awayName = kind === "scry" ? "Bottom" : "Graveyard";
  const move = (id: number, d: -1 | 1) => setTop((t) => {
    const i = t.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= t.length) return t;
    const n = [...t];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const putAway = (id: number) => (setTop((t) => t.filter((x) => x !== id)), setAway((a) => [...a, id]));
  const keep = (id: number) => (setAway((a) => a.filter((x) => x !== id)), setTop((t) => [...t, id]));
  const tile = (id: number, controls: React.ReactNode) => {
    const c = byId.get(id);
    return c ? (
      <li key={id} className="scry-card">
        <div className="scry-img"><CardFace card={c} /></div>
        <span className="scry-name">{c.name}</span>
        <div className="scry-btns">{controls}</div>
      </li>
    ) : null;
  };
  const title = `${kind === "scry" ? "Scry" : "Surveil"} ${cards.length}`;
  return (
    <dialog ref={ref} className="counter-dialog scry-dialog" onClose={onClose} aria-label={title}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>{title}</h3>
      <p className="muted small">On top{top.length > 1 ? ", left is the top card" : ""}:</p>
      <ol className="scry-row">
        {top.map((id, i) => tile(id, <>
          <button className="btn small ghost" aria-label="Move up (nearer the top)" disabled={i === 0} onClick={() => move(id, -1)}>◀</button>
          <button className="btn small ghost" aria-label="Move down" disabled={i === top.length - 1} onClick={() => move(id, 1)}>▶</button>
          <button className="btn small ghost" onClick={() => putAway(id)}>{awayName}</button>
        </>))}
        {!top.length && <li className="muted small">Nothing</li>}
      </ol>
      <p className="muted small">{kind === "scry" ? "On the bottom" : "Into the graveyard"}:</p>
      <ol className="scry-row">
        {away.map((id) => tile(id, <button className="btn small ghost" onClick={() => keep(id)}>Top</button>))}
        {!away.length && <li className="muted small">Nothing</li>}
      </ol>
      <div className="cd-btns">
        <button className="btn small" autoFocus onClick={() => (onApply(top, away), ref.current?.close())}>Done</button>
        <button className="btn small ghost" onClick={() => ref.current?.close()}>Cancel</button>
      </div>
    </dialog>
  );
}
