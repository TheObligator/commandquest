// Tap several cards for mana at once (select them, right-click, "Tap for mana…"): the mana they'll
// add by color, with ▲ ▼ to move one mana from one color to another (a dual land switches), and
// each card's own choice underneath. The mana goes to your pool (shown by your name).
import { useEffect, useMemo, useRef, useState } from "react";
import { ManaCost } from "../components/ManaCost";
import { colorsOf, hurt, initialPlan, pain, painText, shift, symbols, totals, type Plan } from "./manaPlan";
import type { ManaPick } from "./useLiveGame";

export interface ManaDialogCard {
  id: number;
  name: string;
  picks: ManaPick[];
}

const COLOR_NAME: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless" };

export function ManaDialog({ cards, via, onClose, onApply }: {
  cards: ManaDialogCard[];
  /** Start with this card's ability for every card that can use it (Urza's "tap an untapped artifact"). */
  via?: string;
  onClose: () => void;
  onApply: (picks: { card: number; source: number; ability: number; choice: string }[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<Plan>(() => initialPlan(cards, via));
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const t = totals(cards, plan);
  const colors = useMemo(() => colorsOf(cards), [cards]);
  const all = colors.flatMap((x) => Array(t[x] ?? 0).fill(x)).join("");
  const apply = () => {
    onApply(cards.map((c, i) => {
      const p = c.picks[plan[i]];
      return { card: c.id, source: p.source, ability: p.ability, choice: p.choice };
    }));
    ref.current?.close();
  };
  const step = (color: string, dir: 1 | -1) => {
    const next = shift(cards, plan, color, dir);
    return next && { go: () => setPlan(next), hurts: hurt(pain(cards, next)) > hurt(pain(cards, plan)) };
  };
  const ow = pain(cards, plan);
  const owText = painText(ow);
  const label = (p: (typeof cards)[number]["picks"][number]) => `${symbols(p.mana)}${p.via ? ` (for ${p.via})` : ""}${hurt(p) ? ` ♥ ${painText(p)}` : ""}`;
  return (
    <dialog ref={ref} className="counter-dialog mana-dialog" onClose={onClose} aria-label="Tap for mana">
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>Tap {cards.length} card{cards.length === 1 ? "" : "s"} for mana</h3>
      <form method="dialog" onSubmit={(e) => (e.preventDefault(), apply())}>
        <div className="md-colors">
          {colors.map((x) => {
            const up = step(x, 1), down = step(x, -1);
            return (
              <div key={x} className="md-color">
                <button type="button" className={`md-arrow${up?.hurts ? " hurts" : ""}`} disabled={!up} onClick={up?.go} aria-label={`One more ${COLOR_NAME[x]}`}
                  title={up?.hurts ? `One more ${COLOR_NAME[x]}: costs you life` : undefined}>▲</button>
                <ManaCost cost={`{${x}}`} />
                <b>{t[x] ?? 0}</b>
                <button type="button" className={`md-arrow${down?.hurts ? " hurts" : ""}`} disabled={!down} onClick={down?.go} aria-label={`One less ${COLOR_NAME[x]}`}
                  title={down?.hurts ? `One less ${COLOR_NAME[x]}: costs you life` : undefined}>▼</button>
              </div>
            );
          })}
        </div>
        <ul className="md-cards">
          {cards.map((c, i) => (
            <li key={c.id}>
              <span>{c.name}</span>
              {c.picks.length > 1 ? (
                <select value={plan[i]} onChange={(e) => setPlan(plan.map((k, j) => (j === i ? Number(e.target.value) : k)))} aria-label={`What ${c.name} adds`}>
                  {c.picks.map((p, k) => (
                    <option key={k} value={k}>{label(p)}</option>
                  ))}
                </select>
              ) : (
                <span className={hurt(c.picks[0]) ? "md-hurt small" : "muted small"}>{label(c.picks[0])}</span>
              )}
            </li>
          ))}
        </ul>
        {owText && <p className="md-hurt">♥ This costs you {owText}{ow.damage && ow.life ? "" : ow.damage ? " (dealt to you)" : ""}.</p>}
        <div className="cd-btns">
          <button type="submit" className="btn small" disabled={!all}>Add <ManaCost cost={symbols(all)} />{owText ? ` (♥ −${ow.damage + ow.life})` : ""}</button>
          <button type="button" className="btn small ghost" onClick={() => ref.current?.close()}>Cancel</button>
        </div>
        <p className="muted small">The mana goes to your mana pool (by your name) and empties at the end of the step. When you pay a cost, click it there to use it.</p>
      </form>
    </dialog>
  );
}
