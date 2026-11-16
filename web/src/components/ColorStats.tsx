// Under the deck stats: for each of W U B R G, a bar for its share of the colored mana symbols in
// the deck's costs and a bar for its share of what the deck's mana sources can make, so the two
// can be compared. Colors the deck doesn't use are greyed out.
import type { DeckCard } from "../../convex/model/deckRules";
import { WUBRG, colorPips, manaProduction, type Color } from "../colorstats";
import * as scry from "../scryfall";

const NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as const;

const costOf = (s: scry.ScryCard) => s.mana_cost || s.card_faces?.map((f) => f.mana_cost ?? "").join("");

function Bar({ label, n, total, color, tip }: { label: string; n: number; total: number; color: Color; tip: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="color-bar" title={tip} role="meter" aria-label={`${label}: ${pct}%`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`color-fill fill-${color}`} style={{ width: `${pct}%` }} />
      <span className="color-bar-text">
        <span>{label}</span>
        <strong>{pct}%</strong>
      </span>
    </div>
  );
}

export function ColorStats({ cards, identity }: { cards: DeckCard[]; /** The commander's colors, in Commander-style decks. */ identity?: string[] }) {
  const played = cards.flatMap((c) => {
    const s = c.board === "main" || c.board === "commander" ? scry.cached(c) : undefined;
    return s ? [{ quantity: c.quantity, card: s, board: c.board }] : [];
  });
  const pips = colorPips(played.map((e) => ({ quantity: e.quantity, manaCost: costOf(e.card) })));
  const pipTotal = WUBRG.reduce((n, c) => n + pips[c], 0);
  const made = manaProduction(
    played.filter((e) => e.board === "main").map((e) => ({ quantity: e.quantity, produced: e.card.produced_mana })),
    identity?.length ? identity : undefined,
  );
  const madeTotal = WUBRG.reduce((n, c) => n + made[c], 0);
  const used = (c: Color) => pips[c] > 0 || !!identity?.includes(c);

  return (
    <section className="board color-stats">
      <h2>Colors</h2>
      <div className="color-grid">
        {WUBRG.map((c) => (
          <div key={c} className={`color-col${used(c) ? "" : " unused"}`}>
            <img className="color-sym" src={`https://svgs.scryfall.io/card-symbols/${c}.svg`} alt={NAMES[c]} title={NAMES[c]} />
            <Bar label="Costs" n={pips[c]} total={pipTotal} color={c} tip={`${pips[c]} of the ${pipTotal} colored mana symbols in the deck's costs are ${NAMES[c].toLowerCase()}`} />
            <Bar label="Mana" n={made[c]} total={madeTotal} color={c} tip={`${made[c]} of the ${madeTotal} colors the deck's mana sources can make are ${NAMES[c].toLowerCase()}`} />
          </div>
        ))}
      </div>
      <p className="muted small color-note">
        Costs: each color's share of the mana symbols on the cards (commander included; hybrid counts for each color). Mana: its share of what the deck's
        mana sources can make: lands, rocks, dorks, rituals and Treasure makers.
      </p>
    </section>
  );
}
